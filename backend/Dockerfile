FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy built files
COPY dist ./dist

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.request({hostname: 'localhost', port: process.env.PORT || 3001, path: '/', method: 'GET', timeout: 2000}, (res) => process.exit(res.statusCode === 426 ? 0 : 1)); req.on('error', () => process.exit(1)); req.end();" || exit 1

# Run the server
CMD ["node", "dist/index.js"]
