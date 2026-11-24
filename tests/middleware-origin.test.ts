import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../src/middleware";
import { originAllowed } from "../src/lib/origin-guard";

describe("originAllowed (cross-site write protection)", () => {
  const base = { method: "POST", origin: null as string | null, host: "workspace.example.com", forwardedHost: null as string | null, secFetchSite: null as string | null, appUrl: "https://workspace.example.com" };

  it("never blocks safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(originAllowed({ ...base, method, origin: "https://evil.example" })).toBe(true);
    }
  });

  it("allows a write from the same origin", () => {
    expect(originAllowed({ ...base, origin: "https://workspace.example.com" })).toBe(true);
  });

  it("allows the configured APP_URL host even when the proxy rewrites Host", () => {
    expect(originAllowed({ ...base, host: "10.0.0.5:3000", origin: "https://workspace.example.com" })).toBe(true);
  });

  it("allows the forwarded host set by the reverse proxy", () => {
    expect(originAllowed({ ...base, host: "10.0.0.5:3000", forwardedHost: "workspace.example.com", appUrl: undefined, origin: "https://workspace.example.com" })).toBe(true);
  });

  it("blocks a write from another site, including a sibling sub-domain", () => {
    expect(originAllowed({ ...base, origin: "https://evil.example" })).toBe(false);
    expect(originAllowed({ ...base, origin: "https://oms.example.com" })).toBe(false);
    expect(originAllowed({ ...base, origin: "https://workspace.example.com.evil.example" })).toBe(false);
  });

  it("blocks the opaque 'null' origin and unparsable origins", () => {
    expect(originAllowed({ ...base, origin: "null" })).toBe(false);
    expect(originAllowed({ ...base, origin: "not a url" })).toBe(false);
  });

  it("without an Origin header it falls back to Fetch Metadata", () => {
    expect(originAllowed({ ...base, secFetchSite: "same-origin" })).toBe(true);
    expect(originAllowed({ ...base, secFetchSite: "none" })).toBe(true);
    expect(originAllowed({ ...base, secFetchSite: "same-site" })).toBe(false);
    expect(originAllowed({ ...base, secFetchSite: "cross-site" })).toBe(false);
  });

  it("allows non-browser clients that send neither header (curl, servers)", () => {
    expect(originAllowed(base)).toBe(true);
  });
});

describe("middleware", () => {
  function req(path: string, init: { method?: string; headers?: Record<string, string>; cookie?: boolean } = {}) {
    const headers = new Headers({ host: "localhost:3000", ...init.headers });
    if (init.cookie) headers.set("cookie", "zaki_session=abc");
    return new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers });
  }

  it("rejects a cross-site write to the API with 403", async () => {
    const res = await middleware(req("/api/tasks", { method: "POST", headers: { origin: "https://evil.example" }, cookie: true }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden", message: "origin.mismatch" });
  });

  it("rejects a cross-site LOGIN attempt too (login CSRF)", async () => {
    const res = await middleware(req("/api/auth/login", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("lets same-origin writes through", async () => {
    const res = await middleware(req("/api/tasks", { method: "POST", headers: { origin: "http://localhost:3000" }, cookie: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not apply the browser origin rule to machine-to-machine endpoints", async () => {
    const inbound = await middleware(req("/api/integrations/n8n/inbound", { method: "POST", headers: { origin: "https://n8n.example" } }));
    expect(inbound.headers.get("x-middleware-next")).toBe("1");
    const v1 = await middleware(req("/api/v1/ideas", { method: "POST", headers: { origin: "https://other.example" } }));
    expect(v1.headers.get("x-middleware-next")).toBe("1");
  });

  it("the machine-endpoint exemption has a path boundary (a look-alike path is not exempt)", async () => {
    const evil = { origin: "https://evil.example" };
    for (const path of ["/api/healthx", "/api/health-check", "/api/v1x/ideas", "/api/integrations/n8n/inbound-evil", "/api/integrations/n8n/inboundx"]) {
      const res = await middleware(req(path, { method: "POST", headers: evil, cookie: true }));
      expect(res.status, path).toBe(403);
    }
    // the real ones, with or without a trailing slash or sub-path
    for (const path of ["/api/health", "/api/health/", "/api/integrations/n8n/inbound", "/api/integrations/n8n/inbound/", "/api/v1/ideas", "/api/v1"]) {
      const res = await middleware(req(path, { method: "POST", headers: evil }));
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("a cookie-less call to /mcp (a real MCP client) reaches the server, never the login page; its own Bearer decides", async () => {
    for (const method of ["POST", "GET"]) {
      const res = await middleware(req("/mcp", { method, headers: { authorization: "Bearer zws_x", "content-type": "application/json" } }));
      expect(res.status, method).not.toBe(307);
      expect(res.headers.get("location"), method).toBeNull();
      expect(res.headers.get("x-middleware-next"), method).toBe("1");
    }
    // with a sub-path too, and a look-alike is still a page behind the login
    expect((await middleware(req("/mcp/", { method: "POST" }))).headers.get("x-middleware-next")).toBe("1");
    const lookalike = await middleware(req("/mcpx", { method: "POST" }));
    expect(lookalike.status).toBe(307);
  });

  it("still redirects anonymous page requests to /login", async () => {
    const res = await middleware(req("/projects"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?next=%2Fprojects");
  });

  it("the sign-in pages and their API stay public", async () => {
    for (const path of ["/login", "/register", "/register/check-email", "/register/confirm"]) {
      expect((await middleware(req(path))).headers.get("x-middleware-next"), path).toBe("1");
    }
    for (const path of ["/api/auth/login", "/api/auth/register", "/api/auth/register/confirm"]) {
      const res = await middleware(req(path, { method: "POST", headers: { origin: "http://localhost:3000" } }));
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
    }
  });
});
