FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node contracts/agent-action ./contracts/agent-action
COPY --chown=node:node contracts/delivery-art ./contracts/delivery-art
COPY --chown=node:node contracts/delivery-art-lifecycle ./contracts/delivery-art-lifecycle
COPY --chown=node:node contracts/delivery-art-work-session ./contracts/delivery-art-work-session
COPY --chown=node:node contracts/delivery-ingress ./contracts/delivery-ingress
COPY --chown=node:node contracts/orchestration ./contracts/orchestration
COPY --chown=node:node contracts/proposal-workflow ./contracts/proposal-workflow
COPY --chown=node:node src ./src

USER node

FROM runtime AS orchestration-worker

CMD ["node", "src/orchestration-worker.js", "run"]

FROM runtime AS api

EXPOSE 8080

CMD ["node", "src/server.js"]
