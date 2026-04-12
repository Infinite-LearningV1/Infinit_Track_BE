# Stage 1: Install dependencies
FROM node:18-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production && \
    cp -R node_modules /prod_modules && \
    npm ci

# Stage 2: Production image
FROM node:18-alpine AS production

RUN apk add --no-cache dumb-init tzdata && \
    cp /usr/share/zoneinfo/Asia/Jakarta /etc/localtime && \
    echo "Asia/Jakarta" > /etc/timezone && \
    apk del tzdata

ENV NODE_ENV=production \
    TZ=Asia/Jakarta \
    PORT=3000

WORKDIR /app

COPY --from=deps /prod_modules ./node_modules
COPY package.json .sequelizerc ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY docs/openapi.yaml ./docs/openapi.yaml

RUN mkdir -p logs && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["dumb-init", "node", "src/server.js"]
