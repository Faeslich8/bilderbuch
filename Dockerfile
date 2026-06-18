# syntax=docker/dockerfile:1

# --- Build: statisches SPA-Bundle erzeugen ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Truthy Proxy-Ziel → die App nutzt die gleich-origin Route "/api"
# (nginx reverse-proxyt sie an den Immich-Server). Vermeidet CORS im Browser.
ENV VITE_IMMICH_PROXY_TARGET=/
RUN npm run build

# --- Serve: nginx liefert dist/ und proxyt /api an Immich ---
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# Basis-URL des Immich-Servers (ohne abschließenden Slash), vom Container erreichbar.
# Zur Laufzeit überschreibbar: `docker run -e IMMICH_URL=...` bzw. in compose.
ENV IMMICH_URL=http://immich-server:2283
EXPOSE 80
