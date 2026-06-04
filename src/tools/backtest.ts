import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "../client.js";

export function registerBacktestTools(server: McpServer, client: ApiClient) {
  server.tool(
    "list_backtests",
    "List all backtests with cursor pagination. Use get_backtest for full details on a specific backtest.",
    {
      cursor: z.string().optional().describe("Pagination cursor from previous response's nextCursor"),
      pageSize: z.number().optional().describe("Number of items per page"),
    },
    async ({ cursor, pageSize }) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (pageSize) params.set("pageSize", String(pageSize));
      const qs = params.toString();
      const result = await client.get(`/v2/backtesting${qs ? `?${qs}` : ""}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "create_backtest",
    `Create a new backtest. After creation, use start_backtest to begin execution.
Config must include exchange, stake_currency, timeframe, stoploss, pairlists.
Code must be a valid Freqtrade IStrategy subclass.
Spot pairs: BTC/USDC, futures pairs: BTC/USDC:USDC.
Futures requires trading_mode and margin_mode in config.
Do NOT include dry_run or api_server in config.`,
    {
      config: z.record(z.string(), z.any()).describe("Freqtrade configuration object"),
      code: z.string().describe("Python strategy code (valid IStrategy subclass)"),
      timerange: z.object({
        start: z.string().describe("Start date YYYY-MM-DD"),
        end: z.string().describe("End date YYYY-MM-DD"),
      }).describe("Backtest time range"),
    },
    async ({ config, code, timerange }) => {
      const result = await client.post("/v2/backtesting", { config, code, timerange });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_backtest",
    "Get full backtest details including config, code, results. Use after backtest completes to see metrics (total_trades, win_rate, total_profit, max_drawdown, sharpe_ratio).",
    {
      id: z.string().describe("Backtest ID"),
    },
    async ({ id }) => {
      const result = await client.get(`/v2/backtesting/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_backtest_status",
    "Poll backtest execution status. Returns status (pending/running/completed/failed/cancelled) and results if completed. Poll every 10s until terminal state. If failed, use get_backtest_logs to diagnose.",
    {
      id: z.string().describe("Backtest ID"),
    },
    async ({ id }) => {
      const result = await client.get(`/v2/backtesting/${id}/status`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "start_backtest",
    "Start a pending backtest. Backtest must be in 'pending' status. After starting, poll with get_backtest_status every 10s until completed or failed.",
    {
      id: z.string().describe("Backtest ID"),
    },
    async ({ id }) => {
      const result = await client.put(`/v2/backtesting/${id}/status`, { action: "start" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "cancel_backtest",
    "Stop a running or pending backtest.",
    {
      id: z.string().describe("Backtest ID"),
    },
    async ({ id }) => {
      const result = await client.put(`/v2/backtesting/${id}/status`, { action: "stop" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_backtest_logs",
    "Get backtest execution logs. Use when a backtest fails to diagnose the issue. Supports pagination.",
    {
      id: z.string().describe("Backtest ID"),
      pageSize: z.coerce.number().optional().describe("Number of log entries per page (default 100)"),
      pageToken: z.string().optional().describe("Pagination token from previous response"),
    },
    async ({ id, pageSize, pageToken }) => {
      const params = new URLSearchParams();
      if (pageSize) params.set("pageSize", String(pageSize));
      if (pageToken) params.set("pageToken", pageToken);
      const qs = params.toString();
      const result = await client.get(`/v2/backtesting/${id}/logs${qs ? `?${qs}` : ""}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "delete_backtest",
    "Permanently delete a backtest and its results.",
    {
      id: z.string().describe("Backtest ID"),
    },
    async ({ id }) => {
      const result = await client.delete(`/v2/backtesting/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
