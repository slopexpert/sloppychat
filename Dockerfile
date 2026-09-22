# syntax=docker/dockerfile:1

# Build. Node 22 is the line the store is written against: it reads the database
# through node:sqlite, which that line ships as an experimental module.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# The lockfile layer stays warm while the source moves around.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY static ./static
COPY src ./src
COPY svelte.config.js tsconfig.json vite.config.ts ./
RUN npm run build

# Run. Production modules, the build output, nothing else. mupdf keeps its wasm
# next to its code, so node_modules has to travel with the app.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
	PORT=3000 \
	HOST=0.0.0.0 \
	SLOPPYCHAT_DATA_DIR=/app/data

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/build ./build

# The store writes one SQLite file, and the image runs as the unprivileged `node`
# user, so the data directory belongs to that user before any volume lands on it.
RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 3000
USER node

# Any HTTP answer means the process is up. With a token set the door answers 401,
# and that is a healthy server holding the door, not a broken one.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"

# Node stays PID 1, so Ctrl-C and `docker stop` reach it and the shutdown hooks
# close the MCP child processes instead of leaving them behind.
CMD ["node", "--disable-warning=ExperimentalWarning", "build"]
