# go-sqlite3 требует CGO, поэтому сборка на Debian-образе с gcc.
FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/bmap-api .

FROM debian:trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/bmap-api /app/bmap-api
ENV SQLITE_PATH=/data/app.db
EXPOSE 8000
CMD ["/app/bmap-api", "-port", "8000"]
