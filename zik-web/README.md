# zik-web

A web application for managing and viewing song sheets, built with Rust/Axum backend and React/Tailwind frontend.

## Features

- **Songs Page**: Browse all songs with search and sorting
  - Fuzzy search
  - Sort by title or author
  - Filter by tags
  - Error songs highlighted in red
  - Mobile-friendly design
- **Song Detail Page**: View song with action buttons
  - PDF and lyrics PDF viewer
  - Tempo button (Strudel REPL with drum pattern)
  - Deezer / Spotify links (Web and App)
  - Build trigger with live Lambda status
- **Edit Pages**: Multiple editors with syntax highlighting
  - Edit YML: YAML editor with validation (validates Song structure on save)
  - Edit Lilypond: .ly file editor
  - Edit Lyrics: Lyrics text editor
  - Edit TeX: LaTeX editor
- **Settings Page**: Music service preferences, Re-index songs
  - Animation toggle and configuration (contour selection, speed, trace, harmonics)
  - Language selection (English/French)
- **Background Animation**: Fourier epicycle animation cycling through multiple shapes
  - Text animations (any TTF font) and SVG path animations
  - Configurable speed, trace, harmonics, interpolation points
  - Per-user animation selection via cookies
  - Animation settings with dark theme UI
- **Master Page**: Song compilation workflow
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
BUCKET=zik-laurent BUCKET_ROOT=dev AWS_PROFILE=zik-laurent WRITE_PASSWORD=xxx cargo run
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
| `/api/songs` | JSON list of all songs (from world.yml) |
| `/api/song/:id` | Single song detail with PDF/tempo URLs |
| `/api/song/:id/yml` | Song YAML source |
| `/api/pdf/:id` | PDF file for song |
| `/api/pdf-lyrics/:id` | Lyrics PDF file |
| `/api/invoke-build` | Trigger Lambda build (auth required) |
| `/api/world` | Re-index songs to world.yml (auth required) |
| `/api/guitar-embed/:index` | Generate Fourier animation embed HTML |
| `/api/animations` | GET/POST animation configuration |
| `/api/config` | Runtime config (favicon) |
| `/api/lambda-status` | Lambda build status |
| `/version` | Current version |

## Project Structure

```
zik-web/
  src/
    main.rs      - API routes and handlers
    edit.rs      - Edit page handlers
    update.rs    - Update endpoint
    song/
      mod.rs         - Song module exports
      model.rs       - Song data structures
      songs.rs       - S3 operations and song listing
      circles_animation.rs - Fourier animation embed generation
      tempo.rs       - Tempo/strudel HTML generation
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

### Dev deployment
```bash
gh workflow run deploy-dev.yml --ref work
```

### Production deployment
```bash
gh workflow run deploy.yml --ref main
```
