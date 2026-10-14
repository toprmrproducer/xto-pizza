FROM node:20-slim
WORKDIR /app
COPY server.js run.sh ./
COPY public ./public
COPY data ./data
ENV PORT=7788 NODE_ENV=production
EXPOSE 7788
CMD ["node", "server.js"]
