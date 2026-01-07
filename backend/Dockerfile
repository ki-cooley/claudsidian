FROM node:22-slim

WORKDIR /app

# Copy package files from backend directory
COPY backend/package*.json ./

# Install all dependencies (need devDeps for build)
RUN npm ci

# Copy source files
COPY backend/src ./src
COPY backend/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check - WebSocket upgrade returns 426
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.request({hostname: 'localhost', port: process.env.PORT || 3001, path: '/', method: 'GET', timeout: 2000}, (res) => process.exit(res.statusCode === 426 ? 0 : 1)); req.on('error', () => process.exit(1)); req.end();" || exit 1

# Run the server
CMD ["node", "dist/index.js"]
