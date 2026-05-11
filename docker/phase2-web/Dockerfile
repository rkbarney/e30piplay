# Nginx static bundle matching Phase 2 on-Pi layout (localhost → nginx → built app).
# Build context: repository root.

FROM node:20-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.26-alpine

COPY docker/phase2-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
