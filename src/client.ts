const MAX_RESPONSE_CHARS = 200_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  /** Cancellation signal from `ctx.mcpReq.signal`, so a cancelled call stops. */
  signal?: AbortSignal;
}

/**
 * A path segment supplied by the caller — a deployment or backtest id.
 *
 * Ids reach us as free-form tool arguments and are interpolated into the API
 * path. `fetch` resolves `..` segments before sending, so an unvalidated id
 * lets any tool reach any endpoint on the API host carrying the user's key:
 * `start_backtest` with `id: "../deployment/x"` issued
 * `PUT /v2/deployment/x/status`, starting live trading through a tool that
 * never asks for confirmation. Validate at the boundary and encode on the way
 * out; the tool schemas enforce the same shape so bad input is rejected before
 * it gets here.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function assertSafeId(id: string, label = "id"): string {
  if (!SAFE_ID.test(id)) {
    throw new Error(
      `Invalid ${label}: expected letters, digits, underscores or hyphens (max 128 characters).`,
    );
  }
  return id;
}

export class ApiClient {
  private resolve(): { baseUrl: string; apiKey: string } {
    const baseUrl = process.env.SUPERIOR_TRADE_API_URL || "https://api.superior.trade";
    const apiKey = process.env.SUPERIOR_TRADE_API_KEY;

    if (!apiKey) throw new Error("SUPERIOR_TRADE_API_KEY environment variable is required");

    return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<unknown> {
    const { baseUrl, apiKey } = this.resolve();

    // Defence in depth: the tool schemas already constrain ids, but a future
    // caller building a path by hand must not be able to escape the API
    // surface this server is allowed to touch.
    if (path.includes("..") || !/^\/(v2|v3|health|auth)(\/|$)/.test(path)) {
      throw new Error(`Refusing to request an unexpected API path: ${path}`);
    }

    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    };

    // Without a timeout a hung upstream leaves a money-moving call outstanding
    // with no way to observe it; without the caller's signal, a cancelled
    // request still reaches the API.
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

    const res = await fetch(url, {
      method,
      headers,
      signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // A non-JSON body from a JSON API is a failure, not a result. Returning
      // the raw string as success let an HTML error page through as though the
      // call had worked.
      if (res.ok) {
        throw new Error(
          `Expected JSON from ${method} ${path} but received ${res.headers.get("content-type") ?? "an unknown content type"}.`,
        );
      }
      data = text;
    }

    if (!res.ok) {
      // Upstream bodies can carry stack traces and internal paths. Report the
      // status and a bounded excerpt rather than echoing the whole thing.
      const detail = typeof data === "string" ? data : JSON.stringify(data);
      throw new Error(`HTTP ${res.status}: ${detail.slice(0, 500)}`);
    }

    const serialized = JSON.stringify(data);
    if (serialized && serialized.length > MAX_RESPONSE_CHARS) {
      throw new Error(
        `Response from ${method} ${path} is ${serialized.length} characters, over the ${MAX_RESPONSE_CHARS} limit. Narrow the request (for example with pageSize).`,
      );
    }

    return data;
  }

  async get(path: string, options?: RequestOptions): Promise<unknown> {
    return this.request("GET", path, undefined, options);
  }

  async post(path: string, body: unknown, options?: RequestOptions): Promise<unknown> {
    return this.request("POST", path, body, options);
  }

  async put(path: string, body: unknown, options?: RequestOptions): Promise<unknown> {
    return this.request("PUT", path, body, options);
  }

  async delete(path: string, options?: RequestOptions): Promise<unknown> {
    return this.request("DELETE", path, undefined, options);
  }
}
