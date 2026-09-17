//! What the site tells AI assistants and crawlers.
//!
//! The songbook is meant to be usable by an assistant someone points at it,
//! and to stay out of search indexes and training sets. So `robots.txt`
//! welcomes the bots that fetch on a person's behalf and turns away the ones
//! that crawl on their own, every response carries `X-Robots-Tag: noindex`,
//! and there is no sitemap to invite a crawl.
//!
//! The pages are a React app, so without JavaScript an assistant only sees an
//! empty shell. Requests from a known AI user agent, or asking for markdown or
//! plain text rather than HTML, are rewritten to the `llms.txt` of the same
//! band before routing. API routes, static files and PDFs are never touched.

use axum::{
    extract::Request,
    http::{HeaderName, HeaderValue, Method, Uri, header},
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

/// Keeps every response out of search indexes, and rewrites page requests
/// from AI assistants to `llms.txt`. Must wrap the router rather than be added
/// with `Router::layer`, which runs after routing.
///
/// `X-Robots-Tag` goes on everything, pages and files alike: it is what stops
/// a crawler that fetched anyway — ignoring `robots.txt`, or following a link
/// someone shared — from putting the songbook in an index. Page responses also
/// vary on the headers used to pick markdown over HTML, so caches keep the two
/// versions apart.
pub async fn serve_llms_txt_to_ai(mut request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let is_page = matches!(*request.method(), Method::GET | Method::HEAD) && is_page_path(&path);

    // Decided in its own scope: holding a borrow of the request across the
    // await below would make the future non-Send.
    let to_ai = is_page && {
        let headers = request.headers();
        let header = |name| headers.get(name).and_then(|v| v.to_str().ok());
        wants_llms_txt(header(header::USER_AGENT), header(header::ACCEPT))
    };
    if to_ai && let Ok(uri) = Uri::try_from(llms_txt_path(&path)) {
        *request.uri_mut() = uri;
    }

    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("x-robots-tag"),
        HeaderValue::from_static("noindex, nofollow"),
    );
    if is_page {
        headers.append(header::VARY, HeaderValue::from_static("User-Agent, Accept"));
    }
    response
}


/// Bots that fetch a page because a person asked their assistant to open it.
/// They are the whole point of the `llms.txt` setup, so they are welcome.
const USER_DIRECTED_AGENTS: &[&str] = &["ChatGPT-User", "Claude-User", "Perplexity-User"];

/// Bots that crawl on their own to build a search index or a training set.
/// The songbook is for the bands and whoever they hand the link to, not for a
/// public index, so these are turned away wholesale.
const INDEXING_CRAWLERS: &[&str] = &[
    "AhrefsBot",
    "Amazonbot",
    "Applebot",
    "Applebot-Extended",
    "Bingbot",
    "Bytespider",
    "CCBot",
    "Claude-SearchBot",
    "ClaudeBot",
    "DuckAssistBot",
    "FacebookBot",
    "GPTBot",
    "Google-Extended",
    "Googlebot",
    "OAI-SearchBot",
    "PerplexityBot",
    "SemrushBot",
    "YandexBot",
    "anthropic-ai",
    "cohere-ai",
    "meta-externalagent",
];

/// Paths, below the site root and below every band prefix, of the editing
/// tools and the internal endpoints: useful to a band member, noise to
/// anything else. Trailing slash where the path is a prefix of ids.
const AGENT_DISALLOWED: &[&str] = &[
    "/api/content/",
    "/api/lambda-status",
    "/api/make-report",
    "/api/s3/",
    "/click",
    "/edit-clicks/",
    "/edit-drums-global/",
    "/edit-drums/",
    "/edit-lilypond/",
    "/edit-lyrics",
    "/edit-tex/",
    "/edit-yml/",
    "/master/",
    "/save-lyrics",
    "/save-yml",
    "/settings",
    "/update",
];

/// The rules for a bot that may read the songbook: everything but the editing
/// tools.
///
/// Every disallowed path is repeated under each band prefix, because the same
/// pages are served there too and RFC 9309 gives no meaning to a wildcard in
/// the middle of a path. A longer `Disallow` beats the `Allow: /`, so the
/// order of the two does not matter.
fn readable_rules() -> String {
    let mut rules = String::from("Allow: /\n");
    for band in std::iter::once(None).chain(BANDS.iter().map(Some)) {
        let prefix = band.map(|band| format!("/{band}")).unwrap_or_default();
        for path in AGENT_DISALLOWED {
            rules.push_str(&format!("Disallow: {prefix}{path}\n"));
        }
    }
    rules
}

/// Appends one group: its `User-agent` lines, then the rules they share.
fn robots_group(out: &mut String, agents: &[&str], rules: &str) {
    for agent in agents {
        out.push_str(&format!("User-agent: {agent}\n"));
    }
    out.push_str(rules);
    out.push('\n');
}

/// `robots.txt`: an assistant someone points at the site may read it, a
/// crawler building an index or a training set may not.
///
/// No `Sitemap` line and no sitemap to point at — a sitemap exists to invite
/// crawling, and an assistant that is handed the address gets more from
/// `llms.txt` than a list of URLs could give it. Indexing is refused a second
/// time by the `X-Robots-Tag` on every response, which also covers a crawler
/// that fetches without reading this file.
pub fn robots_txt() -> String {
    let readable = readable_rules();
    let mut out = String::from(
        "# Songbook of the bands Move The Line, Sunny Bd and Dadrock.\n\
         #\n\
         # Not meant for a public search index: every response also carries\n\
         # `X-Robots-Tag: noindex, nofollow`. An assistant fetching a page\n\
         # because someone asked it to is welcome — /llms.txt is the whole\n\
         # catalogue, with a PDF and an MP3 link per song.\n\
         \n",
    );

    // Named although the default group below says the same thing, so that the
    // welcome survives a future tightening of that default.
    out.push_str("# Assistants fetching on a person's behalf.\n");
    robots_group(&mut out, USER_DIRECTED_AGENTS, &readable);

    out.push_str("# Crawlers building a search index or a training set.\n");
    robots_group(&mut out, INDEXING_CRAWLERS, "Disallow: /\n");

    out.push_str("# Anything else: welcome to read, never to index.\n");
    robots_group(&mut out, &["*"], &readable);

    out
}
