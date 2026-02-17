use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;
use circles_sketch::model::EmbedOptions;

use super::songs::{BUCKET, make_cloudfront_url, s3_key};

type AnimResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TextAnimation {
    pub text: String,
    pub font: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SvgPath {
    pub path: String,
    pub flip_y: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum AnimationEnum {
    Text(TextAnimation),
    SvgPath(SvgPath),
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

fn animations_path(band: &str) -> String {
    if band.is_empty() {
        "static/animations.yml".to_string()
    } else {
        format!("static/{band}/animations.yml")
    }
}

pub fn load_animations(band: &str) -> Result<Animations, Box<dyn std::error::Error + Send + Sync>> {
    let yaml = std::fs::read_to_string(animations_path(band))?;
    let animations: Animations = serde_yaml::from_str(&yaml)?;
    Ok(animations)
}

pub fn save_animations(
    band: &str,
    animations: &Animations,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let yaml = serde_yaml::to_string(animations)?;
    std::fs::write(animations_path(band), yaml)?;
    Ok(())
}

fn contour_of_animation_enum(
    band: &str,
    animation: &AnimationEnum,
) -> AnimResult<(String, Vec<(f64, f64)>)> {
    match animation {
        AnimationEnum::SvgPath(svg) => {
            let svg_content = if band.is_empty() {
                std::fs::read_to_string(format!("static/{}", svg.path))?
            } else {
                std::fs::read_to_string(format!("static/{band}/{}", svg.path))?
            };
            let path_data = svg_content
                .split("d=\"")
                .nth(1)
                .and_then(|s| s.split('"').next())
                .ok_or_else(|| format!("no path d attribute found in {}", svg.path))?;
            let mut points = circles_sketch::canvas::points_of_svg_path(path_data);
            if svg.flip_y {
                for (_, y) in &mut points {
                    *y = -*y;
                }
            }
            Ok((path_data.to_string(), points))
        }
        AnimationEnum::Text(t) => {
            let svg_path = circles_sketch::text::svg_path_of_text(&t.text, &t.font);
            let points = circles_sketch::canvas::points_of_svg_path(&svg_path);
            Ok((svg_path, points))
        }
    }
}

pub async fn write_animation_embed_to_s3(
    client: &Client,
    band: &str,
    animations: &Animations,
    index: usize,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let anim = animations.items.get(index).ok_or_else(|| {
        format!(
            "invalid animation index {index}, max is {}",
            animations.items.len() - 1
        )
    })?;

    let (_svg_path, points) = contour_of_animation_enum(band, &anim.item)?;
    let contour = circles_sketch::contour::Contour { points };
    let contour = circles_sketch::contour::interpolate(&contour, anim.embed_options.max_harmonics);
    let svg_path_interp = circles_sketch::canvas::svg_path_of_contour(&contour);
    let max_terms = contour.points.len() / 2;
    let fd = circles_sketch::contour::fourier_decomposition(&contour, max_terms);

    let html = circles_sketch::canvas::embed_html_of_svg_path_with_fourier(
        &svg_path_interp,
        &contour.points,
        Some(&fd),
        &anim.embed_options,
    );
    let html = html.replace("background:black", "background:transparent");
    // Shrink sparkle point on non-mobile (desktop screens)
    let html = html.replace(
        r#"dot.setAttribute("transform", "translate(" + pt[0] + "," + pt[1] + ")")"#,
        r#"dot.setAttribute("transform", "translate(" + pt[0] + "," + pt[1] + ")" + (window.innerWidth > 768 ? " scale(0.4)" : ""))"#,
    );
    // Ensure fourier-group is re-shown after loop transitions (crate hides it but
    // may not re-show it when show_fourier_circles is Always)
    let html = html.replace(
        "function updateDisplay(t) {\n  updateFourier(t);",
        r#"function updateDisplay(t) {
  document.getElementById("fourier-group").style.display = "";
  updateFourier(t);"#,
    );
    // Inject postMessage to report harmonics and signal completion
    let html = html.replace(
        "loopIndex = (loopIndex + 1) % totalLoops;\n    applyLoopParams();",
        r#"loopIndex = (loopIndex + 1) % totalLoops;
    applyLoopParams();
    window.parent.postMessage({ type: 'guitar-harmonics', harmonics: nhSteps[loopIndex], maxHarmonics: nhSteps[totalLoops - 1] }, '*');
    if (loopIndex === 0) {
      cancelAnimationFrame(animId);
      traceHistory = [];
      document.getElementById("fourier-group").style.display = "none";
      setTimeout(() => {
        window.parent.postMessage({ type: 'guitar-animation-complete' }, '*');
        lastTime = null;
        animId = requestAnimationFrame(animate);
      }, 1000);
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
