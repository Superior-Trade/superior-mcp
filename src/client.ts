export class ApiClient {
  /**
   * @param apiKey  Per-instance key. Omit for the stdio/local server (reads
   *   SUPERIOR_TRADE_API_KEY from env). The HTTP transport passes the key from
   *   each request so one server can serve many users (one key per session).
   */
  constructor(
    private readonly apiKey?: string,
    private readonly baseUrl: string = process.env.SUPERIOR_TRADE_API_URL || "https://api.superior.trade",
  ) {}

  private resolve(): { baseUrl: string; apiKey: string } {
    const apiKey = this.apiKey ?? process.env.SUPERIOR_TRADE_API_KEY;

    if (!apiKey) {
      throw new Error(
        "SUPERIOR_TRADE_API_KEY is required (env var for the local/stdio server, or an Authorization: Bearer <key> header for the HTTP server)",
      );
    }

    return { baseUrl: this.baseUrl.replace(/\/$/, ""), apiKey };
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const { baseUrl, apiKey } = this.resolve();
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    }

    return data;
  }

  async get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }

  async put(path: string, body: unknown): Promise<unknown> {
    return this.request("PUT", path, body);
  }

  async delete(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }
}
