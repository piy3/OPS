# Stage 1: Install dependencies
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

# Stage 2: Production image
FROM node:20-alpine

WORKDIR /app

# Create log directory
RUN mkdir -p /var/log/waymaze

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
