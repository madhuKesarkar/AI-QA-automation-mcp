FROM node:20-slim

# Playwright's own apt dependencies for running real browsers headlessly
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Install the main repo's test dependencies (Playwright + playwright-bdd)
COPY package.json package-lock.json ./
RUN npm ci

# Install the agent orchestrator's own dependencies
COPY agent/package.json ./agent/package.json
RUN cd agent && npm install

# Playwright browser binaries — this is the one slow step, cached after first build
RUN npx playwright install --with-deps chromium

COPY . .
RUN cd agent && npm run build

ENTRYPOINT ["node", "agent/dist/cli.js"]
