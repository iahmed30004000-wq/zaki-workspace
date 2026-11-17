import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Q1.0: the client of the orders system. Bearer token, a base URL judged by the SSRF guard on every call, 5 seconds, no
 * redirects, failures written as events, and NEVER the token or a response body in an error, an event or a log.
 */
const TOKEN = "omsk_live_SECRET_TOKEN_VALUE_123";
const events: Array<{ orgId: string; input: Record<string, unknown> }> = [];
const state = vi.hoisted(() => ({ connected: true, config: { baseUrl: "https://oms.example.test" } as Record<string, unknown> | null }));

vi.mock("@/server/services/integrations", () => ({
  requireConnected: vi.fn(async () => {
    if (!state.connected) {
      const { NotFoundError } = await import("@/server/auth");
      throw new NotFoundError("integration.not_connected");
    }
    return { row: { config: state.config, id: "i1" }, secrets: { token: TOKEN } };
  }),
  logEvent: vi.fn(async (orgId: string, input: Record<string, unknown>) => {
    events.push({ orgId, input });
  }),
}));

const publicResolve = async () => ["93.184.216.34"];
const ok = (body: unknown, init: ResponseInit = { status: 200 }) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

describe("the orders system client", () => {
  let oms: typeof import("@/server/integrations/oms");
  beforeEach(async () => {
    events.length = 0;
    state.connected = true;
    state.config = { baseUrl: "https://oms.example.test" };
    vi.resetModules();
    oms = await import("@/server/integrations/oms");
  });

  it("reads the products with the bearer token, no redirects, and the snapshot shape", async () => {
    const fetchImpl = vi.fn(async () => ok({ data: [{ code: "A-1", name: "منتج", price: 5, currency: "JOD" }] }));
    const rows = await oms.listProducts("org1", { fetchImpl, resolve: publicResolve });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "A-1", price: 5 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oms.example.test/api/v1/products");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(init.redirect).toBe("manual");
    expect(init.method ?? "GET").toBe("GET");
    expect(events).toEqual([]);
  });

  it("reads an order's state by the system's own id, encoded, and keeps only its state fields", async () => {
    const fetchImpl = vi.fn(async () => ok({ id: "o/1", number: "A-9", status: "SHIPPED", updated_at: "2026-11-17T10:00:00Z", customer: { name: "زبون", phone: "0790000000" } }));
    const st = await oms.orderStatus("org1", "o/1", { fetchImpl, resolve: publicResolve });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://oms.example.test/api/v1/orders/o%2F1");
    expect(st).toEqual({ number: "A-9", status: "SHIPPED", updatedAt: "2026-11-17T10:00:00Z" });
    expect(JSON.stringify(st)).not.toMatch(/زبون|0790000000|customer/);
  });

  it("posts a note with an idempotency key and the body { note }", async () => {
    const fetchImpl = vi.fn(async () => ok({ ok: true }, { status: 201 }));
    await oms.addOrderNote("org1", "o1", "ملاحظة", "key-1", { fetchImpl, resolve: publicResolve });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oms.example.test/api/v1/orders/o1/notes");
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h["Idempotency-Key"]).toBe("key-1");
    expect(h["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ note: "ملاحظة" });
  });

  it("an HTTP error is an event and an error; neither holds the token or the response body", async () => {
    const fetchImpl = vi.fn(async () => new Response(`internal: ${TOKEN} customer 0790000000`, { status: 500 }));
    const err = await oms.listProducts("org1", { fetchImpl, resolve: publicResolve }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(oms.OmsError);
    expect((err as InstanceType<typeof oms.OmsError>).code).toBe("http_500");
    expect(events).toHaveLength(1);
    expect(events[0]!.input).toMatchObject({ direction: "OUT", type: "oms.products", status: "FAILED", detail: "oms.http_500" });
    const all = JSON.stringify(events) + String((err as Error).message) + String((err as Error).stack);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("0790000000");
  });

  it("a redirect is not followed and is a failure", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example.test/" } }));
    const err = (await oms.listProducts("org1", { fetchImpl, resolve: publicResolve }).catch((e: unknown) => e)) as InstanceType<typeof oms.OmsError>;
    expect(err.code).toBe("redirect");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a base URL on a private network is refused before anything is sent", async () => {
    state.config = { baseUrl: "https://oms.internal.test" };
    const fetchImpl = vi.fn();
    const err = (await oms.listProducts("org1", { fetchImpl: fetchImpl as never, resolve: async () => ["10.0.0.5"] }).catch((e: unknown) => e)) as InstanceType<typeof oms.OmsError>;
    expect(err.code).toBe("url_private");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(events[0]!.input["detail"]).toBe("oms.url_private");
  });

  it("plain http and a missing base URL are refused", async () => {
    state.config = { baseUrl: "http://oms.example.test" };
    const f = vi.fn();
    expect(((await oms.listProducts("org1", { fetchImpl: f as never, resolve: publicResolve }).catch((e: unknown) => e)) as InstanceType<typeof oms.OmsError>).code).toBe("url_https_only");
    state.config = null;
    expect(((await oms.listProducts("org1", { fetchImpl: f as never, resolve: publicResolve }).catch((e: unknown) => e)) as InstanceType<typeof oms.OmsError>).code).toBe("no_base_url");
    expect(f).not.toHaveBeenCalled();
  });

  it("gives up after 5 seconds", async () => {
    const fetchImpl = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = oms.listProducts("org1", { fetchImpl: fetchImpl as never, resolve: publicResolve, timeoutMs: 30 });
    const err = (await p.catch((e: unknown) => e)) as InstanceType<typeof oms.OmsError>;
    expect(err.code).toBe("timeout");
    expect(events[0]!.input["detail"]).toBe("oms.timeout");
  });

  it("the default wait is 5 seconds", () => {
    expect(oms.OMS_TIMEOUT_MS).toBe(5000);
  });

  it("a system that is not connected is an error, not an event", async () => {
    state.connected = false;
    const err = await oms.listProducts("org1", { fetchImpl: vi.fn() as never, resolve: publicResolve }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(events).toEqual([]);
  });

  it("an answer that is not JSON is a failure with no body in it", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>login page with 0790000000</html>", { status: 200 }));
    const err = (await oms.listProducts("org1", { fetchImpl, resolve: publicResolve }).catch((e: unknown) => e)) as InstanceType<typeof oms.OmsError>;
    expect(err.code).toBe("bad_body");
    expect(JSON.stringify(events)).not.toContain("0790000000");
  });
});
