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
  if (req.method === "GET" && req.url === "/v2/deployment/weird") {
    // No credentialsStatus at all — we cannot prove this is a dry run.
    res.end(JSON.stringify({ id: "weird", name: "Unknown", config: {} }));
    return;
  }
  if (req.method === "GET" && (req.url === "/v2/deployment/dep_1" || req.url === "/v2/deployment/dep_2")) {
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

// 4. Confirmed — a real two-round flow: ask, then answer with the token the
//    server minted for THIS call.
const asked = (await call(startCall({}))).result;
const token = asked?.requestState;
check("the server mints an approval token when it asks", typeof token === "string" && token.length > 0);
const confirmed = (
  await call({
    name: "start_deployment",
    arguments: { id: "dep_1" },
    ...accepted(true),
    requestState: token,
    _meta: ELICIT_CAPABLE,
  })
).result;
check(
  "confirmed start completes",
  confirmed?.resultType === "complete" && !confirmed?.isError,
  `resultType=${confirmed?.resultType}`,
);
check("confirmed start DID start trading", putsSoFar() === 1, `puts=${putsSoFar()}`);

// --- regressions from the adversarial review --------------------------------

// 5. Path traversal: a backtest tool must not reach a deployment endpoint.
const beforeTraversal = seen.length;
const traversal = (
  await call({ name: "start_backtest", arguments: { id: "../deployment/live_1" }, _meta: ELICIT_CAPABLE })
).result;
check(
  "traversal id makes no request at all",
  seen.length === beforeTraversal,
  `api saw: ${seen.slice(beforeTraversal).join(", ") || "nothing"}`,
);
check("traversal id is reported as an error", traversal?.isError === true);

const beforeEncoded = seen.length;
await call({ name: "get_backtest", arguments: { id: "%2e%2e/deployment/dep_1" }, _meta: ELICIT_CAPABLE });
check("percent-encoded traversal makes no request", seen.length === beforeEncoded);

// 6. Replay across deployments: approving dep_1 must not start dep_2.
const asked2 = (await call(startCall({}))).result;
const token2 = asked2?.requestState;
const putsBeforeReplay = putsSoFar();
const replayed = (
  await call({
    name: "start_deployment",
    arguments: { id: "dep_2" },
    ...accepted(true),
    requestState: token2,
    _meta: ELICIT_CAPABLE,
  })
).result;
check(
  "an approval for dep_1 cannot start dep_2",
  putsSoFar() === putsBeforeReplay && replayed?.isError === true,
  `puts ${putsBeforeReplay}->${putsSoFar()}`,
);

// 7. Cross-tool replay: consent to start is not consent to delete.
const deletesBefore = seen.filter((s) => s.startsWith("DELETE")).length;
const crossTool = (
  await call({
    name: "delete_deployment",
    arguments: { id: "dep_1" },
    ...accepted(true),
    requestState: token2,
    _meta: ELICIT_CAPABLE,
  })
).result;
check(
  "an approval to START cannot satisfy DELETE",
  seen.filter((s) => s.startsWith("DELETE")).length === deletesBefore && crossTool?.isError === true,
);

// 8. Forged token.
const putsBeforeForged = putsSoFar();
await call({
  name: "start_deployment",
  arguments: { id: "dep_1" },
  ...accepted(true),
  requestState: "not-a-real-token",
  _meta: ELICIT_CAPABLE,
});
check("a forged approval token does not start trading", putsSoFar() === putsBeforeForged);

// 9. A real decline (action: "decline") must not re-prompt.
const declinedProperly = (
  await call({
    name: "start_deployment",
    arguments: { id: "dep_1" },
    inputResponses: { confirm: { kind: "elicitation", action: "decline" } },
    _meta: ELICIT_CAPABLE,
  })
).result;
check(
  "a real decline is refused, not re-prompted",
  declinedProperly?.resultType !== "input_required" && declinedProperly?.isError === true,
  `resultType=${declinedProperly?.resultType}`,
);

// 10. Fail closed on an unrecognised credentialsStatus.
const putsBeforeOdd = putsSoFar();
const odd = (await call({ name: "start_deployment", arguments: { id: "weird" }, _meta: ELICIT_CAPABLE })).result;
check(
  "an unrecognised credentialsStatus asks rather than starting",
  odd?.resultType === "input_required" && putsSoFar() === putsBeforeOdd,
  `resultType=${odd?.resultType} puts ${putsBeforeOdd}->${putsSoFar()}`,
);

child.kill();
api.close();
console.log(`\n${fail.length === 0 ? "all checks passed" : `${fail.length} check(s) failed`}`);
process.exit(fail.length === 0 ? 0 : 1);
