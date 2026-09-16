# zik-web

A web application for managing and viewing song sheets, built with Rust/Axum backend and React/Tailwind frontend.

## Features

- **Songs Page**: Browse all songs with search and sorting
  - Fuzzy search
  - Sort by title or author
  - Filter by tags
  - Error songs highlighted in red
  - Mobile-friendly design
- **Song Detail Page**: View song with action buttons (dark theme)
  - PDF and lyrics PDF viewer
  - Tempo button (Strudel REPL with drum pattern)
  - Deezer / Spotify links (Web and App)
  - Build trigger with live Lambda status (elapsed time while running)
- **Edit Pages**: Multiple editors with syntax highlighting
  - Edit YML: YAML editor with validation (validates Song structure on save)
  - Edit Lilypond: .ly file editor
  - Edit Lyrics: Lyrics text editor
  - Edit TeX: LaTeX editor
- **Settings Page**: Music service preferences, Re-index songs (dark theme dialogs)
  - Animation toggle and configuration (contour selection, speed, trace, harmonics, points)
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
BUCKET=<bucket> BUCKET_ROOT=dev AWS_PROFILE=<profile> WRITE_PASSWORD=<password> cargo run
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
| `/api/songs` | JSON list of all songs (from world.yml), with an absolute `pdf_url` when the PDF is delivered |
| `/api/song/:id` | Single song detail with PDF/tempo URLs |
| `/api/song/:id/yml` | Song YAML source |
| `/api/pdf/:id` | PDF file for song |
| `/api/pdf-lyrics/:id` | Lyrics PDF file |
| `/api/pdf-snippet/:id/:name` | PDF file for a song snippet |
| `/pdf?author=&title=` | PDF file for song, looked up by author and title |
| `/api/books` | JSON list of delivered books (`name`, absolute `url`) |
| `/api/songbook?author=&tag=&ids=` | One PDF merging the selected songs |
| `/llms.txt` | Guide for AI assistants, with ready songbook links |
| `/api/book/:name` | PDF file for a book (`delivery/pdf/book-<name>.pdf`) |
| `/api/invoke-build` | Trigger Lambda build (auth required) |
| `/api/world` | Re-index songs to world.yml (auth required) |
| `/api/guitar-embed/:index` | Generate Fourier animation embed HTML |
| `/api/animations` | GET/POST animation configuration |
| `/api/config` | Runtime config (favicon) |
| `/api/lambda-status` | Lambda build status |
| `/version` | Current version |

### Fetching PDFs

Song IDs have the form `author--title` (lowercase, underscores) and are listed by `/api/songs`.
`/api/song/:id` returns `pdf_url`, `pdf_lyrics_url` and a `snippets` array with each snippet's `pdf_url`.

Examples on the live site:

```
https://move-the-line.org/api/pdf/alannah_myles--black_velvet
https://move-the-line.org/api/pdf-lyrics/alannah_myles--black_velvet
https://move-the-line.org/api/pdf-snippet/alannah_myles--black_velvet/solo
https://move-the-line.org/pdf?author=Alannah%20Myles&title=Black%20Velvet
```

Books are collections of songs built by band-songbook into `delivery/pdf/book-<name>.pdf`.
`/api/books` lists them, and `/api/book/<name>` returns the PDF.

### Songbooks and AI assistants

`/api/songbook` merges song PDFs on the server with `pdfunite` (poppler-utils, installed in the
production image and needed locally for the tests). Songs are selected by:

- `author`: every song by that author, case-insensitive
- `tag`: every song with that tag
- `ids`: comma-separated song ids, merged in the order given

Criteria combine; without `ids`, songs are sorted by author then title. Songs without a delivered
PDF are skipped, and a songbook holds at most 100 songs. Under a band prefix (`/mtl/api/songbook`)
only that band's songs are selectable.

```
https://move-the-line.org/api/songbook?author=Red%20Hot%20Chili%20Peppers
https://move-the-line.org/api/songbook?ids=red_hot_chili_peppers--under_the_bridge,alannah_myles--black_velvet
```

AI assistants usually can't download files into their code sandbox, so they can't merge PDFs
themselves. `/llms.txt` (see https://llmstxt.org) explains the endpoints and lists a songbook link
for every author and tag, plus a link to every song PDF. An assistant only has to pick a link and
hand it to the user. URLs returned by `/api/songs`, `/api/books` and `/llms.txt` are absolute,
built from the request's `Host` and `X-Forwarded-Proto` headers.

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
