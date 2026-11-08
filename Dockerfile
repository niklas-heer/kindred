# Kindred on Node in one image. Normally run through compose.yaml (docs/self-host.md):
#   docker compose up -d --build                    the app, with its data in a named volume
#   docker build --build-arg WITH_GAZETTEER=1 .     also the offline place search (downloads GeoNames)

# The Node version is the one in mise.toml.
ARG NODE_IMAGE=node:26-trixie-slim

# Everything needed to build: all dependencies, the sources, then the Node target into dist/.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The commit shown in a steward's feedback report; the build context has no .git (docker build --build-arg KINDRED_COMMIT=…).
ARG KINDRED_COMMIT=unknown
RUN npm run build:node

# The place gazetteer (scripts/gazetteer.ts, GeoNames cities500) is optional. It is built only when
# WITH_GAZETTEER=1, and then needs the network during the build. Without it the place search offers
# the family's own places, as the app does everywhere without the file.
FROM build AS gazetteer
ARG WITH_GAZETTEER=0
RUN mkdir -p /out \
 && if [ "$WITH_GAZETTEER" = "1" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends unzip \
      && rm -rf /var/lib/apt/lists/* \
      && node scripts/gazetteer.ts \
      && cp data/gazetteer.db /out/gazetteer.db; \
    fi

# What runs: the production dependencies, the built server and client, the migrations, and the gazetteer if any.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4901 \
    KINDRED_DATA_DIR=/data \
    KINDRED_GAZETTEER=/app/gazetteer/gazetteer.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/migrations ./migrations
COPY --from=gazetteer /out ./gazetteer

# The families, media, accounts and the secret live in /data, a volume. The app runs as the image's
# unprivileged node user and writes nowhere else.
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4901

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4901) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# SIGTERM (docker stop) closes the databases cleanly; see server/node.ts.
CMD ["node", "server/node.ts"]
