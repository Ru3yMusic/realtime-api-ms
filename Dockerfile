# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN addgroup -S rubymusic && adduser -S rubymusic -G rubymusic

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=build /app/avro ./avro

RUN chown -R rubymusic:rubymusic /app

USER rubymusic

# REST API
EXPOSE 3002

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3002/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["node", "dist/main"]
