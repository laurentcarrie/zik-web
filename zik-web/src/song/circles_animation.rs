use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;
use circles_sketch::model::EmbedOptions;

use super::songs::{BUCKET, make_cloudfront_url, s3_key};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum AnimationEnum {
    Text(String),
    SvgPath(String),
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AnimationItem {
    pub name: String,
    pub item: AnimationEnum,
    pub embed_options: EmbedOptions,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Animations {
    pub items: Vec<AnimationItem>,
}

pub async fn load_animations(
    client: &Client,
) -> Result<Animations, Box<dyn std::error::Error + Send + Sync>> {
    let key = s3_key("static/animations.yml");
    let resp = client
        .get_object()
        .bucket(BUCKET.as_str())
        .key(&key)
        .send()
        .await?;

    let bytes = resp.body.collect().await?.into_bytes();
    let yaml = String::from_utf8(bytes.to_vec())?;
    let animations: Animations = serde_yaml::from_str(&yaml)?;
    Ok(animations)
}

pub async fn save_animations(
    client: &Client,
    animations: &Animations,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let key = s3_key("static/animations.yml");
    let yaml = serde_yaml::to_string(animations)?;
    client
        .put_object()
        .bucket(BUCKET.as_str())
        .key(&key)
        .body(ByteStream::from(yaml.into_bytes()))
        .content_type("text/yaml")
        .send()
        .await?;
    Ok(())
}

fn contour_of_animation_enum(
    animation: &AnimationEnum,
) -> Result<(String, Vec<(f64, f64)>), Box<dyn std::error::Error + Send + Sync>> {
    match animation {
        AnimationEnum::SvgPath(path) => {
            let points = circles_sketch::svg::points_of_svg_path(path);
            Ok((path.clone(), points))
        }
        AnimationEnum::Text(text) => {
            let svg_path = circles_sketch::text::svg_path_of_text(text, "Arial");
            let points = circles_sketch::svg::points_of_svg_path(&svg_path);
            Ok((svg_path, points))
        }
    }
}

pub async fn write_animation_embed_to_s3(
    client: &Client,
    animations: &Animations,
    index: usize,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let anim = animations.items.get(index).ok_or_else(|| {
        format!(
            "invalid animation index {index}, max is {}",
            animations.items.len() - 1
        )
    })?;

    let (_svg_path, points) = contour_of_animation_enum(&anim.item)?;
    let contour = circles_sketch::contour::Contour { points };
    let contour = circles_sketch::contour::interpolate(&contour, 1000);
    let svg_path_interp = circles_sketch::svg::svg_path_of_contour(&contour);
    let max_terms = contour.points.len() / 2;
    let fd = circles_sketch::contour::fourier_decomposition(&contour, max_terms);

    let html = circles_sketch::svg::embed_html_of_svg_path_with_fourier(
        &svg_path_interp,
        &contour.points,
        Some(&fd),
        &anim.embed_options,
    );
    let html = html.replace("background:black", "background:transparent");
    // Inject postMessage to report harmonics and signal completion
    let html = html.replace(
        "loopIndex = (loopIndex + 1) % totalLoops;\n    applyLoopParams();",
        r#"loopIndex = (loopIndex + 1) % totalLoops;
    applyLoopParams();
    window.parent.postMessage({ type: 'guitar-harmonics', harmonics: nhSteps[loopIndex], maxHarmonics: nhSteps[totalLoops - 1] }, '*');
    if (loopIndex === 0) {
      cancelAnimationFrame(animId);
      setTimeout(() => {
        window.parent.postMessage({ type: 'guitar-animation-complete' }, '*');
        lastTime = null;
        animId = requestAnimationFrame(animate);
      }, 5000);
      return;
    }"#,
    );
    // Also report initial harmonics when animation starts
    let html = html.replace(
        "animId = requestAnimationFrame(animate);",
        "window.parent.postMessage({ type: 'guitar-harmonics', harmonics: nhSteps[0], maxHarmonics: nhSteps[totalLoops - 1] }, '*');\nanimId = requestAnimationFrame(animate);",
    );

    let mut hasher = DefaultHasher::new();
    html.hash(&mut hasher);
    let hash = hasher.finish();
    let key = s3_key(&format!("delivery/animation-embed-{index}-{hash:x}.html"));
    client
        .put_object()
        .bucket(BUCKET.as_str())
        .key(&key)
        .body(ByteStream::from(html.into_bytes()))
        .content_type("text/html")
        .cache_control("no-cache, no-store, must-revalidate")
        .send()
        .await?;

    Ok(make_cloudfront_url(&key))
}
