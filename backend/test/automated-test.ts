/**
 * Automated Test for Backend Server
 *
 * Tests the WebSocket protocol and mock agent without user interaction.
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3001';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token';

// Mock vault data
const mockVault: Record<string, string> = {
  'welcome.md': '# Welcome\n\nTest note content.',
  'projects/test.md': '# Test Project\n\nSome project info.',
};

const mockFolders: Record<string, Array<{ name: string; type: 'file' | 'folder' }>> = {
  '': [
    { name: 'welcome.md', type: 'file' },
    { name: 'projects', type: 'folder' },
  ],
  'projects': [
    { name: 'test.md', type: 'file' },
  ],
};

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`[TEST] ${msg}`);
}

function logSuccess(msg: string) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

function logError(msg: string) {
  console.log(`\x1b[31m✗\x1b[0m ${msg}`);
}

function handleRpcRequest(ws: WebSocket, request: { id: string; method: string; params: Record<string, unknown> }) {
  let result: unknown;
  let error: { code: string; message: string } | undefined;

  switch (request.method) {
    case 'vault_read': {
      const path = request.params.path as string;
      const content = mockVault[path];
      if (content) {
        result = { content };
      } else {
        error = { code: 'NOT_FOUND', message: `File not found: ${path}` };
      }
      break;
    }
    case 'vault_write': {
      const path = request.params.path as string;
      const content = request.params.content as string;
      mockVault[path] = content;
      result = { success: true };
      break;
    }
    case 'vault_search': {
      const query = (request.params.query as string).toLowerCase();
      const searchResults: Array<{ path: string; snippet: string }> = [];
      for (const [path, content] of Object.entries(mockVault)) {
        if (path.toLowerCase().includes(query) || content.toLowerCase().includes(query)) {
          searchResults.push({ path, snippet: content.substring(0, 50) });
        }
      }
      result = searchResults;
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
      } else {
        error = { code: 'NOT_FOUND', message: `Folder not found: ${folder}` };
      }
      break;
    }
    case 'vault_delete': {
      const path = request.params.path as string;
      if (mockVault[path]) {
        delete mockVault[path];
        result = { success: true };
      } else {
        error = { code: 'NOT_FOUND', message: `File not found: ${path}` };
      }
      break;
    }
    default:
      error = { code: 'UNKNOWN', message: `Unknown method: ${request.method}` };
  }

  ws.send(JSON.stringify({
    type: 'rpc_response',
    id: request.id,
    ...(error ? { error } : { result }),
  }));
}

async function runTest(
  name: string,
  ws: WebSocket,
  prompt: string,
  expectations: {
    shouldReceiveTextDelta?: boolean;
    shouldUseTool?: string;
    shouldComplete?: boolean;
    timeout?: number;
  }
): Promise<TestResult> {
  const startTime = Date.now();
  const timeout = expectations.timeout || 10000;

  return new Promise((resolve) => {
    const requestId = randomUUID();
    let receivedTextDelta = false;
    let usedTools: string[] = [];
    let completed = false;
    let errorMsg: string | undefined;

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        name,
        passed: false,
        error: 'Test timed out',
        duration: Date.now() - startTime,
      });
    }, timeout);

    const messageHandler = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());

      if (msg.requestId && msg.requestId !== requestId) return;

      switch (msg.type) {
        case 'text_delta':
          receivedTextDelta = true;
          break;
        case 'tool_start':
          usedTools.push(msg.toolName);
          break;
        case 'rpc_request':
          handleRpcRequest(ws, msg);
          break;
        case 'complete':
          completed = true;
          cleanup();
          checkExpectations();
          break;
        case 'error':
          errorMsg = `${msg.code}: ${msg.message}`;
          cleanup();
          resolve({
            name,
            passed: false,
            error: errorMsg,
            duration: Date.now() - startTime,
          });
          break;
      }
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      ws.off('message', messageHandler);
    };

    const checkExpectations = () => {
      const errors: string[] = [];

      if (expectations.shouldReceiveTextDelta && !receivedTextDelta) {
        errors.push('Expected text_delta but none received');
      }

      if (expectations.shouldUseTool && !usedTools.includes(expectations.shouldUseTool)) {
        errors.push(`Expected tool ${expectations.shouldUseTool} but got [${usedTools.join(', ')}]`);
      }

      if (expectations.shouldComplete && !completed) {
        errors.push('Expected completion but not received');
      }

      resolve({
        name,
        passed: errors.length === 0,
        error: errors.length > 0 ? errors.join('; ') : undefined,
        duration: Date.now() - startTime,
      });
    };

    ws.on('message', messageHandler);

    // Send the prompt
    ws.send(JSON.stringify({
      type: 'prompt',
      id: requestId,
      prompt,
    }));
  });
}

async function main() {
  log('Connecting to server...');

  const wsUrl = `${SERVER_URL}?token=${encodeURIComponent(AUTH_TOKEN)}`;
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      log('Connected to server');
      resolve();
    });
    ws.on('error', reject);
  });

  // Test 1: Simple prompt (no tools)
  log('Running Test 1: Simple prompt response...');
  const test1 = await runTest(
    'Simple prompt response',
    ws,
    'Hello, how are you?',
    { shouldReceiveTextDelta: true, shouldComplete: true }
  );
  results.push(test1);
  test1.passed ? logSuccess(test1.name) : logError(`${test1.name}: ${test1.error}`);

  // Test 2: List files (uses vault_list)
  log('Running Test 2: List files tool...');
  const test2 = await runTest(
    'List files tool',
    ws,
    'list files in my vault',
    { shouldReceiveTextDelta: true, shouldUseTool: 'vault_list', shouldComplete: true }
  );
  results.push(test2);
  test2.passed ? logSuccess(test2.name) : logError(`${test2.name}: ${test2.error}`);

  // Test 3: Search vault (uses vault_search)
  log('Running Test 3: Search vault tool...');
  const test3 = await runTest(
    'Search vault tool',
    ws,
    'search for "project"',
    { shouldReceiveTextDelta: true, shouldUseTool: 'vault_search', shouldComplete: true }
  );
  results.push(test3);
  test3.passed ? logSuccess(test3.name) : logError(`${test3.name}: ${test3.error}`);

  // Test 4: Read file (uses vault_read)
  log('Running Test 4: Read file tool...');
  const test4 = await runTest(
    'Read file tool',
    ws,
    'read welcome.md',
    { shouldReceiveTextDelta: true, shouldUseTool: 'vault_read', shouldComplete: true }
  );
  results.push(test4);
  test4.passed ? logSuccess(test4.name) : logError(`${test4.name}: ${test4.error}`);

  // Test 5: Create file (uses vault_write)
  log('Running Test 5: Create file tool...');
  const test5 = await runTest(
    'Create file tool',
    ws,
    'create new-note.md with content "Hello World"',
    { shouldReceiveTextDelta: true, shouldUseTool: 'vault_write', shouldComplete: true }
  );
  results.push(test5);
  test5.passed ? logSuccess(test5.name) : logError(`${test5.name}: ${test5.error}`);

  // Verify the file was created
  if (mockVault['new-note.md']) {
    logSuccess('File was created in mock vault');
  } else {
    logError('File was NOT created in mock vault');
  }

  // Test 6: Ping/Pong
  log('Running Test 6: Ping/Pong...');
  const pingTest = await new Promise<TestResult>((resolve) => {
    const startTime = Date.now();
    const timeoutId = setTimeout(() => {
      resolve({ name: 'Ping/Pong', passed: false, error: 'No pong received', duration: Date.now() - startTime });
    }, 5000);

    const handler = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'pong') {
        clearTimeout(timeoutId);
        ws.off('message', handler);
        resolve({ name: 'Ping/Pong', passed: true, duration: Date.now() - startTime });
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'ping' }));
  });
  results.push(pingTest);
  pingTest.passed ? logSuccess(pingTest.name) : logError(`${pingTest.name}: ${pingTest.error}`);

  // Close connection
  ws.close();

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('TEST SUMMARY');
  console.log('='.repeat(50));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  console.log(`Total time: ${results.reduce((sum, r) => sum + r.duration, 0)}ms`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const result of results.filter(r => !r.passed)) {
      console.log(`  - ${result.name}: ${result.error}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
