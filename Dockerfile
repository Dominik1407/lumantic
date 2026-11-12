# Lumantic as an image: the interface built with Node, the server with Go and
# DuckDB built in, run as a plain user. Settings, tokens and work live in the
# volume /data; a gold layer is mounted read-only, for example at /goldlayer.
# Without settings it starts with the examples. See README «Schnellstart».

FROM node:25-bookworm-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.25-bookworm AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" -o /out/lumantic ./cmd/lumantic \
 && CGO_ENABLED=1 bash scripts/third-party.sh /out/THIRD_PARTY_NOTICES.txt

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --home-dir /home/lumantic --shell /usr/sbin/nologin lumantic \
 && mkdir -p /data /goldlayer \
 && chown lumantic:lumantic /data
COPY --from=server /out/lumantic /usr/local/bin/lumantic
COPY LICENSE NOTICE /usr/share/doc/lumantic/
COPY --from=server /out/THIRD_PARTY_NOTICES.txt /usr/share/doc/lumantic/
ENV LUMANTIC_HOME=/data \
    LUMANTIC_ADDR=0.0.0.0:8080 \
    LUMANTIC_BROWSER=0
USER lumantic
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["lumantic", "health"]
ENTRYPOINT ["lumantic"]
