# zik-web

A web application for managing and viewing song sheets for the Move The Line band.

## Project Structure

The main application is in the `zik-web/` subdirectory - a Rust web server built with Axum.

See [zik-web/README.md](zik-web/README.md) for details.

## Quick Start

```bash
# Backend
cd zik-web
BUCKET=<bucket> BUCKET_ROOT=dev AWS_PROFILE=<profile> WRITE_PASSWORD=<password> cargo run

# Frontend (in another terminal)
cd frontend
npm run dev
```

Backend runs at http://localhost:8080, frontend at http://localhost:3000

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BUCKET` | S3 bucket name (required) |
| `BUCKET_ROOT` | S3 key prefix for environment isolation (`dev`, `prod`) (required) |
| `AWS_PROFILE` | AWS credentials profile (for local dev) |
| `WRITE_PASSWORD` | Password for write operations |
| `NOTIFICATION_EMAIL` | Email for build notifications |
| `SENDER_EMAIL` | SES sender email |
| `FAVICON` | Custom favicon path (e.g. `/static/favicon-dev-32x32.png`) |
