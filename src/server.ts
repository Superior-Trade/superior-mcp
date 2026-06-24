import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "./client.js";
import { registerHealthTools } from "./tools/health.js";
import { registerBacktestTools } from "./tools/backtest.js";
import { registerDeploymentTools } from "./tools/deployment.js";

/**
 * Build a fully-wired Superior Trade MCP server for the given client.
 * Shared by the stdio entry (index.ts) and the HTTP entry (http.ts) — the HTTP
 * server builds one per session so each user's key stays isolated.
 */
export function createServer(client: ApiClient): McpServer {
  const server = new McpServer({
    name: "superior-trade",
    version: "1.0.0",
  });

  registerHealthTools(server, client);
  registerBacktestTools(server, client);
  registerDeploymentTools(server, client);

  return server;
}
