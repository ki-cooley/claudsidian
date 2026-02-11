FROM node:22-slim

# Cache bust: 2026-02-11-v1
WORKDIR /app

# Install system dependencies required by Claude Agent SDK CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install all dependencies (need devDeps for build)
RUN npm ci

# Copy source files
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Set environment
ENV NODE_ENV=production
ENV PORT=3001
# Ensure HOME is writable for Claude Agent SDK CLI config
ENV HOME=/tmp/claude-home
RUN mkdir -p /tmp/claude-home/.claude

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:' + (process.env.PORT || 3001) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));" || exit 1

# Run the server
CMD ["node", "dist/index.js"]
