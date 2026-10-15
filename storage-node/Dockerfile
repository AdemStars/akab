FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV DATA_DIR=/data PORT=7000
VOLUME ["/data"]
EXPOSE 7000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:7000/v1/health || exit 1
CMD ["node", "server.js"]
