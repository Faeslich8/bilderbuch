# syntax=docker/dockerfile:1

# --- Build: statisches SPA-Bundle erzeugen ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Serve: nginx liefert nur die statische App aus ---
# Der Browser verbindet sich direkt mit deinem Immich-Server (URL in der UI);
# dafür muss Immich CORS für diese Origin erlauben (siehe README).
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
