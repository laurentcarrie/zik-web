# Changelog

## [0.24.0] - 2026-02-21

### Added
- Click sync: shared metronome via WebSocket with session-based rooms
- HtmlSong page: chord grid with songbook fonts, section colors, bar tracking
- HtmlSong page: lyrics rendering with LaTeX macro support (songwordfb, songwordl, songwordcount, songbookcomment, color)
- HtmlSong page: visual lead (150ms) for beat display ahead of audio clicks
- HtmlSong page: BPM slider, sound toggle, dark/light mode toggle
- HtmlSong page: prev/next song navigation
- HtmlSong page: Start/Stop, Grid, Lyrics toggle buttons (equal-sized grid layout)
- HtmlSong page: small duplicate controls before the active section
- HtmlSong page: count-in bar when starting from a section click
- HtmlSong page: downbeat flash on active section title (toggleable via lightning button)
- HtmlSong page: metronome dots display on active section, auto-stop at last bar
- HtmlSong page: next section lyrics preview below active section
- Click sync session management: modal with session cards showing name, client count, BPM, running status, active song
- Click sync: song and bar sync across clients in the same session
- Click sync: cookie-based session persistence with disconnect button
- Click sync sessions page and per-session WebSocket routes
- ClickSync backend: broadcast channel for state sync, clock offset calibration via Ping/Pong
- SongDetailPage: renamed HTML button to "Grid & Lyrics" with grid+text icon
- SongDetailPage: grouped PDF/Lyrics/Edit/Build buttons together
- Fargate + ALB dev and prod stacks with WebSocket support
- Press book auth guard
- Makefile for common dev operations
- Band-specific session names (Repet - Move The Line, Repet - Sunny Bd)
- "Whoever" session for mtl, selectable without edit mode

### Changed
- SongDetailPage: removed standalone metronome buttons (moved to HtmlSong page)
- Settings page: session selector converted to modal with Join button
- For mtl band: sessions locked unless edit mode enabled (except "Whoever")
- Navigating to different song via prev/next stops metronome, resets bar, syncs to session

### Fixed
- Cross-tab session interference: cookie shared across tabs caused session switching (fixed with useState initializer)
- Metronome stopping when new client joins session (backend subscribe ordering, frontend song push logic)
- Count-in bar off by one on remote clients (send correct bar number)
- Empty session song detection (check null instead of falsy empty string)
- Session Apply button not showing due to cookie sharing between tabs
- Clippy warnings: collapsible if statements in click_sync.rs

## [0.23.3] - 2026-02-17

### Added
- Per-range speed input in animation settings UI
- Embed API response cache to eliminate network delay between animation loops
- Band-aware favicon: extracts band prefix from URL to fetch correct favicon

### Changed
- Deploy-prod only triggers on actual version changes (not any Cargo.toml edit)
- Root URL (/) redirects permanently to /mtl, band picker moved to /root
- Animation trace persists across harmonic iterations instead of resetting
- Faster animation speeds for mtl contours

### Fixed
- Null-check `fourier-group` element to prevent crash on animations without circles
- Deezer favicon path hardcoded to /static instead of using ROUTE_PREFIX

## [0.23.2] - 2026-02-17

### Changed
- Update `circles-sketch` from 0.3.2 to 0.4.0 (`svg` module renamed to `canvas`, `OnceEvery` renamed to `Congruence`, `remainders` renamed to `congruents`)
- Make deploy-prod workflow manual-only (`workflow_dispatch`), remove auto-trigger on Cargo.toml push

## [0.23.0] - 2026-02-16

### Added
- Multi-band support: serve mtl and sunny-bd under separate URL prefixes
- Landing page to choose between bands
- Configurable route prefix via `ROUTE_PREFIX` / `VITE_ROUTE_PREFIX` env vars
- Shared `API_BASE` config for frontend API calls
- Band-specific static assets (favicons, backgrounds, animations, SVGs)
- Help modals: TeX macros on Edit Lyrics page, song.yml structure on Master page
- i18n translations for help modals (English and French)
- Sunny-bd band with dedicated animations, favicon ('s' in Fontskrivan font), and background

### Changed
- All routes nested under band prefix (`/mtl/...`, `/sunny-bd/...`)
- Dark theme applied to all edit pages
- Sparkle point scaled down on desktop (non-mobile) screens
- Animation SVG paths resolved relative to band directory
- Spin animation keyframe colors use CSS custom properties (darker for sunny-bd)
- ActionButton prefixes internal links with route prefix

### Fixed
- Internal href links missing ROUTE_PREFIX for multi-band routing
- Fourier circles disappearing after loop transitions when `show_fourier_circles: Always`
- Sparkle point not moving (CSS transform overwritten by JS setAttribute)

## [0.21.0] - 2026-02-14

### Added
- Dev deployment workflow with separate App Runner service
- Dev favicon (red-bordered) configurable via `FAVICON` env var
- `/api/config` endpoint for runtime configuration (favicon)
- Animation error banner in UI instead of silent failures
- SvgPath animation support: read SVG files from disk with `flip_y` option
- MTL SVG animation (Potrace-traced image)
- Zapfino font animation entry
- `num_points` configuration in `embed_options` for animations
- Enabled animations filter (cookie-based, per-user)
- Animation settings dark theme matching rest of UI
- Save & Apply button prompts for password and shows "Saved!" feedback
- Guitar SVG animation (Potrace-traced, merged single path)
- Dark theme for all dialogs (Rendering Settings, Drum Patterns, Build Report, Log Modal)
- Dark theme for Song Detail and Songs pages

### Changed
- `circles-sketch` dependency switched from local path to crates.io v0.2.2
- `.cargo/config.toml` patch for local development override
- S3 keys prefixed with `BUCKET_ROOT` env var for environment isolation
- Animation loop: hide Fourier circles and clear trace at end, 1s pause
- Lazy-load routes for better initial page load
- `SvgPath` type changed from string to struct with `path` and `flip_y` fields
- `band-songbook` dependency updated to v0.0.19
- Animation settings dialog uses dark theme
- Responsive animation on mobile and tablet
- Deezer/Spotify button colors adjusted for dark backgrounds
- Build status shows only elapsed time while running, full details when idle
- Removed S3 font download (font served from static/)

### Removed
- MTL animation entry

### Fixed
- Docker fontconfig installation for font rendering in containers
- Missing `BUCKET` env var in App Runner update step causing silent rollbacks
- Clippy warnings: needless borrows, type complexity
- Animation dialog crash when switching between SvgPath animations

## [0.18.0] - 2026-02-11

### Added
- Song indexing via `world.yml` with Re-index button on settings page
- Error songs shown in red in song list, with parse error details on song page
- Song YAML validation on save from Master editor
- Tempo button with metronome icon, generates Strudel REPL HTML in S3 delivery
- CloudFront distribution and Lambda function in CloudFormation template
- Rotating color-cycling background logo

### Changed
- Song list now sourced from `world.yml` instead of `all-songs.yml`
- Song IDs derived from filesystem path (stable, deterministic) instead of random UUIDs
- `band-songbook` dependency switched from local path to crates.io v0.0.18
- CloudFront URL updated to new distribution
- PDF button no longer gated by `pdfEnabled` setting

### Fixed
- Adapted to `file_stem_of_song()` rename in band-songbook v0.0.18
- Legacy `write_all_songs_to_s3` test marked as ignored

## [0.15.0] - 2026-02-08

### Added
- Email notifications when build is triggered (AWS SES)
- In-memory tracking for immediate build status feedback
- Continuous lambda status polling every 5 seconds
- PDF previews auto-refresh after build completes
- "PDF missing" / "Lyrics PDF missing" placeholders when files don't exist
- `lambda-status.sh` script to check Lambda status from command line

### Changed
- Lambda status detection now uses log events instead of CloudWatch metrics (faster)
- PDFs now served from `delivery/` path instead of `sandbox/`
- Both PDF and lyrics PDF handled consistently (existence check before returning URL)
- Environment variables for secrets: `WRITE_PASSWORD`, `NOTIFICATION_EMAIL`, `SENDER_EMAIL`
- GitHub Actions workflow updated to pass secrets to App Runner

### Removed
- CloudWatch metrics client (no longer needed)
- `make_cloudfront_pdf_url()` function (unused)

### Fixed
- Build status "running" indicator now updates immediately when build starts
- Build message cleared when navigating between songs

## [0.14.0] - 2026-01-23

### Changed
- Deezer app URL now uses `deezer://` protocol for native app launch
- Deezer URLs now include `/track` suffix for direct track search
- Deezer icon replaced with official favicon (purple heart)
- Deezer web button background changed to dark (#191414) for better icon visibility
- Spotify web search URL now includes `/tracks` filter

### Added
- Deezer favicon asset (`deezer-favicon.ico`)

## [0.13.0] - 2026-01-23

### Fixed
- App Runner IAM policies now reference correct S3 bucket name

## [0.12.0] - 2026-01-23

### Changed
- Dependency updates (Cargo.lock refresh)

## [0.11.0] - 2026-01-23

### Added
- CloudFront CDN integration for serving static assets
- `make_cloudfront_pdf_url()` and `make_cloudfront_url()` helper functions

### Changed
- S3 bucket renamed
- PDFs now served via CloudFront instead of backend proxy
- Press-book photos and videos served via CloudFront
- Frontend loads media directly from CloudFront URLs

## [0.10.0] - 2026-01-22

### Added
- Edit YML page with CodeMirror YAML editor and live validation
- Edit Lilypond page for .ly files with syntax highlighting
- Edit Lyrics page for lyrics editing
- Edit TeX page for .tex files with LaTeX syntax highlighting
- Master page for song compilation workflow
- Update page for triggering S3 sync
- PressBook page enhancements with concert PDF support
- Song module refactoring with model.rs, edit_lyrics.rs

### Changed
- Backend refactored: songs.rs moved to song/ module
- Improved API types with additional song metadata
- Enhanced SongsPage with better navigation
- Vite config updated with additional proxy routes

## [0.9.0] - 2026-01-22

### Added
- Settings gear button on song detail page

### Changed
- Edit page back button now uses browser history (history.back())
- Updated Dockerfile to use Rust 1.88

### Fixed
- Back button navigation using history.back() properly
- Borrow checker issue in Deezer URL functions

## [0.8.0] - 2026-01-22

### Added
- Version number displayed in Settings page (fetched from /version endpoint)
- /version endpoint proxied in vite config for development

### Changed
- Songs page now mobile-friendly: title/author stack vertically on small screens
- Deezer search URLs use query parameter format (?q=)
- Spotify search URLs use path format with proper encoding
- Improved version text readability on mobile

## [0.7.0] - 2026-01-22

### Added
- Settings page with music service preferences (Deezer/Spotify Web/App)
- Settings stored in cookies for persistence
- Edit button on song detail page linking to edit-yml
- Icon buttons: PDF, Deezer, Spotify, and Edit with SVG icons
- Home page icon navigation (scroll icon for Songs, gear for Settings)

### Changed
- Sort buttons now show inactive state as faint but visible
- Odd rows in songs list now use light green background
- All action buttons are uniform size
- Removed unused legacy HTML handlers (cleanup)

## [0.6.0] - 2026-01-22

### Added
- React + Tailwind CSS frontend in `frontend/` directory
- JSON API endpoints: `/api/songs`, `/api/song/:id`, `/api/pdf/:id`
- CORS support for development
- Multi-stage `Dockerfile.production` for optimized builds
- Mobile-first responsive design with touch-friendly buttons

### Changed
- Frontend migrated from server-rendered HTML to React SPA
- Deezer URLs now generated dynamically with `/track` suffix
- PDF endpoint uses song ID instead of title/author parameters
- Legacy HTML routes moved to `/legacy/*` prefix
- Deploy workflow updated to build from repo root

## [0.5.0] - 2026-01-22

### Added
- UUID field in SongEntry for stable song URLs
- Two Deezer buttons: "Deezer (Web)" for browsers, "Deezer (App)" for Android app

### Changed
- Song URLs now use UUID instead of array index (`/song/:uuid`)
- Deezer URL format uses path-based `/search/{query}` for web compatibility

## [0.4.0] - 2026-01-22

### Changed
- Renamed "grilles" to "songs" throughout (endpoint, function, page title)
- Main menu simplified to single "Songs" link with Fontskrivan font styling
- Songs list now links to /song/:id detail page instead of inline buttons
- Song detail page shows PDF and Deezer buttons (removed Edit YML button)
- Deezer URL format changed from `/search/{query}` to `/search?q={query}` for Android compatibility

### Removed
- Paroles, Deezer, and Edit links from main menu

## [0.3.0] - 2026-01-22

### Added
- Font (skriva-3.woff) now stored in S3 and downloaded on server startup
- Song detail page at /song/:id with Edit YML and View PDF buttons
- Edit YML page with CodeMirror syntax highlighting and YAML validation
- Custom YAML schema support for tags (!Chords, !Lyrics, etc.)
- Edit lyrics page for .tex files with LaTeX syntax highlighting
- PDF endpoint to serve PDF files from S3
- Edit page listing all songs for editing
- Deezer button for each song linking to Deezer search
- deezer_url field in SongEntry
- make_deezer_url helper function
- PDF and Deezer buttons in grilles page
- Alternating row colors (lightpink/lavender) in grilles page

### Changed
- Grilles page now shows PDF and Deezer buttons instead of linking song title to PDF
- Refactored code into modules: edit.rs, update.rs

## [0.2.0] - 2026-01-21

### Added
- Custom Fontskrivan font for song titles
- Search functionality with fuzzy matching on grilles page

### Changed
- Song titles now display in bold blue with Fontskrivan font
- Author names now display in orange
- Refactored songs logic into separate module

## [0.1.0] - 2026-01-21

### Added
- Initial release
- Landing page with navigation
- Grilles endpoint with S3 song listing
- Sorting by title or author
- Version endpoint
- Update endpoint for S3 sync
- Static file serving for assets
