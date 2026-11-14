FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3050
WORKDIR /app
COPY --chown=node:node server.mjs exchange.mjs ./
COPY --chown=node:node public ./public
USER node
EXPOSE 3050
CMD ["node","server.mjs"]
