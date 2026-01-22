# Changelog

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
