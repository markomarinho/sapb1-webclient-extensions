# Build context: repository root (see docker-compose.yml)
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ARG EXT=extensions/bank-reconciliation

COPY package.json tsconfig.base.json ./
COPY ${EXT}/package.json ./${EXT}/
COPY ${EXT}/packages/shared/package.json ${EXT}/packages/shared/tsconfig.json ./${EXT}/packages/shared/
COPY ${EXT}/packages/backend/package.json ${EXT}/packages/backend/tsconfig.json ./${EXT}/packages/backend/
COPY ${EXT}/packages/frontend/package.json ${EXT}/packages/frontend/tsconfig.json ./${EXT}/packages/frontend/

RUN npm install

COPY ${EXT}/packages ./${EXT}/packages
COPY ${EXT}/samples ./${EXT}/samples
RUN npm run build -w ${EXT}

FROM node:22-bookworm-slim AS runner
ARG EXT=extensions/bank-reconciliation
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4010

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/${EXT}/package.json ./${EXT}/
COPY --from=builder /app/${EXT}/packages/shared/package.json ./${EXT}/packages/shared/
COPY --from=builder /app/${EXT}/packages/shared/dist ./${EXT}/packages/shared/dist
COPY --from=builder /app/${EXT}/packages/backend/package.json ./${EXT}/packages/backend/
COPY --from=builder /app/${EXT}/packages/backend/dist ./${EXT}/packages/backend/dist
COPY --from=builder /app/${EXT}/packages/frontend/dist ./${EXT}/packages/frontend/dist
COPY --from=builder /app/${EXT}/samples ./${EXT}/samples

# The backend resolves samples/, data/ and packages/frontend/dist relative to the extension root
WORKDIR /app/${EXT}
RUN mkdir -p data && chown -R node:node /app
USER node

EXPOSE 4010
CMD ["node", "packages/backend/dist/server.js"]
