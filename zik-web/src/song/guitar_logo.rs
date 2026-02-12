use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;

use super::songs::{BUCKET, make_cloudfront_url};

const CONTOUR_KEYS: &[&str] = &[
    "static/move-the-line.yml",
    "static/band2.yml",
    "static/band.yml",
    "static/stratocaster.yml",
    "static/guitar.yml",
    "static/guitar2.yml",
];

pub const CONTOUR_COUNT: usize = CONTOUR_KEYS.len();

pub fn contour_names() -> Vec<String> {
    CONTOUR_KEYS
        .iter()
        .map(|k| {
            k.trim_start_matches("static/")
                .trim_end_matches(".yml")
                .to_string()
        })
        .collect()
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct AnimationConfig {
    pub show_contour: Option<bool>,
    pub speed: Option<f64>,
    pub show_trace: Option<bool>,
    pub trace_length: Option<usize>,
    pub show_nh: Option<bool>,
    pub trace_width: Option<f64>,
    pub interpolation: Option<usize>,
}

impl Default for AnimationConfig {
    fn default() -> Self {
        Self {
            show_contour: Some(false),
            speed: Some(3.0),
            show_trace: Some(true),
            trace_length: Some(400),
            show_nh: Some(true),
            trace_width: Some(0.3),
            interpolation: Some(1000),
        }
    }
}

pub async fn write_guitar_embed_to_s3(
    client: &Client,
    index: usize,
    config: &AnimationConfig,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let contour_key = CONTOUR_KEYS.get(index).ok_or_else(|| {
        format!(
            "invalid contour index {index}, max is {}",
            CONTOUR_KEYS.len() - 1
        )
    })?;

    let resp = client
        .get_object()
        .bucket(BUCKET)
        .key(*contour_key)
        .send()
        .await?;

    let bytes = resp.body.collect().await?.into_bytes();
    let yaml = String::from_utf8(bytes.to_vec())?;

    let contour: fluffy::model::Contour = serde_yaml::from_str(&yaml)?;
    let contour = fluffy::model::interpolate(&contour, config.interpolation.unwrap_or(1000));
    let svg_path = fluffy::svg::svg_path_of_contour(&contour);
    let max_terms = contour.points.len() / 2;
    let fd = fluffy::model::fourier_decomposition(&contour, max_terms);
    let show_trace = config.show_trace.unwrap_or(true);
    // Compute viewBox size to scale trace_width (user value is percentage of viewBox)
    let (min_x, min_y, max_x, max_y) = contour.points.iter().fold(
        (f64::MAX, f64::MAX, f64::MIN, f64::MIN),
        |(mn_x, mn_y, mx_x, mx_y), p| (mn_x.min(p.0), mn_y.min(p.1), mx_x.max(p.0), mx_y.max(p.1)),
    );
    let size = (max_x - min_x).max(max_y - min_y);
    let vb_size = size * 1.2;
    let trace_width_pct = config.trace_width.unwrap_or(0.3);
    let opts = fluffy::svg::EmbedOptions {
        speed: config.speed.unwrap_or(3.0),
        steps: fluffy::svg::HarmonicSteps {
            thresholds: vec![(10, 1), (20, 5), (100, 10)],
            final_step: 100,
        },
        show_contour: config.show_contour.unwrap_or(false),
        hide_point: false,
        hide_trace: !show_trace,
        trace_length: config.trace_length.unwrap_or(400),
        opacity: 1.0,
        show_nh: config.show_nh.unwrap_or(true),
        trace_width: trace_width_pct * vb_size / 100.0,
    };
    let html = fluffy::svg::embed_html_of_svg_path_with_fourier(
        &svg_path,
        &contour.points,
        Some(&fd),
        &opts,
    );
    let html = html.replace("background:black", "background:transparent");
    // Inject postMessage to report harmonics and signal completion with contour reveal pause
    let html = html.replace(
        "loopIndex = (loopIndex + 1) % totalLoops;\n    applyLoopParams();",
        r#"loopIndex = (loopIndex + 1) % totalLoops;
    applyLoopParams();
    window.parent.postMessage({ type: 'guitar-harmonics', harmonics: nhSteps[loopIndex], maxHarmonics: nhSteps[totalLoops - 1] }, '*');
    if (loopIndex === 0) {
      cancelAnimationFrame(animId);
      const cp = document.getElementById("contour-path");
      const savedDisplay = cp ? cp.style.display : "";
      const cpParent = cp ? cp.parentNode : null;
      const cpNext = cp ? cp.nextSibling : null;
      if (cp) { cp.style.display = ""; cpParent.appendChild(cp); }
      setTimeout(() => {
        if (cp) { cp.style.display = savedDisplay; cpNext ? cpParent.insertBefore(cp, cpNext) : cpParent.appendChild(cp); }
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
    let key = format!("delivery/guitar-embed-{index}-{hash:x}.html");
    client
        .put_object()
        .bucket(BUCKET)
        .key(&key)
        .body(ByteStream::from(html.into_bytes()))
        .content_type("text/html")
        .cache_control("no-cache, no-store, must-revalidate")
        .send()
        .await?;

    Ok(make_cloudfront_url(&key))
}
