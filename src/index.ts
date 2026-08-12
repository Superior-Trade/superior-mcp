import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ApiClient } from "./client.js";
import { registerHealthTools } from "./tools/health.js";
import { registerBacktestTools } from "./tools/backtest.js";
import { registerDeploymentTools } from "./tools/deployment.js";

// serveStdio owns the era decision: the opening exchange selects whether the
// connection is served as 2026-07-28 (stateless, MRTR) or as a 2025-era
// session, and pins one instance from this factory for its lifetime. The same
// registrations serve both, so older clients keep working while newer ones get
// the confirmation gates.
const client = new ApiClient();

serveStdio(() => {
  const server = new McpServer(
    { name: "superior-trade", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );

  registerHealthTools(server, client);
  registerBacktestTools(server, client);
  registerDeploymentTools(server, client);

  return server;
});
