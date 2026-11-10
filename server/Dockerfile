FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=cascade-auth-npm,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY server/tsconfig.json server/tsup.config.ts ./server/
COPY shared ./shared
RUN npm run server:build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=cascade-auth-npm,target=/root/.npm \
    npm ci --omit=dev --prefer-offline --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build --chown=node:node /app/server/dist/*.js ./server/dist/
COPY --from=build --chown=node:node /app/server/migrations ./server/migrations
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/main.js"]
