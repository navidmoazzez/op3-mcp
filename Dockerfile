# Build, then ship only what runs.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY README.md SKILL.md LICENSE ./

# Non-root. The server writes nothing to disk, so there is no reason to run
# as root and one good reason not to.
USER node

# stdio by default, which is what an MCP client launches. Override with
# `--http` to run it somewhere always on.
ENTRYPOINT ["node", "dist/index.js"]
