FROM node:24.13.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.13.1-bookworm-slim AS runtime
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3000 PROJECT_ROOT=/app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/server/db/migrations ./server/db/migrations
COPY --from=build /app/LICENSE ./LICENSE
COPY --from=build /app/NOTICE ./NOTICE
COPY --from=build /app/LICENSES ./LICENSES
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server/index.js"]
