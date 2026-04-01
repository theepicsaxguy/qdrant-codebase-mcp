FROM node:24-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:24-slim

WORKDIR /app

# Create models cache directory
RUN mkdir -p /app/models

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV CONFIG_PATH=/app/config.yml
ENV MODEL_CACHE_DIR=/app/models

EXPOSE 3000

CMD ["node", "dist/index.js"]
