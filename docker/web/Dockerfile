# Nginx serving the Vite build (same layout as Pi: localhost → nginx → app).
# Build context: repository root.

FROM node:20-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl rsync ca-certificates \
 && bash scripts/install-emulatorjs.sh \
 && apt-get purge -y curl rsync \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
RUN npm run build

FROM nginx:1.26-alpine

COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
