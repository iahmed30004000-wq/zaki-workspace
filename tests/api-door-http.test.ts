import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { doorRoute, safeErrorFacts } from "@/server/door/http";

/** «الباب»: the 500 path (src/server/door/http.ts) writes the class and the code of an unexpected error, never its message. */
describe("the 500 path of the door", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers 500 with the envelope, and the log line holds the error name and code but NOT the message or the stack", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
    const secret = "Unique constraint failed on the fields: (`title`) value 'سر العميل 0791234567'";
    const res = await doorRoute(async () => {
      throw Object.assign(new Error(secret), { name: "PrismaClientKnownRequestError", code: "P2002" });
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("door.internal");
    expect(JSON.stringify(body)).not.toContain("0791234567");

    expect(lines).toHaveLength(1);
    const logged = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(logged["event"]).toBe("door.unhandled");
    expect(logged["name"]).toBe("PrismaClientKnownRequestError");
    expect(logged["code"]).toBe("P2002");
    expect(logged["requestId"]).toBe(res.headers.get("x-request-id"));
    expect(lines[0]).not.toContain("0791234567");
    expect(lines[0]).not.toContain("Unique constraint");
    expect(Object.keys(logged)).not.toContain("message");
    expect(Object.keys(logged)).not.toContain("stack");
  });

  it("a thrown string or a code that is not a plain token is never echoed", () => {
    expect(safeErrorFacts("a customer phone 0791234567")).toEqual({ name: "string" });
    expect(safeErrorFacts(Object.assign(new Error("x"), { code: "has a space and a phone 0791234567" }))).toEqual({ name: "Error" });
    expect(safeErrorFacts(null)).toEqual({ name: "object" });
  });

  it("a normal answer passes through", async () => {
    const res = await doorRoute(async () => NextResponse.json({ ok: true }));
    expect(res.status).toBe(200);
  });
});
