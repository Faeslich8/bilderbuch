# syntax=docker/dockerfile:1

# --- Build: statisches SPA-Bundle erzeugen ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Serve: nginx liefert die App aus und proxyt /api/ same-origin zu Immich ---
# IMMICH_URL (z. B. http://immich_server:2283) muss beim Start gesetzt sein;
# dadurch spricht der Browser nur mit dieser einen Origin, kein CORS auf Immich nötig.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
