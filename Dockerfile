# Arrow Party — một image phục vụ cả giao diện (client/dist dưới /arrow/, monkey/dist dưới /monkey/, heroes/dist dưới /heroes/) lẫn WebSocket (server).
# Build từ thư mục gốc vì client và server cùng dùng shared/.
FROM node:22-slim AS client
WORKDIR /app
COPY client/package*.json client/
RUN cd client && npm ci
COPY client client
COPY shared shared
# không đặt VITE_WS_URL: client tự nối WebSocket về cùng tên miền
RUN cd client && npm run build

# SINH TỒN BẦY KHỈ: bundle riêng (monkey/dist), phục vụ dưới /monkey/ bởi cùng server
FROM node:22-slim AS monkey
WORKDIR /app
COPY monkey/package*.json monkey/
RUN cd monkey && npm ci
COPY monkey monkey
COPY shared shared
RUN cd monkey && npm run build

# THẺ TƯỚNG 3D: bundle riêng (heroes/dist), phục vụ dưới /heroes/ bởi cùng server
FROM node:22-slim AS heroes
WORKDIR /app
COPY heroes/package*.json heroes/
RUN cd heroes && npm ci
COPY heroes heroes
COPY shared shared
RUN cd heroes && npm run build

FROM node:22-slim AS server
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci
# package.json gốc (type: module) để tsc biên dịch cả shared/ thành ES module giống server
COPY package.json ./
COPY server server
COPY shared shared
RUN cd server && npm run build

FROM node:22-slim
WORKDIR /app/server
ENV NODE_ENV=production PORT=8080
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=server /app/server/dist ./dist
COPY --from=client /app/client/dist /app/client/dist
COPY --from=monkey /app/monkey/dist /app/monkey/dist
COPY --from=heroes /app/heroes/dist /app/heroes/dist
EXPOSE 8080
CMD ["node", "dist/server/src/index.js"]
