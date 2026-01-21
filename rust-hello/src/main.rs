use axum::{extract::{Query, State}, response::Html, routing::get, Router};
use tower_http::services::ServeDir;
use aws_sdk_s3::Client;
use aws_config::Region;
use serde::Deserialize;

#[derive(Clone)]
struct AppState {
    s3_client: Client,
}

const BUCKET: &str = "laurent-zik";
const SONGS_PREFIX: &str = "songs/";

#[derive(Deserialize)]
struct SongInfo {
    title: String,
    author: String,
}

#[derive(Deserialize)]
struct SongYml {
    info: SongInfo,
}

async fn get_all_songs(client: &Client) -> Result<Vec<(String, String)>, Box<dyn std::error::Error + Send + Sync>> {
    let mut songs = Vec::new();
    let mut continuation_token: Option<String> = None;

    loop {
        let mut request = client
            .list_objects_v2()
            .bucket(BUCKET)
            .prefix(SONGS_PREFIX);

        if let Some(token) = continuation_token {
            request = request.continuation_token(token);
        }

        let response = request.send().await?;

        for object in response.contents() {
            if let Some(key) = object.key() {
                if key.ends_with("/song.yml") {
                    match client.get_object().bucket(BUCKET).key(key).send().await {
                        Ok(resp) => {
                            let bytes = resp.body.collect().await?.into_bytes();
                            if let Ok(song_yml) = serde_yaml::from_slice::<SongYml>(&bytes) {
                                songs.push((song_yml.info.title, song_yml.info.author));
                            }
                        }
                        Err(_) => continue,
                    }
                }
            }
        }

        if response.is_truncated() == Some(true) {
            continuation_token = response.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    Ok(songs)
}

#[tokio::main]
async fn main() {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new("eu-west-3"))
        .load()
        .await;
    let s3_client = Client::new(&config);
    let state = AppState { s3_client };

    let app = Router::new()
        .route("/", get(index))
        .route("/grilles", get(grilles))
        .nest_service("/static", ServeDir::new("static"))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    println!("Server running at http://0.0.0.0:8080");
    axum::serve(listener, app).await.unwrap();
}

async fn index(State(_state): State<AppState>) -> Html<&'static str> {
    Html(r#"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M T L</title>
    <link rel="apple-touch-icon" sizes="180x180" href="/static/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/static/favicon-16x16.png">
    <link rel="manifest" href="/static/site.webmanifest">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            min-height: 100vh;
            background: url('/static/Move-the-line-affiche.jpg') repeat center center fixed;
            background-size: contain;
            display: flex;
            justify-content: center;
            align-items: center;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        .container {
            position: relative;
            text-align: center;
            padding: 2rem;
        }
        nav {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }
        nav a {
            display: block;
            padding: 1rem 2rem;
            background: rgba(0, 0, 0, 0.5);
            color: white;
            text-decoration: none;
            border-radius: 10px;
            font-size: 1.1rem;
            transition: all 0.3s ease;
            backdrop-filter: blur(5px);
        }
        nav a:hover {
            background: rgba(0, 0, 0, 0.7);
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <div class="container">
        <nav>
            <a href="/grilles">Grilles</a>
            <a href="/paroles">Paroles</a>
            <a href="/deezer">Deezer</a>
            <a href="/edit">Edit</a>
        </nav>
    </div>
</body>
</html>
"#)
}

#[derive(Deserialize)]
struct GrillesQuery {
    #[serde(default)]
    sort: Option<String>,
}

async fn grilles(State(state): State<AppState>, Query(query): Query<GrillesQuery>) -> Html<String> {
    let mut songs = get_all_songs(&state.s3_client).await.unwrap_or_default();

    let sort_by = query.sort.as_deref().unwrap_or("title");
    match sort_by {
        "author" => songs.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()).then(a.0.to_lowercase().cmp(&b.0.to_lowercase()))),
        _ => songs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()).then(a.1.to_lowercase().cmp(&b.1.to_lowercase()))),
    }

    let mut song_list = String::new();
    for (title, author) in &songs {
        song_list.push_str(&format!(
            r#"<li><span class="title">{}</span> <span class="author">by {}</span></li>"#,
            html_escape(title),
            html_escape(author)
        ));
    }

    Html(format!(r#"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Grilles - M T L</title>
    <link rel="apple-touch-icon" sizes="180x180" href="/static/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/static/favicon-16x16.png">
    <link rel="manifest" href="/static/site.webmanifest">
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            min-height: 100vh;
            background: url('/static/Move-the-line-affiche.jpg') repeat center center fixed;
            background-size: contain;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 2rem;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 2rem;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
        }}
        h1 {{
            color: #333;
            margin-bottom: 1.5rem;
            font-size: 2rem;
        }}
        .back-link {{
            display: inline-block;
            margin-bottom: 1rem;
            color: #667eea;
            text-decoration: none;
        }}
        .back-link:hover {{
            text-decoration: underline;
        }}
        ul {{
            list-style: none;
        }}
        li {{
            padding: 0.75rem 0;
            border-bottom: 1px solid #eee;
        }}
        li:last-child {{
            border-bottom: none;
        }}
        .title {{
            font-weight: 600;
            color: #333;
        }}
        .author {{
            color: #666;
        }}
        .count {{
            color: #999;
            font-size: 0.9rem;
            margin-bottom: 1rem;
        }}
        .sort-buttons {{
            margin-bottom: 1rem;
        }}
        .sort-btn {{
            padding: 0.5rem 1rem;
            margin-right: 0.5rem;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            text-decoration: none;
            font-size: 0.9rem;
            background: #eee;
            color: #333;
        }}
        .sort-btn:hover {{
            background: #ddd;
        }}
        .sort-btn.active {{
            background: #667eea;
            color: white;
        }}
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back</a>
        <h1>Grilles</h1>
        <div class="sort-buttons">
            <a href="/grilles?sort=title" class="sort-btn {}">Sort by Title</a>
            <a href="/grilles?sort=author" class="sort-btn {}">Sort by Author</a>
        </div>
        <p class="count">{} songs</p>
        <ul>
            {}
        </ul>
    </div>
</body>
</html>
"#,
    if sort_by == "title" { "active" } else { "" },
    if sort_by == "author" { "active" } else { "" },
    songs.len(),
    song_list))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use aws_config::Region;

    #[tokio::test]
    async fn test_get_all_songs() {
        let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(Region::new("eu-west-3"))
            .load()
            .await;
        let client = Client::new(&config);

        let songs = get_all_songs(&client).await.expect("Failed to get songs");

        // Check we got some songs
        assert!(!songs.is_empty(), "Should have at least one song");

        // Check that Black Velvet by Alannah Myles is in the list
        let has_black_velvet = songs.iter().any(|(title, author)| {
            title == "Black Velvet" && author == "Alannah Myles"
        });
        assert!(has_black_velvet, "Should contain Black Velvet by Alannah Myles");

        // Print all songs for debugging
        println!("Found {} songs:", songs.len());
        for (title, author) in &songs {
            println!("  - {} by {}", title, author);
        }
    }
}
