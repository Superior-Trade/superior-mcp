// Proves the MRTR confirmation gate actually blocks a live start.
//
// Stands up a stub Superior API that records every request, drives the built
// server over stdio one call at a time, and asserts what reached the API after
// each call — an unconfirmed start must never issue the PUT.
//
//   node scripts/gate-smoke.mjs

import { createServer } from "node:http";
import { spawn } from "node:child_process";

const seen = [];

const api = createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`);
  res.setHeader("content-type", "application/json");
  if (req.method === "GET" && req.url === "/v2/deployment/dep_1") {
    res.end(
      JSON.stringify({
        id: "dep_1",
        name: "BB Reverter 4h",
        status: "stopped",
        credentialsStatus: "stored",
        config: {
          exchange: { name: "hyperliquid", pair_whitelist: ["BTC/USDC:USDC"] },
          trading_mode: "futures",
          margin_mode: "isolated",
          stake_amount: 45,
          max_open_trades: 2,
          stoploss: -0.08,
        },
      }),
    );
    return;
  }
  res.end(JSON.stringify({ ok: true, echo: req.url }));
});

await new Promise((r) => api.listen(0, r));
const apiUrl = `http://127.0.0.1:${api.address().port}`;

const meta = (capabilities) => ({
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "gate-smoke", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": capabilities,
});

const ELICIT_CAPABLE = meta({ elicitation: { form: {} } });
const ELICIT_INCAPABLE = meta({});

const child = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env, SUPERIOR_TRADE_API_URL: apiUrl, SUPERIOR_TRADE_API_KEY: "st_live_stub" },
  stdio: ["pipe", "pipe", "inherit"],
});

const pending = new Map();
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});

let nextId = 1;
// One call at a time, so `seen` after each await belongs to that call alone.
function call(params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params }) + "\n");
    setTimeout(() => reject(new Error(`timeout on request ${id}`)), 10000);
  });
}

const startCall = (extra, _meta = ELICIT_CAPABLE) => ({
  name: "start_deployment",
  arguments: { id: "dep_1" },
  _meta,
  ...extra,
});

const accepted = (value) => ({
  inputResponses: {
    confirm: { kind: "elicitation", action: "accept", content: { confirm: value } },
  },
});

const fail = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(label);
};
const putsSoFar = () => seen.filter((s) => s === "PUT /v2/deployment/dep_1/status").length;

// 1. Unconfirmed.
const unconfirmed = (await call(startCall({}))).result;
check(
  "unconfirmed start returns input_required",
  unconfirmed?.resultType === "input_required",
  `resultType=${unconfirmed?.resultType}`,
);
const asText = JSON.stringify(unconfirmed ?? {});
check(
  "the prompt states the strategy, the pair and that funds are real",
  asText.includes("BB Reverter 4h") && asText.includes("BTC/USDC:USDC") && /REAL funds/.test(asText),
);
check("unconfirmed start did NOT start trading", putsSoFar() === 0, `puts=${putsSoFar()}`);

// 2. Declined.
const declined = (await call(startCall(accepted(false)))).result;
check(
  "a declined start is refused rather than re-prompted",
  declined?.isError === true && declined?.resultType !== "input_required",
  `resultType=${declined?.resultType} isError=${declined?.isError}`,
);
check("declined start did NOT start trading", putsSoFar() === 0, `puts=${putsSoFar()}`);

// 3. Client that cannot show a confirmation at all.
const incapable = (await call(startCall({}, ELICIT_INCAPABLE))).result;
check(
  "a client that cannot confirm gets a clear refusal, not a protocol error",
  incapable?.isError === true && /cannot present one/.test(JSON.stringify(incapable)),
  incapable ? "" : "got a JSON-RPC error instead of a tool result",
);
check("incapable client did NOT start trading", putsSoFar() === 0, `puts=${putsSoFar()}`);

// 4. Confirmed.
const confirmed = (await call(startCall(accepted(true)))).result;
check(
  "confirmed start completes",
  confirmed?.resultType === "complete" && !confirmed?.isError,
  `resultType=${confirmed?.resultType}`,
);
check("confirmed start DID start trading", putsSoFar() === 1, `puts=${putsSoFar()}`);

child.kill();
api.close();
console.log(`\n${fail.length === 0 ? "all checks passed" : `${fail.length} check(s) failed`}`);
process.exit(fail.length === 0 ? 0 : 1);
