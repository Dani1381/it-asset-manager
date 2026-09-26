FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.js database.js ./
COPY public ./public
RUN mkdir -p uploads

EXPOSE 3000

VOLUME ["/app/uploads", "/app/data"]

CMD ["node", "server.js"]
