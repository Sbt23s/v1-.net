# Builds the React app and serves it with Nginx, which also reverse-proxies
# /api and /ws to the backend container and /analytics to the Python service.
#
# VITE_API_URL is intentionally left EMPTY: the app then calls /api and /ws on
# its own origin, and Nginx forwards them. No CORS setup, no rebuild when the
# server IP/domain changes.

# ---- Stage 1: build the static site ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV VITE_API_URL=
ENV VITE_ANALYTICS_URL=/analytics
RUN npm run build

# ---- Stage 2: serve with Nginx ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
