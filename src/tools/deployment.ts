import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { ApiClient } from "../client.js";
import { requireConfirmation } from "../confirm.js";

const json = (result: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

export function registerDeploymentTools(server: McpServer, client: ApiClient) {
  server.registerTool(
    "list_deployments",
    {
      description:
        "List all deployments with cursor pagination. Use get_deployment for full details.",
      inputSchema: z.object({
        cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from previous response's nextCursor"),
        pageSize: z.number().optional().describe("Number of items per page"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ cursor, pageSize }) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (pageSize) params.set("pageSize", String(pageSize));
      const qs = params.toString();
      return json(await client.get(`/v2/deployment${qs ? `?${qs}` : ""}`));
    },
  );

  server.registerTool(
    "create_deployment",
    {
      description:
        "Create a live trading deployment. After creation, add credentials with add_deployment_credentials before starting. Creating does not start trading. Config/code validation is the same as backtesting.",
      inputSchema: z.object({
        config: z.object({}).passthrough().describe("Freqtrade configuration object"),
        code: z.string().describe("Python strategy code (valid IStrategy subclass)"),
        name: z.string().describe("Human-readable deployment name"),
      }),
    },
    async ({ config, code, name }) => {
      return json(await client.post("/v2/deployment", { config, code, name }));
    },
  );

  server.registerTool(
    "get_deployment",
    {
      description:
        "Get full deployment details including status, pods, and credentials status. credentialsStatus must be 'stored' before starting.",
      inputSchema: z.object({ id: z.string().describe("Deployment ID") }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => json(await client.get(`/v2/deployment/${id}`)),
  );

  server.registerTool(
    "get_deployment_status",
    {
      description: "Get live deployment status with pod info. Shows real-time K8s status.",
      inputSchema: z.object({ id: z.string().describe("Deployment ID") }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => json(await client.get(`/v2/deployment/${id}/status`)),
  );

  // Starting a deployment with stored credentials commits real capital to a
  // live market. The confirmation is enforced here rather than left to the
  // calling model, and the summary is built from what the API actually
  // reports rather than from what the caller claims.
  server.registerTool(
    "start_deployment",
    {
      description:
        "Start a stopped deployment. If credentials are stored this trades REAL funds and the user is asked to confirm before anything starts. Credentials must be stored first (credentialsStatus: 'stored'); use add_deployment_credentials if missing.",
      inputSchema: z.object({ id: z.string().describe("Deployment ID") }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ id }, ctx) => {
      const deployment = (await client.get(`/v2/deployment/${id}`)) as Record<string, any>;
      const isLive = deployment?.credentialsStatus === "stored";
      const config = deployment?.config ?? {};

      if (isLive) {
        const outcome = requireConfirmation(ctx, {
          action: "Start live deployment",
          details: [
            ["Strategy", deployment?.name ?? id],
            ["Exchange", config?.exchange?.name],
            ["Trading mode", config?.trading_mode],
            ["Pairs", (config?.exchange?.pair_whitelist ?? []).join(", ")],
            ["Stake per trade", config?.stake_amount],
            ["Max open trades", config?.max_open_trades],
            ["Stoploss", config?.stoploss],
            ["Margin mode", config?.margin_mode],
          ],
          consequence:
            "This starts trading with REAL funds from the connected wallet. The agent cannot undo filled trades.",
        });
        if (!outcome.approved) return outcome.result;
      }

      return json(await client.put(`/v2/deployment/${id}/status`, { action: "start" }));
    },
  );

  server.registerTool(
    "stop_deployment",
    {
      description:
        "Stop a running deployment. Scales pods to 0. Can be restarted later with start_deployment.",
      inputSchema: z.object({ id: z.string().describe("Deployment ID") }),
    },
    async ({ id }) => json(await client.put(`/v2/deployment/${id}/status`, { action: "stop" })),
  );

  server.registerTool(
    "add_deployment_credentials",
    {
      description: `Attach deployment credentials through Superior Trade wallet lookup.
The v2 API does not accept private keys. If wallet_address is omitted, Superior uses the user's main trading wallet.
For Hyperliquid subaccounts, pass subaccount_address.`,
      inputSchema: z.object({
        id: z.string().describe("Deployment ID"),
        exchange: z.enum(["hyperliquid", "aerodrome"]).describe("Exchange name"),
        wallet_address: z
          .string()
          .optional()
          .describe("Optional wallet address. Defaults to the user's main trading wallet."),
        subaccount_address: z
          .string()
          .optional()
          .describe("Optional Hyperliquid subaccount address."),
      }),
    },
    async ({ id, exchange, wallet_address, subaccount_address }) => {
      const body: Record<string, string> = { exchange };
      if (wallet_address) body.wallet_address = wallet_address;
      if (subaccount_address) body.subaccount_address = subaccount_address;
      return json(await client.post(`/v2/deployment/${id}/credentials`, body));
    },
  );

  server.registerTool(
    "get_deployment_logs",
    {
      description:
        "Get deployment logs from Cloud Logging. Use to monitor live trading activity or diagnose issues. Supports pagination.",
      inputSchema: z.object({
        id: z.string().describe("Deployment ID"),
        pageSize: z.coerce
          .number()
          .optional()
          .describe("Number of log entries per page (default 100)"),
        pageToken: z.string().optional().describe("Pagination token from previous response"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, pageSize, pageToken }) => {
      const params = new URLSearchParams();
      if (pageSize) params.set("pageSize", String(pageSize));
      if (pageToken) params.set("pageToken", pageToken);
      const qs = params.toString();
      return json(await client.get(`/v2/deployment/${id}/logs${qs ? `?${qs}` : ""}`));
    },
  );

  server.registerTool(
    "delete_deployment",
    {
      description:
        "Permanently delete a deployment and its K8s resources. Stops the deployment first if running. The user is asked to confirm; deletion cannot be undone.",
      inputSchema: z.object({ id: z.string().describe("Deployment ID") }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ id }, ctx) => {
      const deployment = (await client.get(`/v2/deployment/${id}`)) as Record<string, any>;

      const outcome = requireConfirmation(ctx, {
        action: "Permanently delete deployment",
        details: [
          ["Strategy", deployment?.name ?? id],
          ["Current status", deployment?.status],
        ],
        consequence:
          "This deletes the deployment and its resources. A running deployment is stopped first. This cannot be undone.",
      });
      if (!outcome.approved) return outcome.result;

      return json(await client.delete(`/v2/deployment/${id}`));
    },
  );
}
