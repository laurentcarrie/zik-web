use super::song::{Storage, get_all_songs, make_deezer_url, write_all_songs_to_s3};
use super::*;
use aws_config::Region;

const TEST_WORLD_YML: &str = r#"items:
- - Alannah Myles/Black Velvet/song.yml
  - !Song
    files:
      lilypond: []
      tex: []
      wav: []
    info:
      title: Black Velvet
      author: Alannah Myles
      tempo: 92
      tags: []
    meta:
      date: null
      digest: null
    structure: []
- - Test Artist/Test Song/song.yml
  - !Song
    files:
      lilypond: []
      tex: []
      wav: []
    info:
      title: Test Song
      author: Test Artist
      tempo: 120
      tags:
        - rock
    meta:
      date: null
      digest: null
    structure: []
"#;

async fn test_storage() -> Storage {
    let bucket = std::env::var("BUCKET").expect("BUCKET env var must be set for tests");
    let root = std::env::var("BUCKET_ROOT").expect("BUCKET_ROOT env var must be set for tests");
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new("eu-west-3"))
        .load()
        .await;
    let client = Client::new(&config);
    Storage::S3 {
        client,
        bucket,
        root,
    }
}

async fn setup_test_data(storage: &Storage) {
    let key = storage.full_key("songs/world.yml");
    storage
        .put_string(&key, TEST_WORLD_YML, Some("text/yaml"))
        .await
        .expect("Failed to upload test world.yml");
}

async fn teardown_test_data(storage: &Storage) {
    // For S3 mode, delete the test file. For local mode, just remove the file.
    if let Storage::S3 { client, bucket, .. } = storage {
        let key = storage.full_key("songs/world.yml");
        let _ = client.delete_object().bucket(bucket).key(&key).send().await;
    }
}

#[tokio::test]
async fn test_get_all_songs() {
    let storage = test_storage().await;

    setup_test_data(&storage).await;

    let result = get_all_songs(&storage).await;

    teardown_test_data(&storage).await;

    let songs = result.expect("Failed to get songs");

    println!("Found {} songs:", songs.len());
    for s in &songs {
        println!("  - {} by {}", s.title, s.author);
    }

    assert_eq!(songs.len(), 2, "Should have exactly 2 test songs");

    let has_black_velvet = songs
        .iter()
        .any(|s| s.title == "Black Velvet" && s.author == "Alannah Myles");
    assert!(
        has_black_velvet,
        "Should contain Black Velvet by Alannah Myles"
    );

    let has_test_song = songs
        .iter()
        .any(|s| s.title == "Test Song" && s.author == "Test Artist");
    assert!(has_test_song, "Should contain Test Song by Test Artist");
}

#[tokio::test]
#[ignore] // Legacy: all-songs.yml replaced by world.yml
async fn test_write_all_songs_to_s3() {
    let storage = test_storage().await;

    write_all_songs_to_s3(&storage)
        .await
        .expect("Failed to write songs to S3");
}

#[test]
fn test_parse_local_song_yml() {
    use super::song::SongYml;

    let content = std::fs::read_to_string("song.yml").expect("Failed to read song.yml");

    let song: SongYml =
        serde_yaml::from_str(&content).expect("Failed to parse song.yml as SongYml");

    assert!(!song.info.title.is_empty(), "Song title cannot be empty");
    assert!(!song.info.author.is_empty(), "Song author cannot be empty");
    assert!(!song.structure.is_empty(), "Song structure cannot be empty");
    println!(
        "Success! Title: {}, Author: {}",
        song.info.title, song.info.author
    );
}

#[test]
fn test_make_deezer_url() {
    let url = make_deezer_url("ca me vexe", "mademoiselle K");

    assert!(
        url.starts_with("https://www.deezer.com/search/"),
        "Deezer URL should start with search URL"
    );
    assert!(
        url.contains("ca%20me%20vexe"),
        "URL should contain encoded title"
    );
    assert!(
        url.contains("mademoiselle%20K"),
        "URL should contain encoded author"
    );
    println!("Deezer URL: {url}");
}

#[test]
fn test_snippet_names_merges_yml_and_body() {
    let song_yml = r#"
files:
  lilypond:
    - refrain.ly
    - chordscouplet.ly
  tex: []
  mp3: []
info:
  title: Shout
  author: Tears For Fears
  tempo: 96
  time_signature: null
meta:
  date: "2026-08-02"
structure: []
"#;
    let body_tex = r"\input{song.tikz}
\songly{chordscouplet}
\songly{solo}
\lyfile{intro}
";
    let names = crate::song::songs::snippet_names(song_yml, body_tex);
    // declared first, then the ones only the tex pulls in, without duplicates
    assert_eq!(names, vec!["refrain", "chordscouplet", "solo", "intro"]);
}

#[test]
fn test_snippet_names_tolerates_missing_sources() {
    assert!(crate::song::songs::snippet_names("", "").is_empty());
    assert_eq!(
        crate::song::songs::snippet_names("not: [valid", r"\songly{riff_a}"),
        vec!["riff_a"]
    );
}

#[test]
fn test_book_name_of_key() {
    use crate::song::songs::book_name_of_key;
    assert_eq!(
        book_name_of_key("prod/delivery/pdf/book-rock.pdf"),
        Some("rock")
    );
    assert_eq!(
        book_name_of_key("delivery/pdf/book-concert_mai_2026.pdf"),
        Some("concert_mai_2026")
    );
    assert_eq!(
        book_name_of_key("delivery/pdf/alannah_myles--@--black_velvet.pdf"),
        None
    );
    assert_eq!(book_name_of_key("delivery/pdf/book-.pdf"), None);
    assert_eq!(book_name_of_key("delivery/pdf/book-rock.tex"), None);
}

#[tokio::test]
async fn test_get_book_names_and_pdf_local() {
    use crate::song::songs::{get_book_names, get_book_pdf};
    let dir = tempfile::tempdir().unwrap();
    let pdf_dir = dir.path().join("delivery/pdf");
    std::fs::create_dir_all(&pdf_dir).unwrap();
    std::fs::write(pdf_dir.join("book-rock.pdf"), b"rock").unwrap();
    std::fs::write(pdf_dir.join("book-ballads.pdf"), b"ballads").unwrap();
    std::fs::write(pdf_dir.join("alannah_myles--@--black_velvet.pdf"), b"song").unwrap();
    let storage = Storage::Local {
        root: dir.path().to_path_buf(),
    };

    assert_eq!(
        get_book_names(&storage).await.unwrap(),
        vec!["ballads", "rock"]
    );
    assert_eq!(get_book_pdf(&storage, "rock").await.unwrap(), b"rock");
    assert!(get_book_pdf(&storage, "missing").await.is_err());
    assert!(get_book_pdf(&storage, "../secret").await.is_err());
}

#[tokio::test]
async fn test_song_pdf_key_matches_delivered_pdfs() {
    use crate::song::songs::{get_delivered_pdf_keys, song_pdf_key};
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::Local {
        root: dir.path().to_path_buf(),
    };
    let key = song_pdf_key(&storage, "Alannah Myles", "Black Velvet");
    std::fs::create_dir_all(dir.path().join("delivery/pdf")).unwrap();
    std::fs::write(dir.path().join(&key), b"pdf").unwrap();

    let keys = get_delivered_pdf_keys(&storage).await.unwrap();
    assert!(keys.contains(&song_pdf_key(&storage, "Alannah Myles", "Black Velvet")));
    assert!(!keys.contains(&song_pdf_key(&storage, "Amy Winehouse", "Rehab")));
}

fn songbook_song(id: &str, author: &str, title: &str, tags: &[&str]) -> crate::song::SongItem {
    crate::song::SongItem {
        id: id.to_string(),
        title: title.to_string(),
        author: author.to_string(),
        key: String::new(),
        tempo: 100,
        tags: tags.iter().map(|t| t.to_string()).collect(),
        has_song: true,
        has_clicks: false,
        error: None,
    }
}

fn songbook_songs() -> Vec<crate::song::SongItem> {
    vec![
        songbook_song(
            "rhcp--under",
            "Red Hot Chili Peppers",
            "Under The Bridge",
            &["mtl"],
        ),
        songbook_song("amy--rehab", "Amy Winehouse", "Rehab", &["sunny-bd"]),
        songbook_song(
            "rhcp--cant",
            "Red Hot Chili Peppers",
            "Can't Stop",
            &["mtl", "rock"],
        ),
    ]
}

#[test]
fn test_songbook_filter_from_query() {
    use crate::song::songbook::SongbookFilter;
    let f = SongbookFilter::from_query(Some(" a, ,b "), Some("  "), Some("mtl"));
    assert_eq!(f.ids, vec!["a", "b"]);
    assert_eq!(f.author, None);
    assert_eq!(f.tag.as_deref(), Some("mtl"));
    assert_eq!(
        SongbookFilter::from_query(None, Some("Red Hot Chili Peppers"), None).slug(),
        "red-hot-chili-peppers"
    );
    assert_eq!(
        SongbookFilter::from_query(Some("x"), None, None).slug(),
        "selection"
    );
}

#[test]
fn test_select_songs() {
    use crate::song::songbook::{SongbookFilter, select_songs};
    let songs = songbook_songs();
    let ids = |f: SongbookFilter| -> Vec<String> {
        select_songs(&songs, &f)
            .unwrap()
            .iter()
            .map(|s| s.id.clone())
            .collect()
    };

    // author is case-insensitive, and results are sorted by title
    assert_eq!(
        ids(SongbookFilter::from_query(
            None,
            Some("red hot chili peppers"),
            None
        )),
        vec!["rhcp--cant", "rhcp--under"]
    );
    assert_eq!(
        ids(SongbookFilter::from_query(None, None, Some("MTL"))),
        vec!["rhcp--cant", "rhcp--under"]
    );
    // criteria combine
    assert_eq!(
        ids(SongbookFilter::from_query(
            None,
            Some("Red Hot Chili Peppers"),
            Some("rock")
        )),
        vec!["rhcp--cant"]
    );
    // ids keep the order given
    assert_eq!(
        ids(SongbookFilter::from_query(
            Some("amy--rehab,rhcp--under"),
            None,
            None
        )),
        vec!["amy--rehab", "rhcp--under"]
    );

    let err = |f: SongbookFilter| select_songs(&songs, &f).unwrap_err();
    assert!(err(SongbookFilter::default()).contains("at least one"));
    assert!(
        err(SongbookFilter::from_query(
            Some("amy--rehab,nope"),
            None,
            None
        ))
        .contains("nope")
    );
    assert!(
        select_songs(
            &songs,
            &SongbookFilter::from_query(None, Some("Nobody"), None)
        )
        .unwrap()
        .is_empty()
    );
}

fn api_song(id: &str, author: &str, title: &str, tags: &[&str], pdf: bool) -> crate::song::ApiSong {
    let base = "https://move-the-line.org";
    crate::song::ApiSong {
        id: id.to_string(),
        title: title.to_string(),
        author: author.to_string(),
        deezer_url: format!("https://www.deezer.com/search/{id}"),
        deezer_app_url: format!("deezer://www.deezer.com/search/{id}"),
        key: format!("prod/songs/{id}/song.yml"),
        tempo: 90,
        tags: tags.iter().map(|t| t.to_string()).collect(),
        has_song: pdf,
        has_clicks: false,
        pdf_url: pdf.then(|| format!("{base}/api/pdf/{id}")),
        mp3_url: pdf.then(|| format!("{base}/api/mp3/{id}")),
        error: (!pdf).then(|| "bad yaml".to_string()),
    }
}

#[test]
fn test_llms_txt_links_songbooks() {
    let songs = vec![
        api_song(
            "rhcp--under",
            "Red Hot Chili Peppers",
            "Under The Bridge",
            &["mtl"],
            true,
        ),
        api_song("amy--rehab", "Amy Winehouse", "Rehab", &["sunny-bd"], false),
        api_song(
            "rhcp--cant",
            "Red Hot Chili Peppers",
            "Can't Stop",
            &["mtl", "rock"],
            true,
        ),
    ];
    let txt =
        crate::song::songbook::llms_txt("https://move-the-line.org", &songs, &["mtl".to_string()]);
    assert!(txt.contains(
        "- [Red Hot Chili Peppers](https://move-the-line.org/api/songbook?author=Red%20Hot%20Chili%20Peppers): Can't Stop, Under The Bridge"
    ));
    assert!(txt.contains("- [mtl](https://move-the-line.org/api/songbook?tag=mtl): 2 songs"));
    assert!(txt.contains("- [mtl](https://move-the-line.org/api/book/mtl)"));
    assert!(txt.contains("- [Version](https://move-the-line.org/api/version)"));
    // songs without a PDF get no songbook link, but are still listed
    assert!(!txt.contains("?author=Amy%20Winehouse"));
    assert!(!txt.contains("?tag=sunny-bd"));
    assert!(txt.contains("### Amy Winehouse - Rehab"));

    // every field /api/songs serves for a song is in its llms.txt section
    for song in &songs {
        let heading = format!("### {} - {}\n", song.author, song.title);
        let section = txt
            .split(&heading)
            .nth(1)
            .unwrap()
            .split("\n### ")
            .next()
            .unwrap();
        let json = serde_json::to_value(song).unwrap();
        for (name, value) in json.as_object().unwrap() {
            let line = section
                .lines()
                .find(|l| l.starts_with(&format!("- `{name}`: ")))
                .unwrap_or_else(|| panic!("{name} missing for {}", song.id));
            let shown = match value {
                serde_json::Value::String(v) => v.clone(),
                serde_json::Value::Array(v) => v
                    .iter()
                    .map(|t| t.as_str().unwrap())
                    .collect::<Vec<_>>()
                    .join(", "),
                other => other.to_string(),
            };
            assert!(line.contains(&shown), "{line} should show {shown}");
        }
    }
}

/// A valid one-page PDF, with the xref offsets computed.
fn one_page_pdf() -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    ];
    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for (i, obj) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{obj}\nendobj\n", i + 1));
    }
    let xref = pdf.len();
    pdf.push_str(&format!(
        "xref\n0 {}\n0000000000 65535 f \n",
        objects.len() + 1
    ));
    for offset in offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
        objects.len() + 1
    ));
    pdf.into_bytes()
}

#[tokio::test]
async fn test_merge_pdfs() {
    use crate::song::songbook::merge_pdfs;
    assert!(merge_pdfs(vec![]).await.is_err());
    assert_eq!(merge_pdfs(vec![b"only".to_vec()]).await.unwrap(), b"only");
    assert!(
        merge_pdfs(vec![b"not a pdf".to_vec(), b"nope".to_vec()])
            .await
            .is_err()
    );

    let merged = merge_pdfs(vec![one_page_pdf(), one_page_pdf(), one_page_pdf()])
        .await
        .expect("pdfunite (poppler-utils) must be installed");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("merged.pdf");
    std::fs::write(&path, merged).unwrap();
    let info = std::process::Command::new("pdfinfo")
        .arg(&path)
        .output()
        .unwrap();
    let info = String::from_utf8_lossy(&info.stdout);
    assert!(
        info.lines()
            .any(|l| l.starts_with("Pages:") && l.ends_with(" 3")),
        "{info}"
    );
}

#[test]
fn test_ai_agents_page_paths() {
    use crate::ai_agents::{is_page_path, llms_txt_path};
    for page in [
        "/",
        "/mtl",
        "/mtl/",
        "/mtl/song/abc",
        "/sunny-bd/songs",
        "/root",
        "/press-book",
    ] {
        assert!(is_page_path(page), "{page} is a page");
    }
    for not_page in [
        "/api/songs",
        "/mtl/api/songbook",
        "/static/favicon.ico",
        "/assets/index-abc.js",
        "/llms.txt",
        "/mtl/llms.txt",
        "/pdf",
        "/version",
    ] {
        assert!(!is_page_path(not_page), "{not_page} is not a page");
    }
    assert_eq!(llms_txt_path("/"), "/llms.txt");
    assert_eq!(llms_txt_path("/songs"), "/llms.txt");
    assert_eq!(llms_txt_path("/mtl/song/abc"), "/mtl/llms.txt");
    assert_eq!(llms_txt_path("/dadrock"), "/dadrock/llms.txt");
}

#[test]
fn test_ai_agents_detection() {
    use crate::ai_agents::wants_llms_txt;
    let chrome = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
    let browser_accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

    assert!(wants_llms_txt(
        Some(
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"
        ),
        Some(browser_accept)
    ));
    assert!(wants_llms_txt(
        Some("Claude-User/1.0 (+Claude-User@anthropic.com)"),
        None
    ));
    assert!(wants_llms_txt(
        Some("Mozilla/5.0 (compatible; PerplexityBot/1.0)"),
        None
    ));
    assert!(wants_llms_txt(
        Some(chrome),
        Some("text/markdown, text/html")
    ));
    assert!(wants_llms_txt(None, Some("text/plain")));

    assert!(!wants_llms_txt(Some(chrome), Some(browser_accept)));
    assert!(!wants_llms_txt(Some("curl/8.5.0"), Some("*/*")));
    assert!(!wants_llms_txt(None, None));
    assert!(!wants_llms_txt(None, Some("text/plain, text/html")));
    assert!(!wants_llms_txt(None, Some("text/markdown;q=0, text/html")));
}

#[tokio::test]
async fn test_ai_agents_middleware_rewrites_pages() {
    use axum::{body::Body, http::Request as HttpRequest, routing::get};
    use tower::{Layer, ServiceExt};

    let router = axum::Router::new()
        .route("/llms.txt", get(|| async { "llms" }))
        .route("/mtl/llms.txt", get(|| async { "mtl llms" }))
        .route("/api/songs", get(|| async { "json" }))
        .fallback(|| async { "html" });
    let app = axum::middleware::from_fn(crate::ai_agents::serve_llms_txt_to_ai).layer(router);

    let fetch = |path: &str, user_agent: &str| {
        let app = app.clone();
        let request = HttpRequest::get(path)
            .header("user-agent", user_agent)
            .body(Body::empty())
            .unwrap();
        async move {
            let response = app.oneshot(request).await.unwrap();
            let vary = response
                .headers()
                .get("vary")
                .map(|v| v.to_str().unwrap().to_string());
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            (String::from_utf8(body.to_vec()).unwrap(), vary)
        }
    };
    let vary = Some("User-Agent, Accept".to_string());

    assert_eq!(
        fetch("/", "ChatGPT-User/1.0").await,
        ("llms".to_string(), vary.clone())
    );
    assert_eq!(
        fetch("/mtl/songs", "Claude-User/1.0").await,
        ("mtl llms".to_string(), vary.clone())
    );
    assert_eq!(
        fetch("/mtl/songs", "Mozilla/5.0 Chrome/140.0").await,
        ("html".to_string(), vary)
    );
    // API routes are left alone, and don't vary
    assert_eq!(
        fetch("/api/songs", "ChatGPT-User/1.0").await,
        ("json".to_string(), None)
    );

    // Whatever was served, it is not for an index.
    for (path, user_agent) in [
        ("/", "ChatGPT-User/1.0"),
        ("/mtl/songs", "Mozilla/5.0 Chrome/140.0"),
        ("/api/songs", "GPTBot/1.1"),
    ] {
        let request = HttpRequest::get(path)
            .header("user-agent", user_agent)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(
            response.headers().get("x-robots-tag").unwrap(),
            "noindex, nofollow",
            "{path} is not indexable"
        );
    }
}

#[test]
fn test_robots_txt_welcomes_assistants_and_refuses_crawlers() {
    let txt = crate::ai_agents::robots_txt();
    // The group a bot obeys: from the first rule after its own User-agent
    // line to the blank line that ends the group.
    let group_of = |agent: &str| -> String {
        let at = txt
            .find(&format!("User-agent: {agent}\n"))
            .unwrap_or_else(|| panic!("{agent} has no group in:\n{txt}"));
        let rest = &txt[at..];
        let start = [rest.find("\nAllow"), rest.find("\nDisallow")]
            .into_iter()
            .flatten()
            .min()
            .expect("a group has rules");
        let rules = &rest[start..];
        let end = rules.find("\n\n").map_or(rules.len(), |blank| blank + 1);
        rules[..end].to_string()
    };

    // A bot fetching for a person may read the songbook, and so may anything
    // whose user agent we do not recognise.
    for welcome in ["ChatGPT-User", "Claude-User", "Perplexity-User", "*"] {
        let rules = group_of(welcome);
        assert!(rules.contains("\nAllow: /\n"), "{welcome} may read: {rules}");
        // ... apart from the editing tools, at the root and under every band.
        for path in ["/edit-yml/", "/mtl/edit-yml/", "/dadrock/api/s3/"] {
            assert!(
                rules.contains(&format!("\nDisallow: {path}\n")),
                "{welcome} is kept out of {path}"
            );
        }
        // Nothing an assistant needs is behind a Disallow.
        let disallowed: Vec<&str> = rules
            .lines()
            .filter_map(|line| line.strip_prefix("Disallow: "))
            .collect();
        for open in [
            "/llms.txt",
            "/mtl/llms.txt",
            "/api/songs",
            "/api/books",
            "/api/songbook",
            "/api/pdf/rhcp--dani_california",
            "/api/mp3/rhcp--dani_california",
        ] {
            assert!(
                !disallowed.iter().any(|path| open.starts_with(path)),
                "{welcome} can still reach {open}"
            );
        }
    }

    // A bot that crawls for an index or a training set gets nothing.
    for crawler in [
        "GPTBot",
        "OAI-SearchBot",
        "ClaudeBot",
        "Claude-SearchBot",
        "PerplexityBot",
        "Googlebot",
        "Google-Extended",
        "CCBot",
        "Bytespider",
    ] {
        assert_eq!(group_of(crawler), "\nDisallow: /\n", "{crawler} is refused");
    }

    // No sitemap: it would exist only to invite the crawl we just refused.
    assert!(!txt.contains("Sitemap:"), "{txt}");
}

#[tokio::test]
async fn test_song_mp3_key_matches_song_sources() {
    use crate::song::songs::{get_song_source_keys, song_mp3_key};
    assert_eq!(
        song_mp3_key("prod/songs/muse/can_t_take_my_eyes_off_you/song.yml"),
        "prod/songs/muse/can_t_take_my_eyes_off_you/song.mp3"
    );

    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::Local {
        root: dir.path().to_path_buf(),
    };
    for file in [
        "muse/uprising/song.yml",
        "muse/uprising/song.mp3",
        "police/roxanne/song.yml",
    ] {
        let path = dir.path().join("songs").join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    let keys = get_song_source_keys(&storage).await.unwrap();
    assert!(keys.contains(&song_mp3_key("songs/muse/uprising/song.yml")));
    assert!(!keys.contains(&song_mp3_key("songs/police/roxanne/song.yml")));
}
