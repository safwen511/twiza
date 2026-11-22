# TWIZA — one image: the API and the built web app, served from the same port.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY app/package.json app/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server server
COPY --from=build /app/app/dist app/dist
COPY --from=build /app/app/public/data app/public/data
COPY --from=build /app/data data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:8787/api/health || exit 1
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]
