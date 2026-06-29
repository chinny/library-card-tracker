# ---- build stage: compile TS -> dist ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: Playwright image ships Chromium + its system deps ----
# Pin the tag to the `playwright` version in package.json so the bundled browser matches.
FROM mcr.microsoft.com/playwright:v1.49.0-noble AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    LIBCARD_DB=/data/library.sqlite \
    HOST=0.0.0.0 \
    PORT=8080
WORKDIR /app

# prod deps only (browsers already present in the base image)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# writable data dir for the SQLite volume, owned by the image's non-root user
RUN mkdir -p /data && chown -R pwuser:pwuser /data
VOLUME ["/data"]
USER pwuser

EXPOSE 8080
CMD ["node", "dist/server.js"]
