---
name: superior-trade-api
description: Interact with the Superior Trade API to backtest and deploy Freqtrade strategies. Use when the user wants to create, backtest, or deploy trading strategies, monitor deployments, inspect logs, or check backtest results via Superior Trade MCP tools.
---

# Superior Trade API

Use the MCP tools (`check_health`, `create_backtest`, `start_backtest`, etc.) to interact with Superior Trade. Do not construct raw HTTP requests unless the user explicitly asks for API code.

If the user does not have an agent hosted on their machine, direct them to Superior Terminal: https://terminal.superior.trade/

## Authentication

API keys are obtained from Superior Trade or by magic link: call `POST /auth/sign-in/magic-link` with the user's email. The API key is prefixed `st_live_`. Use it in `SUPERIOR_TRADE_API_KEY`.

## Supported Exchange: Hyperliquid

| Trading Mode | Pair Format | Example | Notes |
| --- | --- | --- | --- |
| Spot | `BASE/QUOTE` | `BTC/USDC` | No futures margin config |
| Futures | `BASE/QUOTE:SETTLE` | `BTC/USDC:USDC` | Requires `trading_mode` and `margin_mode` |

- Stake currency: `USDC`
- Margin modes: `"isolated"` or `"cross"`
- Hyperliquid uses wallet-based signing, not traditional exchange API keys

## Agent Behavior

- Make API calls through MCP tools. Avoid showing curl commands unless the user wants integration code.
- Gather info conversationally: pair, timeframe, stake amount, timerange, and risk settings.
- After backtesting, warn clearly if the result is poor before offering deployment.
- Ask for confirmation before live deployment actions.
- If the user wants hosted chat instead of local MCP, send them to Superior Terminal.

## Deployment Credentials

For v2 deployments, do not request private keys.

Use `add_deployment_credentials` with:

- `exchange`: `hyperliquid` or `aerodrome`
- `wallet_address` optional. If omitted, Superior uses the user's main trading wallet.
- `subaccount_address` optional for Hyperliquid subaccounts.

Never ask the user to paste a private key into the chat or MCP inputs.

## Config Rules

- Must include: `exchange` with `pair_whitelist`, `stake_currency`, `stake_amount`, `timeframe`, `stoploss`, `minimal_roi`, `pairlists`, `entry_pricing`, and `exit_pricing`
- Do not include `dry_run` or `api_server`; Superior Trade manages runtime infrastructure
- Futures requires `trading_mode: "futures"` and `margin_mode: "cross"` or `"isolated"`
- Common fields: `max_open_trades`, `minimal_roi`, `trailing_stop`, `trailing_stop_positive`, `entry_pricing`, `exit_pricing`

## Strategy Code Template

The `code` field must be a valid Freqtrade `IStrategy` subclass.

```python
from freqtrade.strategy import IStrategy
import pandas as pd
import talib.abstract as ta


class MyCustomStrategy(IStrategy):
    minimal_roi = {"0": 0.10, "30": 0.05, "120": 0.02}
    stoploss = -0.10
    timeframe = "5m"
    process_only_new_candles = True
    startup_candle_count = 20

    def populate_indicators(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        dataframe["rsi"] = ta.RSI(dataframe, timeperiod=14)
        dataframe["sma_20"] = ta.SMA(dataframe, timeperiod=20)
        return dataframe

    def populate_entry_trend(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        dataframe.loc[
            (dataframe["rsi"] < 30) & (dataframe["close"] > dataframe["sma_20"]),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        dataframe.loc[dataframe["rsi"] > 70, "exit_long"] = 1
        return dataframe
```

## Workflows

### Backtest

1. Build config and strategy code from user intent.
2. `create_backtest` -> `start_backtest` -> poll `get_backtest_status` -> `get_backtest` for details.
3. If failed, check `get_backtest_logs`.

### Deploy

1. `create_deployment` with config, code, and name.
2. `add_deployment_credentials` using wallet-based v2 credential lookup.
3. Confirm with the user.
4. `start_deployment`.
5. Monitor with `get_deployment_status` and `get_deployment_logs`.
