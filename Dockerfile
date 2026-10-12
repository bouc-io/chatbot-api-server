# ---- Base ----
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./

# ---- Dependencies ----
FROM base AS dependencies
RUN npm install

# ---- Build ----
# `npm run build` runs `prisma generate` first; the generated client is compiled into dist/.
FROM dependencies AS build
COPY . .
RUN npm run build

# ---- Production ----
# No source tree and no generate step here: the runtime uses dist/ only. prisma/ and
# prisma.config.ts are shipped for `prisma migrate deploy` at container start.
FROM base AS production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY prisma ./prisma
COPY prisma.config.ts ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

ENV DATABASE_URL=$DATABASE_URL
ENV LOG_LEVEL=${LOG_LEVEL:-info}
ENV DISTILLATION_SERVICE_URL=$DISTILLATION_SERVICE_URL
ENV DISTILLATION_ENABLED=${DISTILLATION_ENABLED:-false}
ENV DISTILLATION_TIMEOUT_MS=${DISTILLATION_TIMEOUT_MS:-120000}
ENV DISTILLATION_MIN_MESSAGES=${DISTILLATION_MIN_MESSAGES:-10}
ENV DISTILLATION_MIN_INTERVAL_MS=${DISTILLATION_MIN_INTERVAL_MS:-900000}
ENV DISTILLATION_MAX_MESSAGES=${DISTILLATION_MAX_MESSAGES:-50}
ENV ALLOW_SELF_SIGNED_CERTS=${ALLOW_SELF_SIGNED_CERTS:-false}
ENV OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-http://localhost:11434}
ENV OLLAMA_MODEL=${OLLAMA_MODEL:-qwen3.5:2b}
ENV MAX_HISTORY_MESSAGES=${MAX_HISTORY_MESSAGES:-20}
ENV OLLAMA_SYSTEM_PROMPT=${OLLAMA_SYSTEM_PROMPT:-"You are a helpful assistant. When you think before answering: pick one approach immediately, state it in 1-3 short bullets, then stop. Never revisit or rephrase the same point twice. Never list alternatives. Go straight to the answer."}
ENV OLLAMA_THINK=${OLLAMA_THINK:-true}
# Instruction services (GAP 4)
ENV ADMIN_API_URL=$ADMIN_API_URL
ENV PORTAL_API_URL=$PORTAL_API_URL
# Memory retrieval
ENV MEMORY_SERVICE_URL=$MEMORY_SERVICE_URL
ENV MEMORY_SERVICE_ENABLED=${MEMORY_SERVICE_ENABLED:-true}
ENV MEMORY_SEARCH_LIMIT=${MEMORY_SEARCH_LIMIT:-10}

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["sh", "-c", "npm run db:deploy && npm start"]