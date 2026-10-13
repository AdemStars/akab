FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/data/ipfs /app/data/uploads

EXPOSE 4000
CMD ["node", "dist/server.js"]
