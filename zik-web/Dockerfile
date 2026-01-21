FROM rust:1.92 as builder

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src ./src

RUN cargo build --release

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/zik-web /usr/local/bin/zik-web
COPY static ./static

EXPOSE 8080

CMD ["zik-web"]
