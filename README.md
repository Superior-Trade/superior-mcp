# Superior Trade MCP Server

Use Superior Trade from Cursor, Claude Code, Claude Desktop, Windsurf, Codex, or any MCP-compatible local agent.

This server connects your local AI client to the [Superior Trade API](https://api.superior.trade) for market-aware strategy work: create backtests, inspect results, manage deployments, and check API health through typed MCP tools.

[Superior Terminal](https://terminal.superior.trade/) · [API Docs](https://api.superior.trade/docs) · [OpenAPI](https://api.superior.trade/openapi.json)

## When To Use This

Use this MCP server when you already run an agent locally and want that agent to call Superior Trade tools.

If you do not have an agent hosted on your machine, use [Superior Terminal](https://terminal.superior.trade/) instead. Terminal already hosts the agent experience for you, including chat, strategy drafting, backtests, deployments, skills, and workspace artifacts.

## Quick Start

```bash
npm install
npm run build
```

Add your API key to `.mcp.json`:

```json
{
  "mcpServers": {
    "superior-trade": {
      "command": "node",
      "args": ["./dist/index.js"],
      "env": {
        "SUPERIOR_TRADE_API_URL": "https://api.superior.trade",
        "SUPERIOR_TRADE_API_KEY": "st_live_YOUR_KEY"
      }
    }
  }
}
```

Get an API key from Superior Trade, or request one by email:

```bash
curl -X POST https://api.superior.trade/auth/sign-in/magic-link \
  -H "Content-Type: application/json" \
  -d '{ "email": "you@example.com" }'
```

## What You Can Ask

- "Read this market news and turn it into a BTC strategy we can actually backtest."
- "Compare three ways to trade this SOL momentum setup, then run the strongest version."
- "This strategy made money last month but failed this week. Diagnose it and propose a safer variant."
- "If this ETH backtest is strong enough, prepare a deployment plan, but ask me before going live."
- "Check my live deployments and tell me which ones need attention, more capital, or a stop."

## Example Agent Flows

No GIF needed. These are the kinds of flows a local agent can run once this MCP server is connected.

### 1. Research idea -> runnable backtest

```text
You:
Build a 5m BTC momentum strategy. Use futures, cross margin, 1,000 USDC stake,
and test the last 30 days. Keep the stop tight.

Agent:
- Drafts a Freqtrade strategy
- Builds the Superior Trade config
- Calls create_backtest
- Calls start_backtest
- Polls get_backtest_status
- Summarizes win rate, PnL, Sharpe, drawdown, and trade count
```

Useful when you want your editor agent to turn an idea into a real Superior Trade backtest without leaving Cursor, Claude Code, Codex, Windsurf, or Claude Desktop.

### 2. Bad backtest -> fix the strategy

```text
You:
This DOGE strategy is losing money. Read the result and tell me what to change.

Agent:
- Calls get_backtest
- Checks get_backtest_logs if needed
- Explains whether the issue is signal quality, risk, timeframe, or overtrading
- Proposes a safer variant
- Creates a second backtest only after you approve the change
```

Useful when the result matters more than the code. The agent can inspect the actual run, not just guess from the strategy file.

### 3. Proven backtest -> wallet-based deployment

```text
You:
Deploy the best ETH strategy, but do not start it yet.

Agent:
- Calls create_deployment
- Calls add_deployment_credentials with wallet-based Superior Trade lookup
- Shows the deployment status
- Waits for your confirmation before start_deployment
```

The MCP server does not ask for exchange private keys. Superior Trade handles deployment credentials through its managed wallet flow.

### 4. Local agent or hosted Terminal

```text
You:
I do not want to host an MCP server locally.

Agent:
Use Superior Terminal instead: https://terminal.superior.trade/
```

Terminal is the hosted agent experience. This MCP server is for users who already have a local agent running in their editor or desktop client.

## Tools

| Tool | Description |
| --- | --- |
| `check_health` | Verify API connectivity |
| `list_backtests` | List backtests with pagination |
| `create_backtest` | Create a backtest with config, code, and timerange. Put stake sizing in `config.stake_amount` |
| `get_backtest` | Get full backtest details and result metadata |
| `get_backtest_status` | Poll execution status |
| `start_backtest` | Start a pending backtest |
| `cancel_backtest` | Stop a running or pending backtest |
| `get_backtest_logs` | Get execution logs |
| `delete_backtest` | Delete a backtest |
| `list_deployments` | List deployments |
| `create_deployment` | Create a deployment with config, code, and name |
| `get_deployment` | Get full deployment details |
| `get_deployment_status` | Get live status |
| `start_deployment` | Start a stopped deployment |
| `stop_deployment` | Stop a running deployment |
| `add_deployment_credentials` | Attach exchange credentials through Superior-managed wallet lookup |
| `get_deployment_logs` | Get deployment logs |
| `delete_deployment` | Delete a deployment |

## Deployment Credentials

The v2 deployment credential flow is wallet-based. The MCP tool does **not** ask for exchange private keys.

For Hyperliquid, use `add_deployment_credentials` with:

- `exchange`: `hyperliquid`
- `wallet_address` optional. If omitted, Superior uses the user's main trading wallet.
- `subaccount_address` optional for Hyperliquid subaccounts.

Secrets are handled by Superior Trade infrastructure. Do not paste private keys into prompts or MCP inputs.

## Editor Compatibility

| Editor | Config Location |
| --- | --- |
| Claude Code | `.mcp.json` at project root or `.claude/mcp.json` |
| Cursor | `.mcp.json` at project root |
| Windsurf | `.mcp.json` at project root |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |

## Agent Guidance

See [SKILL.md](./SKILL.md) for agent workflow guidance, exchange rules, and strategy templates.

## Local Development

```bash
npm install
npm run build
npm start
```

Environment:

```bash
SUPERIOR_TRADE_API_URL=https://api.superior.trade
SUPERIOR_TRADE_API_KEY=st_live_YOUR_KEY
```
