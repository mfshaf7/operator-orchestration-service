FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git util-linux python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/intake-python \
    && /opt/intake-python/bin/pip install --no-cache-dir 'jsonschema[format-nongpl]==4.23.0' 'PyYAML==6.0.2'

ENV PATH="/opt/intake-python/bin:${PATH}"

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node contracts/agent-action ./contracts/agent-action
COPY --chown=node:node contracts/catalog ./contracts/catalog
COPY --chown=node:node contracts/delivery-change ./contracts/delivery-change
COPY --chown=node:node contracts/delivery-closeout ./contracts/delivery-closeout
COPY --chown=node:node contracts/delivery-art ./contracts/delivery-art
COPY --chown=node:node contracts/delivery-art-lifecycle ./contracts/delivery-art-lifecycle
COPY --chown=node:node contracts/delivery-art-work-session ./contracts/delivery-art-work-session
COPY --chown=node:node contracts/delivery-ingress ./contracts/delivery-ingress
COPY --chown=node:node contracts/orchestration ./contracts/orchestration
COPY --chown=node:node contracts/proposal-workflow ./contracts/proposal-workflow
COPY --chown=node:node contracts/refinement ./contracts/refinement
COPY --chown=node:node contracts/repository-custody ./contracts/repository-custody
COPY --chown=node:node contracts/repository-custody-workflow ./contracts/repository-custody-workflow
COPY --chown=node:node contracts/repository-lifecycle ./contracts/repository-lifecycle
COPY --chown=node:node contracts/repository-lifecycle-workflow ./contracts/repository-lifecycle-workflow
COPY --chown=node:node contracts/work-design ./contracts/work-design
COPY --chown=node:node contracts/workspace-intake ./contracts/workspace-intake
COPY --chown=node:node scripts/workspace_intake_source.py ./scripts/workspace_intake_source.py
COPY --chown=node:node src ./src

USER node

FROM runtime AS orchestration-worker

CMD ["node", "src/orchestration-worker.js", "run"]

FROM runtime AS api

EXPOSE 8080

CMD ["node", "src/server.js"]
