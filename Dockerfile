# Zero-dependency Node.js runtime for IT Asset Manager
FROM node:20-alpine

WORKDIR /app

# Copy application files
COPY . .

# Ensure upload directory exists and has permissions
RUN mkdir -p uploads data

# Expose server port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "server.js"]
