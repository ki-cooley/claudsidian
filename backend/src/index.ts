/**
 * Obsidian Claude Agent Backend
 *
 * Entry point for the backend service that connects
 * Claude to Obsidian vault operations via WebSocket.
 */

import 'dotenv/config';
import { startServer } from './server.js';
import { logger } from './utils.js';

const MOCK_MODE = process.env.MOCK_MODE === 'true';

// Verify required environment variables
function checkEnv() {
  // In mock mode, we don't need credentials
  if (!MOCK_MODE) {
    const hasOAuth = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    if (!hasOAuth && !hasApiKey) {
      logger.error('Missing auth: set CLAUDE_CODE_OAUTH_TOKEN (subscription) or ANTHROPIC_API_KEY');
      process.exit(1);
    }
    logger.info(`  Auth: ${hasOAuth ? 'OAuth token (subscription)' : 'API key'}`);
  }

  // Log configuration (without sensitive values)
  logger.info('Configuration:');
  logger.info(`  MOCK_MODE: ${MOCK_MODE}`);
  logger.info(`  PORT: ${process.env.PORT || 3001}`);
  logger.info(`  AUTH_TOKEN: ${process.env.AUTH_TOKEN ? '***' : 'dev-token (default)'}`);
  if (!MOCK_MODE) {
    logger.info(`  CLAUDE_MODEL: ${process.env.CLAUDE_MODEL || 'claude-opus-4-6'}`);
  }
  logger.info(`  LOG_LEVEL: ${process.env.LOG_LEVEL || 'info'}`);
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Graceful shutdown
function setupGracefulShutdown(server: ReturnType<typeof startServer>) {
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Main entry point
function main() {
  logger.info('Starting Obsidian Claude Agent Backend...');

  checkEnv();

  const server = startServer();
  setupGracefulShutdown(server);

  logger.info('Backend ready');
}

main();
