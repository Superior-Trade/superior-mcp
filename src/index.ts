import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./client.js";
import { createServer } from "./server.js";

// Local / stdio server: one user, key from SUPERIOR_TRADE_API_KEY.
// For the remote (Streamable HTTP) server used by Claude custom connectors,
// run `npm run start:http` (src/http.ts).
const server = createServer(new ApiClient());
const transport = new StdioServerTransport();
await server.connect(transport);
