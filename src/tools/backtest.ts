import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { ApiClient } from "../client.js";

const SafeId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, "must be letters, digits, underscores or hyphens");

const json = (result: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

export function registerBacktestTools(server: McpServer, client: ApiClient) {
  server.registerTool(
    "list_backtests",
    {
      description:
        "List all backtests with cursor pagination. Use get_backtest for full details on a specific backtest.",
      inputSchema: z.object({
        cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from previous response's nextCursor"),
        pageSize: z.coerce.number().optional().describe("Number of items per page"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ cursor, pageSize }) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (pageSize) params.set("pageSize", String(pageSize));
      const qs = params.toString();
      return json(await client.get(`/v2/backtesting${qs ? `?${qs}` : ""}`));
    },
  );

  server.registerTool(
    "create_backtest",
    {
      description: `Create a new backtest. After creation, use start_backtest to begin execution.
Config must include exchange, stake_currency, timeframe, stoploss, pairlists.
Code must be a valid Freqtrade IStrategy subclass.
Spot pairs: BTC/USDC, futures pairs: BTC/USDC:USDC.
Futures requires trading_mode and margin_mode in config.
Do NOT include dry_run or api_server in config.`,
      inputSchema: z.object({
        config: z.record(z.string(), z.any()).describe("Freqtrade configuration object"),
        code: z.string().describe("Python strategy code (valid IStrategy subclass)"),
        timerange: z
          .object({
            start: z.string().describe("Start date YYYY-MM-DD"),
            end: z.string().describe("End date YYYY-MM-DD"),
          })
          .describe("Backtest time range"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ config, code, timerange }) => {
      return json(await client.post("/v2/backtesting", { config, code, timerange }));
    },
  );

  server.registerTool(
    "get_backtest",
    {
      description:
        "Get full backtest details including config, code, results. Use after backtest completes to see metrics (total_trades, win_rate, total_profit, max_drawdown, sharpe_ratio).",
      inputSchema: z.object({ id: SafeId.describe("Backtest ID") }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => json(await client.get(`/v2/backtesting/${id}`)),
  );

  server.registerTool(
    "get_backtest_status",
    {
      description:
        "Poll backtest execution status. Returns status (pending/running/completed/failed/cancelled) and results if completed. Poll every 10s until terminal state. If failed, use get_backtest_logs to diagnose.",
      inputSchema: z.object({ id: SafeId.describe("Backtest ID") }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => json(await client.get(`/v2/backtesting/${id}/status`)),
  );

  server.registerTool(
    "start_backtest",
    {
      description:
        "Start a pending backtest. Backtest must be in 'pending' status. After starting, poll with get_backtest_status every 10s until completed or failed. Backtests are simulations and never touch real funds.",
      inputSchema: z.object({ id: SafeId.describe("Backtest ID") }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ id }) => json(await client.put(`/v2/backtesting/${id}/status`, { action: "start" })),
  );

  server.registerTool(
    "cancel_backtest",
    {
      description: "Stop a running or pending backtest.",
      inputSchema: z.object({ id: SafeId.describe("Backtest ID") }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => json(await client.put(`/v2/backtesting/${id}/status`, { action: "stop" })),
  );

  server.registerTool(
    "get_backtest_logs",
    {
      description:
        "Get backtest execution logs. Use when a backtest fails to diagnose the issue. Supports pagination.",
      inputSchema: z.object({
        id: SafeId.describe("Backtest ID"),
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
      return json(await client.get(`/v2/backtesting/${id}/logs${qs ? `?${qs}` : ""}`));
    },
  );

  server.registerTool(
    "delete_backtest",
    {
      description: "Permanently delete a backtest and its results.",
      inputSchema: z.object({ id: SafeId.describe("Backtest ID") }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => json(await client.delete(`/v2/backtesting/${id}`)),
  );
}
