export class ApiClient {
  private resolve(): { baseUrl: string; apiKey: string } {
    const baseUrl = process.env.SUPERIOR_TRADE_API_URL || "https://api.superior.trade";
    const apiKey = process.env.SUPERIOR_TRADE_API_KEY;

    if (!apiKey) throw new Error("SUPERIOR_TRADE_API_KEY environment variable is required");

    return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
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
