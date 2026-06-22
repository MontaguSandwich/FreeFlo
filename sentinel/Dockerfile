FROM node:18-alpine

# docker-cli lets the GATED self-heal restart sibling containers via a mounted socket.
# (Only used when SENTINEL_AUTOHEAL=true + the docker socket is mounted — see compose.)
RUN apk add --no-cache docker-cli

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
# Secrets (.env) and dedupe state (state/) are provided at runtime via compose, never baked in.
CMD ["npm", "start"]
