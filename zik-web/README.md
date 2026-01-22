# zik-web

A web application for managing and viewing song sheets, built with Rust and Axum.

## Features

- **Grilles Page**: Browse all songs with PDF and Deezer links
  - Sort by title or author
  - Fuzzy search
  - Alternating row colors
- **Edit Page**: Edit song YAML files with syntax highlighting
  - CodeMirror editor with YAML validation
  - Custom tag support (!Chords, !Lyrics, etc.)
  - Edit lyrics (.tex files) with LaTeX highlighting
- **PDF Viewer**: View song PDFs directly from S3
- **Deezer Integration**: Quick links to search songs on Deezer

## Tech Stack

- **Backend**: Rust with Axum web framework
- **Storage**: AWS S3 for songs, PDFs, and static assets
- **Deployment**: AWS App Runner
- **Frontend**: Server-rendered HTML with CodeMirror for editing

## Running Locally

```bash
AWS_PROFILE=zik-laurent cargo run
```

Server runs at http://localhost:8080

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Landing page |
| `/grilles` | Song list with PDF/Deezer buttons |
| `/edit` | Edit song list |
| `/edit-yml?key=...` | Edit song YAML |
| `/edit-lyrics?author=...&title=...&section=...` | Edit lyrics |
| `/pdf?title=...&author=...` | View PDF |
| `/song/:id` | Song detail page |
| `/update` | Sync songs from S3 |
| `/version` | Current version |

## Project Structure

```
src/
  main.rs    - Routes and handlers
  songs.rs   - S3 operations
  edit.rs    - Edit page handlers
  update.rs  - Update endpoint
  tests.rs   - Tests
```
