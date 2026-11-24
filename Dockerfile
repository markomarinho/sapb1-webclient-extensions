FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/backend/package.json packages/backend/tsconfig.json ./packages/backend/
COPY packages/frontend/package.json packages/frontend/tsconfig.json ./packages/frontend/

RUN npm install

COPY packages ./packages
COPY samples ./samples
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4010

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/backend/package.json ./packages/backend/
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/frontend/dist ./packages/frontend/dist
COPY --from=builder /app/samples ./samples

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 4010
CMD ["node", "packages/backend/dist/server.js"]
