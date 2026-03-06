use std::path::PathBuf;

use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;

pub const CLOUDFRONT_URL: &str = "https://dtuq2blkj3udo.cloudfront.net";

type StorageResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Clone)]
pub enum Storage {
    S3 {
        client: Client,
        bucket: String,
        root: String,
    },
    Local {
        root: PathBuf,
    },
}

impl Storage {
    /// Build a fully-qualified key from a relative path.
    /// S3: prepends the bucket root, e.g. "songs/world.yml" -> "dev/songs/world.yml"
    /// Local: returns the relative path as-is.
    pub fn full_key(&self, relative: &str) -> String {
        match self {
            Storage::S3 { root, .. } => format!("{root}/{relative}"),
            Storage::Local { .. } => relative.to_string(),
        }
    }

    pub fn is_local(&self) -> bool {
        matches!(self, Storage::Local { .. })
    }

    pub async fn get_bytes(&self, key: &str) -> StorageResult<Vec<u8>> {
        match self {
            Storage::S3 { client, bucket, .. } => {
                let resp = client.get_object().bucket(bucket).key(key).send().await?;
                let bytes = resp.body.collect().await?.into_bytes();
                Ok(bytes.to_vec())
            }
            Storage::Local { root } => {
                let path = root.join(key);
                Ok(std::fs::read(&path)?)
            }
        }
    }

    pub async fn get_string(&self, key: &str) -> StorageResult<String> {
        let bytes = self.get_bytes(key).await?;
        Ok(String::from_utf8(bytes)?)
    }

    pub async fn put_bytes(
        &self,
        key: &str,
        data: Vec<u8>,
        content_type: Option<&str>,
    ) -> StorageResult<()> {
        match self {
            Storage::S3 { client, bucket, .. } => {
                let mut req = client
                    .put_object()
                    .bucket(bucket)
                    .key(key)
                    .body(ByteStream::from(data));
                if let Some(ct) = content_type {
                    req = req.content_type(ct);
                }
                req.send().await?;
                Ok(())
            }
            Storage::Local { root } => {
                let path = root.join(key);
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&path, data)?;
                Ok(())
            }
        }
    }

    pub async fn put_bytes_with_cache_control(
        &self,
        key: &str,
        data: Vec<u8>,
        content_type: Option<&str>,
        cache_control: &str,
    ) -> StorageResult<()> {
        match self {
            Storage::S3 { client, bucket, .. } => {
                let mut req = client
                    .put_object()
                    .bucket(bucket)
                    .key(key)
                    .body(ByteStream::from(data))
                    .cache_control(cache_control);
                if let Some(ct) = content_type {
                    req = req.content_type(ct);
                }
                req.send().await?;
                Ok(())
            }
            Storage::Local { root } => {
                // Local mode ignores cache_control
                let path = root.join(key);
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&path, data)?;
                Ok(())
            }
        }
    }

    pub async fn put_string(
        &self,
        key: &str,
        data: &str,
        content_type: Option<&str>,
    ) -> StorageResult<()> {
        self.put_bytes(key, data.as_bytes().to_vec(), content_type)
            .await
    }

    pub async fn exists(&self, key: &str) -> StorageResult<bool> {
        match self {
            Storage::S3 { client, bucket, .. } => {
                match client.head_object().bucket(bucket).key(key).send().await {
                    Ok(_) => Ok(true),
                    Err(_) => Ok(false),
                }
            }
            Storage::Local { root } => Ok(root.join(key).exists()),
        }
    }

    /// List all keys under a given prefix.
    pub async fn list_keys(&self, prefix: &str) -> StorageResult<Vec<String>> {
        match self {
            Storage::S3 { client, bucket, .. } => {
                let mut keys = Vec::new();
                let mut continuation_token: Option<String> = None;
                loop {
                    let mut req = client.list_objects_v2().bucket(bucket).prefix(prefix);
                    if let Some(token) = continuation_token {
                        req = req.continuation_token(token);
                    }
                    let response = req.send().await?;
                    for object in response.contents() {
                        if let Some(key) = object.key() {
                            keys.push(key.to_string());
                        }
                    }
                    if response.is_truncated() == Some(true) {
                        continuation_token =
                            response.next_continuation_token().map(|s| s.to_string());
                    } else {
                        break;
                    }
                }
                Ok(keys)
            }
            Storage::Local { root } => {
                let dir = root.join(prefix);
                let mut keys = Vec::new();
                if dir.is_dir() {
                    collect_keys_recursive(&dir, root, &mut keys)?;
                }
                Ok(keys)
            }
        }
    }

    /// Build a public URL for a given key.
    /// S3: CloudFront URL. Local: served through the /api/s3/ endpoint.
    pub fn content_url(&self, key: &str) -> String {
        match self {
            Storage::S3 { .. } => format!("{CLOUDFRONT_URL}/{key}"),
            Storage::Local { .. } => format!("/api/s3/{key}"),
        }
    }

    /// Get bytes along with last-modified timestamp (for make-report).
    pub async fn get_bytes_with_last_modified(
        &self,
        key: &str,
    ) -> StorageResult<(Vec<u8>, Option<String>)> {
        match self {
            Storage::S3 { client, bucket, .. } => {
                let resp = client.get_object().bucket(bucket).key(key).send().await?;
                let last_modified = resp.last_modified().map(|dt| {
                    dt.fmt(aws_sdk_s3::primitives::DateTimeFormat::DateTime)
                        .unwrap_or_default()
                });
                let bytes = resp.body.collect().await?.into_bytes();
                Ok((bytes.to_vec(), last_modified))
            }
            Storage::Local { root } => {
                let path = root.join(key);
                let bytes = std::fs::read(&path)?;
                let last_modified = std::fs::metadata(&path)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| {
                        let dt: chrono::DateTime<chrono::Utc> = t.into();
                        dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
                    });
                Ok((bytes, last_modified))
            }
        }
    }
}

fn collect_keys_recursive(
    dir: &std::path::Path,
    root: &std::path::Path,
    keys: &mut Vec<String>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_keys_recursive(&path, root, keys)?;
        } else if let Ok(relative) = path.strip_prefix(root) {
            keys.push(relative.to_string_lossy().to_string());
        }
    }
    Ok(())
}
