# Arrow Party — server WebSocket (Node). Build từ thư mục gốc vì server dùng chung thư mục shared/.
FROM node:22-slim AS build
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci
COPY server server
COPY shared shared
RUN cd server && npm run build

FROM node:22-slim
WORKDIR /app/server
ENV NODE_ENV=production PORT=8080
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server/src/index.js"]
