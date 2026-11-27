import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../src/middleware";
import { SECURITY_HEADERS, securityHeaders } from "../src/lib/security-headers";

/**
 * Security review D3: nothing set the headers that keep the app out of somebody else's frame and
 * keep its addresses out of somebody else's logs. They are on EVERY response the middleware answers
 * — a page, a redirect, a refusal, and the API and file bytes that pass through.
 */

function ask(pathname: string, opts: { proto?: "https" | "http"; service?: boolean } = {}) {
  const proto = opts.proto ?? "https";
  // no session cookie: the middleware redirects to /login, which is a response like any other
  const req = new NextRequest(`${proto}://workspace.example.com${pathname}`, { headers: { host: "workspace.example.com" } });
  return middleware(req);
}

describe("every response carries the security headers", () => {
  it("a page visit (redirected to /login without a session) has them", async () => {
    const res = await ask("/projects");
    expect(res.status).toBe(307);
    for (const [name, value] of SECURITY_HEADERS) expect(res.headers.get(name), name).toBe(value);
  });

  it("an API response has them", async () => {
    const res = await ask("/api/tasks");
    for (const [name, value] of SECURITY_HEADERS) expect(res.headers.get(name), name).toBe(value);
  });

  it("a refused cross-site write has them too", async () => {
    const req = new NextRequest("https://workspace.example.com/api/tasks", {
      method: "POST",
      headers: { host: "workspace.example.com", origin: "https://sibling.example.com", "content-type": "application/json" },
    });
    const res = await middleware(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("the file preview still frames its own PDF: the rule is 'self', not 'none'", async () => {
    expect(SECURITY_HEADERS.find(([name]) => name === "x-frame-options")?.[1]).toBe("SAMEORIGIN");
    expect(SECURITY_HEADERS.find(([name]) => name === "content-security-policy")?.[1]).toContain("frame-ancestors 'self'");
  });

  it("HSTS only on an https visit, never over http", async () => {
    expect((await ask("/projects")).headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect((await ask("/projects", { proto: "http" })).headers.get("strict-transport-security")).toBeNull();
    expect(securityHeaders({ https: false }).map(([n]) => n)).not.toContain("strict-transport-security");
  });

  it("calls keep the camera and the microphone for this site only, and geolocation is this site's alone («إرسال الموقع»)", async () => {
    const policy = SECURITY_HEADERS.find(([name]) => name === "permissions-policy")?.[1] ?? "";
    // the owner lifted the block for OUR OWN pages only (2026-11-27): no frame of another site may ask, and nothing else of the header moved
    expect(policy).toBe("camera=(self), microphone=(self), display-capture=(self), geolocation=(self)");
    expect((await ask("/projects")).headers.get("permissions-policy")).toBe(policy);
  });

  it("every other header is exactly what it was", () => {
    expect(SECURITY_HEADERS.filter(([name]) => name !== "permissions-policy")).toEqual([
      ["x-content-type-options", "nosniff"],
      ["x-frame-options", "SAMEORIGIN"],
      ["referrer-policy", "same-origin"],
      ["content-security-policy", "frame-ancestors 'self'; base-uri 'self'; form-action 'self'"],
    ]);
  });
});
