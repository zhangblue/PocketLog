FROM node:22-alpine AS frontend-deps
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci

FROM frontend-deps AS frontend-build
COPY frontend/ ./
RUN npm run build

FROM rust:1.88-bookworm AS rust-build
WORKDIR /src
COPY backend/Cargo.toml backend/Cargo.lock* ./backend/
COPY backend/src ./backend/src
RUN cargo build --manifest-path backend/Cargo.toml --release

FROM debian:bookworm-slim AS runtime
RUN useradd --system --create-home --uid 10001 pocket-log
WORKDIR /app
COPY --from=rust-build /src/backend/target/release/pocket-log-backend /usr/local/bin/pocket-log-backend
COPY --from=frontend-build /src/frontend/dist /app/frontend/dist
USER pocket-log
ENV FRONTEND_DIST_DIR=/app/frontend/dist
EXPOSE 3000
ENTRYPOINT ["pocket-log-backend", "serve"]
