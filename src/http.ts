import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient } from "./client.js";
import { createServer } from "./server.js";

/**
 * Remote (Streamable HTTP) MCP server — the transport Claude's "Add custom
 * connector" needs (Anthropic's cloud connects to a public URL).
 *
 * Multi-tenant: the Superior Trade API key is taken from each request
 * (Authorization: Bearer <key>, or x-api-key) and bound to that MCP session, so
 * one deployment serves many users without sharing one key.
 *
 * NOTE: Claude custom connectors authenticate via OAuth, not a pasted key. To
 * accept Claude's OAuth, an OAuth layer must map the access token to the user's
 * Superior key and present it here as the Bearer credential. That layer is the
 * next step; this transport is OAuth-ready (it reads the key per session).
 */

const PORT = Number(process.env.PORT ?? 8080);
const ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

function extractApiKey(req: Request): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || undefined;
  }
  const x = req.headers["x-api-key"];
  return typeof x === "string" && x.length > 0 ? x : undefined;
}

const app = express();
app.use(express.json());

// One transport per active MCP session, keyed by session id.
const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports[sessionId] : undefined;

  if (!transport) {
    // A new session must begin with an initialize request and a credential.
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "No valid session ID provided" },
        id: null,
      });
      return;
    }

    const apiKey = extractApiKey(req);
    if (!apiKey) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message:
            "Missing Superior Trade API key. Send it as 'Authorization: Bearer <key>' (or x-api-key). Get a key at https://account.superior.trade.",
        },
        id: null,
      });
      return;
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport!;
      },
      // Block DNS-rebinding when a host allowlist is configured (recommended in
      // production; set MCP_ALLOWED_HOSTS to your deploy domain).
      ...(ALLOWED_HOSTS.length > 0
        ? { enableDnsRebindingProtection: true, allowedHosts: ALLOWED_HOSTS }
        : {}),
    });

    transport.onclose = () => {
      if (transport!.sessionId) delete transports[transport!.sessionId];
    };

    // Per-session server bound to this user's key.
    const server = createServer(new ApiClient(apiKey));
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

// GET = open the SSE stream; DELETE = terminate the session.
const handleSession = async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transport.handleRequest(req, res);
};

app.get("/mcp", handleSession);
app.delete("/mcp", handleSession);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  // stderr so it never corrupts a stdio JSON-RPC stream if mis-launched.
  console.error(`Superior Trade MCP (Streamable HTTP) listening on :${PORT}/mcp`);
});
