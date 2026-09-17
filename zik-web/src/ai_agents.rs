//! Serves `/llms.txt` to AI assistants that open one of the web app's pages.
//!
//! The pages are a React app, so without JavaScript an assistant only sees an
//! empty shell. Requests from a known AI user agent, or asking for markdown or
//! plain text rather than HTML, are rewritten to the `llms.txt` of the same
//! band before routing. API routes, static files and PDFs are never touched.

use axum::{
    extract::Request,
    http::{HeaderValue, Method, Uri, header},
    middleware::Next,
    response::Response,
};

/// User-agent tokens of AI assistants and their crawlers, lowercase.
const AI_USER_AGENTS: &[&str] = &[
    "chatgpt-user",
    "oai-searchbot",
    "gptbot",
    "claude-user",
    "claude-searchbot",
    "claudebot",
    "perplexity-user",
    "perplexitybot",
];

/// Path prefixes that scope the site to one band.
const BANDS: &[&str] = &["mtl", "sunny-bd", "dadrock"];

/// First path segments (after the band) that are not web app pages.
const NON_PAGE_SEGMENTS: &[&str] = &[
    "api",
    "static",
    "assets",
    "pdf",
    "version",
    "update",
    "edit-lyrics",
    "save-lyrics",
    "save-yml",
];

/// Splits a path into its band prefix, if any, and the remaining segments.
fn band_and_segments(path: &str) -> (Option<&str>, Vec<&str>) {
    let mut segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    match segments.first() {
        Some(first) if BANDS.contains(first) => {
            let band = segments.remove(0);
            (Some(band), segments)
        }
        _ => (None, segments),
    }
}

/// Whether the path renders a web app page, as opposed to an API route or a
/// file (anything whose last segment has an extension).
pub fn is_page_path(path: &str) -> bool {
    let (_, segments) = band_and_segments(path);
    if segments
        .first()
        .is_some_and(|first| NON_PAGE_SEGMENTS.contains(first))
    {
        return false;
    }
    !segments.last().is_some_and(|last| last.contains('.'))
}

/// The `llms.txt` matching a page: the band's own under a band prefix.
pub fn llms_txt_path(path: &str) -> String {
    match band_and_segments(path).0 {
        Some(band) => format!("/{band}/llms.txt"),
        None => "/llms.txt".to_string(),
    }
}

/// Whether the client is an AI assistant, or prefers text over HTML.
pub fn wants_llms_txt(user_agent: Option<&str>, accept: Option<&str>) -> bool {
    let user_agent = user_agent.unwrap_or_default().to_ascii_lowercase();
    if AI_USER_AGENTS.iter().any(|ua| user_agent.contains(ua)) {
        return true;
    }

    // Media types of the Accept header, leaving out the ones refused with q=0.
    let accepted: Vec<&str> = accept
        .unwrap_or_default()
        .split(',')
        .filter_map(|part| {
            let mut params = part.split(';');
            let media_type = params.next()?.trim();
            let refused = params.any(|p| {
                p.trim()
                    .strip_prefix("q=")
                    .and_then(|q| q.trim().parse::<f32>().ok())
                    == Some(0.0)
            });
            (!media_type.is_empty() && !refused).then_some(media_type)
        })
        .collect();
    let accepts = |media_type: &str| accepted.iter().any(|t| t.eq_ignore_ascii_case(media_type));

    accepts("text/markdown") || (accepts("text/plain") && !accepts("text/html"))
}

/// Rewrites page requests from AI assistants to `llms.txt`. Must wrap the
/// router rather than be added with `Router::layer`, which runs after routing.
/// Page responses vary on the headers used to decide, so caches keep the
/// HTML and text versions apart.
pub async fn serve_llms_txt_to_ai(mut request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    if !matches!(*request.method(), Method::GET | Method::HEAD) || !is_page_path(&path) {
        return next.run(request).await;
    }

    // Decided in its own scope: holding a borrow of the request across the
    // await below would make the future non-Send.
    let to_ai = {
        let headers = request.headers();
        let header = |name| headers.get(name).and_then(|v| v.to_str().ok());
        wants_llms_txt(header(header::USER_AGENT), header(header::ACCEPT))
    };
    if to_ai && let Ok(uri) = Uri::try_from(llms_txt_path(&path)) {
        *request.uri_mut() = uri;
    }

    let mut response = next.run(request).await;
    response
        .headers_mut()
        .append(header::VARY, HeaderValue::from_static("User-Agent, Accept"));
    response
}
