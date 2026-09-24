FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts ./
COPY src ./src
USER bun
EXPOSE 4000
# Apply migrations, then start the API.
CMD ["sh", "-c", "bun src/db/migrate.ts && bun src/server.ts"]
