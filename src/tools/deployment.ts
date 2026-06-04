import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "../client.js";

export function registerDeploymentTools(server: McpServer, client: ApiClient) {
  server.tool(
    "list_deployments",
    "List all deployments with cursor pagination. Use get_deployment for full details.",
    {
      cursor: z.string().optional().describe("Pagination cursor from previous response's nextCursor"),
      pageSize: z.number().optional().describe("Number of items per page"),
    },
    async ({ cursor, pageSize }) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (pageSize) params.set("pageSize", String(pageSize));
      const qs = params.toString();
      const result = await client.get(`/v2/deployment${qs ? `?${qs}` : ""}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "create_deployment",
    "Create a live trading deployment. After creation, add credentials with add_deployment_credentials before starting. Config/code validation is the same as backtesting.",
    {
      config: z.object({}).passthrough().describe("Freqtrade configuration object"),
      code: z.string().describe("Python strategy code (valid IStrategy subclass)"),
      name: z.string().describe("Human-readable deployment name"),
    },
    async ({ config, code, name }) => {
      const result = await client.post("/v2/deployment", { config, code, name });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_deployment",
    "Get full deployment details including status, pods, and credentials status. credentialsStatus must be 'stored' before starting.",
    {
      id: z.string().describe("Deployment ID"),
    },
    async ({ id }) => {
      const result = await client.get(`/v2/deployment/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_deployment_status",
    "Get live deployment status with pod info. Shows real-time K8s status.",
    {
      id: z.string().describe("Deployment ID"),
    },
    async ({ id }) => {
      const result = await client.get(`/v2/deployment/${id}/status`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "start_deployment",
    "Start a stopped deployment. Credentials must be stored first (credentialsStatus: 'stored'). Use add_deployment_credentials if missing.",
    {
      id: z.string().describe("Deployment ID"),
    },
    async ({ id }) => {
      const result = await client.put(`/v2/deployment/${id}/status`, { action: "start" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "stop_deployment",
    "Stop a running deployment. Scales pods to 0. Can be restarted later with start_deployment.",
    {
      id: z.string().describe("Deployment ID"),
    },
    async ({ id }) => {
      const result = await client.put(`/v2/deployment/${id}/status`, { action: "stop" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "add_deployment_credentials",
    `Attach deployment credentials through Superior Trade wallet lookup.
The v2 API does not accept private keys. If wallet_address is omitted, Superior uses the user's main trading wallet.
For Hyperliquid subaccounts, pass subaccount_address.`,
    {
      id: z.string().describe("Deployment ID"),
      exchange: z.enum(["hyperliquid", "aerodrome"]).describe("Exchange name"),
      wallet_address: z.string().optional().describe("Optional wallet address. Defaults to the user's main trading wallet."),
      subaccount_address: z.string().optional().describe("Optional Hyperliquid subaccount address."),
    },
    async ({ id, exchange, wallet_address, subaccount_address }) => {
      const body: Record<string, string> = { exchange };
      if (wallet_address) body.wallet_address = wallet_address;
      if (subaccount_address) body.subaccount_address = subaccount_address;
      const result = await client.post(`/v2/deployment/${id}/credentials`, body);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_deployment_logs",
    "Get deployment logs from Cloud Logging. Use to monitor live trading activity or diagnose issues. Supports pagination.",
    {
      id: z.string().describe("Deployment ID"),
      pageSize: z.coerce.number().optional().describe("Number of log entries per page (default 100)"),
      pageToken: z.string().optional().describe("Pagination token from previous response"),
    },
    async ({ id, pageSize, pageToken }) => {
      const params = new URLSearchParams();
      if (pageSize) params.set("pageSize", String(pageSize));
      if (pageToken) params.set("pageToken", pageToken);
      const qs = params.toString();
      const result = await client.get(`/v2/deployment/${id}/logs${qs ? `?${qs}` : ""}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "delete_deployment",
    "Permanently delete a deployment and its K8s resources. Stops the deployment first if running.",
    {
      id: z.string().describe("Deployment ID"),
    },
    async ({ id }) => {
      const result = await client.delete(`/v2/deployment/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
