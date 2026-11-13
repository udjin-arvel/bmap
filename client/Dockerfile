FROM node:22-bookworm-slim AS build

WORKDIR /app

# Install deps in Linux only (see root .dockerignore — no host node_modules).
COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ .

ENV VITE_API_URL=/
# Lovable defaults to cloudflare-module; Docker needs a listening Node server.
ENV NITRO_PRESET=node-server

RUN npm run build

FROM node:22-bookworm-slim AS run

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/.output ./.output
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/web-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV HOST=0.0.0.0
ENV NITRO_PORT=3000
ENV PORT=3000

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
