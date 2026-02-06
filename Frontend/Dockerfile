# Stage 1: Build the React app
FROM node:20-alpine AS builder

WORKDIR /app

# Build argument for environment - persisted as ENV for vite build
ARG ENV=dev
ENV ENV=${ENV}

COPY package*.json ./
RUN npm install

COPY . .

RUN npx vite build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built app (Vite already copies public/ assets into dist/ during build)
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
