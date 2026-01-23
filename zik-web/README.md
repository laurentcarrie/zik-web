# zik-web

A web application for managing and viewing song sheets, built with Rust/Axum backend and React/Tailwind frontend.

## Features

- **Songs Page**: Browse all songs with search and sorting
  - Fuzzy search
  - Sort by title or author
  - Mobile-friendly design
- **Song Detail Page**: View song with action buttons
  - PDF viewer
  - Deezer (Web) link
  - Deezer (App) link for Android
- **Edit Pages**: Multiple editors with syntax highlighting
  - Edit YML: YAML editor with validation
  - Edit Lilypond: .ly file editor
  - Edit Lyrics: Lyrics text editor
  - Edit TeX: LaTeX editor
- **Master Page**: Song compilation workflow
- **Update Page**: Trigger S3 sync
- **PDF Viewer**: View song PDFs directly from S3

## Tech Stack

- **Backend**: Rust with Axum web framework
- **Frontend**: React + Vite + Tailwind CSS
- **Storage**: AWS S3 for songs, PDFs, and static assets
- **CDN**: CloudFront for serving PDFs, photos, and videos
- **Deployment**: AWS App Runner with multi-stage Docker build

## Running Locally

### Backend
```bash
cd zik-web
AWS_PROFILE=zik-laurent cargo run
```
Server runs at http://localhost:8080

### Frontend (development)
```bash
cd frontend
npm install
npm run dev
```
Dev server runs at http://localhost:3000 (proxies API to backend)

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/songs` | JSON list of all songs |
| `/api/song/:id` | Single song JSON |
| `/api/pdf/:id` | PDF file for song |
| `/version` | Current version |
| `/update` | Sync songs from S3 |

## Project Structure

```
zik-web/
  src/
    main.rs      - API routes and handlers
    edit.rs      - Edit page handlers
    update.rs    - Update endpoint
    song/
      mod.rs       - Song module exports
      model.rs     - Song data structures
      songs.rs     - S3 operations and song listing
      edit_lyrics.rs - Lyrics editing handlers

frontend/
  src/
    pages/       - React page components
      EditYmlPage.tsx
      EditLilypondPage.tsx
      EditLyricsPage.tsx
      EditTexPage.tsx
      MasterPage.tsx
      UpdatePage.tsx
    components/  - Reusable UI components
    api/         - API client functions
```

## Deployment

Build and deploy with the production Dockerfile:
```bash
docker build -f Dockerfile.production -t zik-web .
```
