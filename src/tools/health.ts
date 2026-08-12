import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { ApiClient } from "../client.js";

export function registerHealthTools(server: McpServer, client: ApiClient) {
  server.registerTool(
    "check_health",
    {
      description:
        "Check API health. Use this first to verify connectivity before other operations.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const result = await client.get("/health");
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
