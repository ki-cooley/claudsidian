/**
 * Test WebSocket Client
 *
 * Simulates the Obsidian plugin to test the backend server.
 * Connects to the server, sends prompts, and responds to RPC requests.
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import * as readline from 'readline';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3001';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token';

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(prefix: string, color: string, message: string) {
  console.log(`${color}[${prefix}]${colors.reset} ${message}`);
}

// Mock vault data for testing
const mockVault: Record<string, string> = {
  'welcome.md': `# Welcome to My Vault

This is a test note in the mock vault.

## Links
- [[daily-notes/2024-01-01]]
- [[projects/project-alpha]]

#welcome #test
`,
  'daily-notes/2024-01-01.md': `# Daily Note - 2024-01-01

## Tasks
- [x] Review project specs
- [ ] Write documentation
- [ ] Send follow-up emails

## Notes
Had a productive meeting about the new feature.

#daily #january
`,
  'projects/project-alpha.md': `# Project Alpha

## Overview
A groundbreaking project that will change everything.

## Status
- Phase 1: Complete
- Phase 2: In Progress
- Phase 3: Planning

## Team
- Lead: Alice
- Dev: Bob, Carol

#project #active
`,
};

// Mock folder structure
const mockFolders: Record<string, Array<{ name: string; type: 'file' | 'folder' }>> = {
  '': [
    { name: 'welcome.md', type: 'file' },
    { name: 'daily-notes', type: 'folder' },
    { name: 'projects', type: 'folder' },
  ],
  'daily-notes': [
    { name: '2024-01-01.md', type: 'file' },
  ],
  'projects': [
    { name: 'project-alpha.md', type: 'file' },
  ],
};

interface RpcRequest {
  type: 'rpc_request';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

function handleRpcRequest(ws: WebSocket, request: RpcRequest) {
  log('RPC', colors.yellow, `${request.method}(${JSON.stringify(request.params)})`);

  let result: unknown;
  let error: { code: string; message: string } | undefined;

  try {
    switch (request.method) {
      case 'vault_read': {
        const path = request.params.path as string;
        const content = mockVault[path];
        if (content) {
          result = { content };
          log('RPC', colors.green, `Read ${path} (${content.length} chars)`);
        } else {
          error = { code: 'NOT_FOUND', message: `File not found: ${path}` };
          log('RPC', colors.red, `File not found: ${path}`);
        }
        break;
      }

      case 'vault_write': {
        const path = request.params.path as string;
        const content = request.params.content as string;
        mockVault[path] = content;
        result = { success: true };
        log('RPC', colors.green, `Wrote ${path} (${content.length} chars)`);
        break;
      }

      case 'vault_search': {
        const query = (request.params.query as string).toLowerCase();
        const limit = (request.params.limit as number) || 20;
        const results: Array<{ path: string; snippet: string }> = [];

        for (const [path, content] of Object.entries(mockVault)) {
          if (results.length >= limit) break;

          if (path.toLowerCase().includes(query)) {
            results.push({ path, snippet: `Filename match: ${path}` });
          } else if (content.toLowerCase().includes(query)) {
            const idx = content.toLowerCase().indexOf(query);
            const start = Math.max(0, idx - 30);
            const end = Math.min(content.length, idx + query.length + 30);
            const snippet = content.substring(start, end);
            results.push({ path, snippet: `...${snippet}...` });
          }
        }

        result = results;
        log('RPC', colors.green, `Search "${query}" found ${results.length} results`);
        break;
      }

      case 'vault_list': {
        const folder = (request.params.folder as string) || '';
        const items = mockFolders[folder];
        if (items) {
          result = items.map(item => ({
            name: item.name,
            path: folder ? `${folder}/${item.name}` : item.name,
            type: item.type,
          }));
          log('RPC', colors.green, `Listed ${folder || 'root'}: ${items.length} items`);
        } else {
          error = { code: 'NOT_FOUND', message: `Folder not found: ${folder}` };
          log('RPC', colors.red, `Folder not found: ${folder}`);
        }
        break;
      }

      case 'vault_delete': {
        const path = request.params.path as string;
        if (mockVault[path]) {
          delete mockVault[path];
          result = { success: true };
          log('RPC', colors.green, `Deleted ${path}`);
        } else {
          error = { code: 'NOT_FOUND', message: `File not found: ${path}` };
          log('RPC', colors.red, `File not found: ${path}`);
        }
        break;
      }

      default:
        error = { code: 'UNKNOWN_METHOD', message: `Unknown method: ${request.method}` };
        log('RPC', colors.red, `Unknown method: ${request.method}`);
    }
  } catch (err) {
    error = {
      code: 'ERROR',
      message: err instanceof Error ? err.message : 'Unknown error',
    };
    log('RPC', colors.red, `Error: ${error.message}`);
  }

  // Send response
  const response = {
    type: 'rpc_response',
    id: request.id,
    ...(error ? { error } : { result }),
  };

  ws.send(JSON.stringify(response));
}

function runTestClient() {
  const wsUrl = `${SERVER_URL}?token=${encodeURIComponent(AUTH_TOKEN)}`;
  log('CLIENT', colors.cyan, `Connecting to ${SERVER_URL}...`);

  const ws = new WebSocket(wsUrl);
  let currentRequestId: string | null = null;
  let responseBuffer = '';

  ws.on('open', () => {
    log('CLIENT', colors.green, 'Connected!');
    log('CLIENT', colors.dim, 'Type a message and press Enter to send. Type "quit" to exit.');
    log('CLIENT', colors.dim, 'Try: "list files", "search project", "read welcome.md", "create test.md"');
    console.log('');
    startRepl();
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    switch (msg.type) {
      case 'text_delta':
        process.stdout.write(`${colors.bright}${msg.text}${colors.reset}`);
        responseBuffer += msg.text;
        break;

      case 'tool_start':
        console.log('');
        log('TOOL', colors.magenta, `▶ ${msg.toolName}(${JSON.stringify(msg.toolInput)})`);
        break;

      case 'tool_end':
        log('TOOL', colors.magenta, `◀ ${msg.toolName}: ${msg.result.substring(0, 100)}${msg.result.length > 100 ? '...' : ''}`);
        break;

      case 'thinking':
        log('THINK', colors.dim, msg.text);
        break;

      case 'complete':
        console.log('');
        log('DONE', colors.green, `Request completed`);
        currentRequestId = null;
        responseBuffer = '';
        break;

      case 'error':
        console.log('');
        log('ERROR', colors.red, `${msg.code}: ${msg.message}`);
        currentRequestId = null;
        responseBuffer = '';
        break;

      case 'rpc_request':
        handleRpcRequest(ws, msg);
        break;

      case 'pong':
        // Ignore pong
        break;

      default:
        log('MSG', colors.dim, JSON.stringify(msg));
    }
  });

  ws.on('close', (code, reason) => {
    log('CLIENT', colors.yellow, `Disconnected: ${code} ${reason}`);
    process.exit(0);
  });

  ws.on('error', (err) => {
    log('CLIENT', colors.red, `Error: ${err.message}`);
    process.exit(1);
  });

  // Interactive REPL
  function startRepl() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${colors.cyan}> ${colors.reset}`,
    });

    rl.prompt();

    rl.on('line', (line) => {
      const input = line.trim();

      if (!input) {
        rl.prompt();
        return;
      }

      if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
        log('CLIENT', colors.yellow, 'Goodbye!');
        ws.close();
        rl.close();
        return;
      }

      if (input.toLowerCase() === 'cancel' && currentRequestId) {
        log('CLIENT', colors.yellow, 'Cancelling request...');
        ws.send(JSON.stringify({ type: 'cancel', id: currentRequestId }));
        rl.prompt();
        return;
      }

      if (input.toLowerCase() === 'ping') {
        ws.send(JSON.stringify({ type: 'ping' }));
        rl.prompt();
        return;
      }

      if (input.toLowerCase() === 'vault') {
        log('VAULT', colors.cyan, 'Current mock vault contents:');
        for (const [path, content] of Object.entries(mockVault)) {
          console.log(`  ${colors.dim}${path}${colors.reset} (${content.length} chars)`);
        }
        rl.prompt();
        return;
      }

      // Send prompt
      currentRequestId = randomUUID();
      const message = {
        type: 'prompt',
        id: currentRequestId,
        prompt: input,
        context: {
          currentFile: 'welcome.md', // Simulate having a file open
        },
      };

      log('SEND', colors.blue, `Prompt: "${input}"`);
      console.log('');
      ws.send(JSON.stringify(message));

      // Don't prompt until response is complete
      rl.on('close', () => {
        // Cleanup
      });
    });

    // Re-prompt after complete messages
    const originalPrompt = rl.prompt.bind(rl);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'complete' || msg.type === 'error') {
        console.log('');
        originalPrompt();
      }
    });
  }

  // Ping interval
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 25000);

  ws.on('close', () => {
    clearInterval(pingInterval);
  });
}

// Run the client
runTestClient();
