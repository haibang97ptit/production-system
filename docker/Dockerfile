# ============================================================================
# Stage 1: build - install all deps, compile TypeScript, generate Prisma client
# ============================================================================
FROM node:20-slim AS builder

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma
RUN npm ci

RUN npx prisma generate

COPY src ./src
RUN npm run build

# ============================================================================
# Stage 2: production - chỉ giữ những gì cần chạy
# ============================================================================
FROM node:20-slim AS production

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl ca-certificates wget && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cài production deps + prisma client
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && \
    npx prisma generate && \
    npm cache clean --force

# Copy code đã compile
COPY --from=builder /app/dist ./dist

# Entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Chown mọi thứ cho user 'node' (đã có sẵn trong image node:slim)
RUN chown -R node:node /app

# Non-root user cho production security
USER node

EXPOSE 3000

# Healthcheck: Docker sẽ tự restart container nếu API không phản hồi
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/server.js"]
