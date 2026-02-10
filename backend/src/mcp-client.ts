/**
 * MCP Client Manager
 *
 * Connects to external MCP servers via SSE transport,
 * discovers their tools, and forwards tool calls.
 *
 * Configuration via MCP_SERVERS environment variable:
 *   MCP_SERVERS='{"server-name":{"type":"sse","url":"https://example.com/mcp/sse"}}'
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { logger } from './utils.js';
import type { ToolDefinition, ToolResult } from './mcp-tools.js';

interface McpServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

interface McpToolEntry {
  name: string;
  serverName: string;
  definition: ToolDefinition;
}

export class McpClientManager {
  private clients = new Map<string, Client>();
  private transports = new Map<string, SSEClientTransport>();
  private toolMap = new Map<string, string>(); // toolName -> serverName
  private toolEntries: McpToolEntry[] = [];

  /**
   * Initialize MCP client connections from MCP_SERVERS env var
   */
  async initialize(): Promise<void> {
    const serversJson = process.env.MCP_SERVERS;
    if (!serversJson) {
      logger.info('No MCP_SERVERS configured, skipping MCP client setup');
      return;
    }

    let servers: Record<string, McpServerConfig>;
    try {
      servers = JSON.parse(serversJson);
    } catch (e) {
      logger.error('Failed to parse MCP_SERVERS env var:', e);
      return;
    }

    for (const [name, config] of Object.entries(servers)) {
      try {
        await this.connectServer(name, config);
      } catch (e) {
        logger.error(`Failed to connect to MCP server "${name}":`, e);
      }
    }

    logger.info(
      `MCP client initialized: ${this.clients.size} server(s), ${this.toolEntries.length} tool(s)`
    );
  }

  private async connectServer(
    name: string,
    config: McpServerConfig
  ): Promise<void> {
    logger.info(`Connecting to MCP server: ${name} at ${config.url}`);

    const url = new URL(config.url);
    const transport = new SSEClientTransport(url, {
      requestInit: config.headers
        ? { headers: config.headers }
        : undefined,
    });

    const client = new Client({
      name: 'claudsidian-backend',
      version: '1.0.0',
    });

    await client.connect(transport);
    this.clients.set(name, client);
    this.transports.set(name, transport);

    // Discover tools
    const toolsResult = await client.listTools();
    for (const tool of toolsResult.tools) {
      const definition: ToolDefinition = {
        name: tool.name,
        description: tool.description || '',
        input_schema: tool.inputSchema as ToolDefinition['input_schema'],
      };

      this.toolEntries.push({
        name: tool.name,
        serverName: name,
        definition,
      });
      this.toolMap.set(tool.name, name);
      logger.info(`  Discovered tool: ${tool.name}`);
    }

    logger.info(
      `Connected to MCP server "${name}": ${toolsResult.tools.length} tool(s)`
    );
  }

  /**
   * Get tool definitions for all connected MCP servers
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.toolEntries.map((t) => t.definition);
  }

  /**
   * Check if a tool name belongs to an MCP server
   */
  hasTool(name: string): boolean {
    return this.toolMap.has(name);
  }

  /**
   * Execute a tool call on the appropriate MCP server
   */
  async callTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    const serverName = this.toolMap.get(name);
    if (!serverName) {
      return { content: `Unknown MCP tool: ${name}`, isError: true };
    }

    const client = this.clients.get(serverName);
    if (!client) {
      return {
        content: `MCP server "${serverName}" not connected`,
        isError: true,
      };
    }

    try {
      const result = await client.callTool({
        name,
        arguments: input,
      });

      // MCP returns content as an array of content blocks
      const textContent = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!)
        .join('\n');

      return {
        content: textContent || '(empty result)',
        isError: result.isError === true,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      logger.error(`MCP tool "${name}" on server "${serverName}" failed:`, message);
      return {
        content: `Error calling ${name}: ${message}`,
        isError: true,
      };
    }
  }

  /**
   * Close all MCP client connections
   */
  async close(): Promise<void> {
    for (const [name, client] of this.clients) {
      try {
        await client.close();
        logger.info(`Disconnected from MCP server: ${name}`);
      } catch (e) {
        logger.warn(`Error closing MCP client "${name}":`, e);
      }
    }
    this.clients.clear();
    this.transports.clear();
    this.toolMap.clear();
    this.toolEntries = [];
  }
}

// Singleton instance
export const mcpClientManager = new McpClientManager();
