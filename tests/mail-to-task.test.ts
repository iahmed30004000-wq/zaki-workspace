import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { FEATURES, FEATURE_DEFAULTS, featureOn } from "@/lib/features";
import {
  MAIL_LIMITS,
  buildDescription,
  cleanLine,
  excerptOf,
  messageKey,
  normalizeAddress,
  parseAllowList,
  senderAllowed,
  titleFromSubject,
  validFolder,
  validHost,
} from "@/lib/mail-to-task";
import { bodyToText } from "@/server/mail-task/body";
import { mailErrorKey, mailErrorName, pickTextPart, MailSourceError } from "@/server/mail-task/source";

const ch = String.fromCharCode;

describe("the switch", () => {
  it("is off by default and has its words", () => {
    expect(FEATURES).toContain("emailToTask");
    expect(FEATURE_DEFAULTS.emailToTask).toBe(false);
    expect(featureOn({}, "emailToTask")).toBe(false);
    expect(featureOn({ features: { emailToTask: true } }, "emailToTask")).toBe(true);
    expect(AR["features.emailToTask.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.emailToTask.hint"]).toContain("⚠️");
    expect(AR["features.emailToTask.hint"]).toContain("🔧");
  });
});

describe("title and excerpt", () => {
  it("cuts the subject to 200, removes control and direction characters and folds white space", () => {
    const subject = `  Hello${ch(0)}${ch(7)}\n\tworld ${ch(0x202e)}gnp.exe ${"x".repeat(400)}`;
    const title = titleFromSubject(subject, "fallback");
    expect(Array.from(title).length).toBeLessThanOrEqual(MAIL_LIMITS.title);
    expect(title.startsWith("Hello world")).toBe(true);
    for (const c of title) expect(c.codePointAt(0)! >= 32 && c.codePointAt(0) !== 0x202e).toBe(true);
  });

  it("an empty subject falls back; a cut never splits a surrogate pair", () => {
    expect(titleFromSubject("   ", "fallback")).toBe("fallback");
    expect(titleFromSubject(null, "fallback")).toBe("fallback");
    const emoji = "\u{1F600}".repeat(300);
    const cut = cleanLine(emoji, 200);
    expect(Array.from(cut)).toHaveLength(200);
    expect(cut.includes("�")).toBe(false);
  });

  it("the excerpt keeps its lines, drops invisible characters, collapses blank runs and stops at 1500", () => {
    const text = `line one${ch(0)}\r\n\r\n\r\n\r\nline   two​ end\n${"y".repeat(2000)}`;
    const out = excerptOf(text);
    expect(out.startsWith("line one\n\nline two end\n")).toBe(true);
    expect(Array.from(out).length).toBeLessThanOrEqual(MAIL_LIMITS.excerpt);
    expect(out.includes(ch(0))).toBe(false);
  });

  it("the description is «من: sender» then the excerpt", () => {
    expect(buildDescription("من", "a@b.com", "hello\nworld")).toBe("من: a@b.com\n\nhello\nworld");
    expect(buildDescription("من", null, "hello")).toBe("hello");
    expect(buildDescription("من", "a@b.com", "")).toBe("من: a@b.com");
  });
});

describe("sender and allow-list", () => {
  it("normalizes addresses and refuses what is not one", () => {
    expect(normalizeAddress("  Boss@Example.COM ")).toBe("boss@example.com");
    expect(normalizeAddress("not an address")).toBeNull();
    expect(normalizeAddress("a@b@c.com")).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
  });

  it("parses addresses and domains, drops duplicates and reports the bad ones", () => {
    const r = parseAllowList("Boss@Example.com, example.org\n@Partner.io  boss@example.com  nope@  bad domain!");
    expect(r.list).toEqual(["boss@example.com", "example.org", "partner.io"]);
    expect(r.bad).toContain("nope@");
    expect(r.bad.some((b) => b.startsWith("bad") || b.startsWith("domain"))).toBe(true);
  });

  it("an empty list lets everybody in; an address or a domain lets only itself in; a sub-domain is not the domain", () => {
    expect(senderAllowed("x@y.com", [])).toBe(true);
    expect(senderAllowed(null, [])).toBe(true);
    expect(senderAllowed("boss@example.com", ["boss@example.com"])).toBe(true);
    expect(senderAllowed("other@example.com", ["boss@example.com"])).toBe(false);
    expect(senderAllowed("anyone@example.org", ["example.org"])).toBe(true);
    expect(senderAllowed("anyone@mail.example.org", ["example.org"])).toBe(false);
    expect(senderAllowed("ANYONE@Example.ORG", ["example.org"])).toBe(true);
    expect(senderAllowed("example.org", ["example.org"])).toBe(false);
    expect(senderAllowed(null, ["example.org"])).toBe(false);
  });
});

describe("the Message-ID key", () => {
  it("strips brackets and case; a mail without one gets a key of its own", () => {
    expect(messageKey("<ABC@Mail.Example>", "7", 3)).toBe("mid:abc@mail.example");
    expect(messageKey(" abc@mail.example ", "7", 3)).toBe("mid:abc@mail.example");
    expect(messageKey(null, "7", 3)).toBe("uid:7:3");
    expect(messageKey("<>", "7", 4)).toBe("uid:7:4");
    expect(messageKey(null, "8", 3)).not.toBe(messageKey(null, "7", 3));
  });
});

describe("what the owner types", () => {
  it("accepts a server name, refuses a URL, a path, a space and an out-of-range address", () => {
    expect(validHost("mail.example.com")).toBe(true);
    expect(validHost("imap.gmail.com")).toBe(true);
    expect(validHost("203.0.113.9")).toBe(true);
    expect(validHost("https://mail.example.com")).toBe(false);
    expect(validHost("mail.example.com/x")).toBe(false);
    expect(validHost("mail example.com")).toBe(false);
    expect(validHost("300.1.1.1")).toBe(false);
    expect(validHost("")).toBe(false);
  });

  it("folders: printable, no wildcard", () => {
    expect(validFolder("INBOX")).toBe(true);
    expect(validFolder("Work/Tasks")).toBe(true);
    expect(validFolder("a*")).toBe(false);
    expect(validFolder(`a${ch(0)}b`)).toBe(false);
    expect(validFolder("")).toBe(false);
  });
});

describe("the text part (never an attachment)", () => {
  it("picks the plain part of an alternative, else the html, and never an attachment", () => {
    const alt = {
      type: "multipart/mixed",
      childNodes: [
        {
          part: "1",
          type: "multipart/alternative",
          childNodes: [
            { part: "1.1", type: "text/plain" },
            { part: "1.2", type: "text/html" },
          ],
        },
        { part: "2", type: "application/pdf", disposition: "attachment" },
      ],
    };
    expect(pickTextPart(alt)).toEqual({ part: "1.1", type: "text/plain" });
    expect(pickTextPart({ type: "multipart/mixed", childNodes: [{ part: "1", type: "text/html" }, { part: "2", type: "text/plain", disposition: "attachment" }] })).toEqual({ part: "1", type: "text/html" });
    expect(pickTextPart({ type: "multipart/mixed", childNodes: [{ part: "1", type: "image/png" }, { part: "2", type: "text/plain", disposition: "attachment" }] })).toBeNull();
    // a single-part mail has no part number: it is part 1
    expect(pickTextPart({ type: "text/plain" })).toEqual({ part: "1", type: "text/plain" });
    expect(pickTextPart(undefined)).toBeNull();
  });

  it("plain text passes through the cleaner", async () => {
    expect(await bodyToText("text/plain", `hi${ch(0)}\r\nthere`)).toBe("hi\nthere");
    expect(await bodyToText(null, "x")).toBe("");
    expect(await bodyToText("text/plain", null)).toBe("");
  });

  it("html becomes text: tags, styles and scripts gone, the link kept as text", async () => {
    const html = `<html><head><style>p{color:red}</style><script>alert(1)</script></head><body><p>Hello <b>team</b>,</p><p>See <a href="https://example.com/doc">the doc</a>.</p><img src="x.png"></body></html>`;
    const text = await bodyToText("text/html", html);
    expect(text).toContain("Hello team,");
    expect(text).toContain("the doc");
    expect(text).toContain("https://example.com/doc");
    expect(text).not.toContain("<");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
  });
});

describe("failures say a key, never the server's words", () => {
  it("maps what the library reports to dictionary keys", () => {
    expect(mailErrorKey({ authenticationFailed: true, message: "secret server text" })).toBe("mail.err.auth");
    expect(mailErrorKey({ code: "ENOTFOUND" })).toBe("mail.err.host");
    expect(mailErrorKey({ code: "ECONNREFUSED" })).toBe("mail.err.connect");
    expect(mailErrorKey({ code: "CONNECT_TIMEOUT" })).toBe("mail.err.connect");
    expect(mailErrorKey({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" })).toBe("mail.err.tls");
    expect(mailErrorKey({ serverResponseCode: "NONEXISTENT" })).toBe("mail.err.folder");
    expect(mailErrorKey(new MailSourceError("mail.err.private_host"))).toBe("mail.err.private_host");
    expect(mailErrorKey(new Error("whatever"))).toBe("mail.err.unknown");
    for (const key of ["auth", "host", "connect", "tls", "folder", "unknown", "private_host", "password_unreadable", "no_owner", "no_key"]) {
      expect(AR[`mail.err.${key}`], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("the name for a log line carries no message", () => {
    const err = Object.assign(new Error("password hunter2 rejected"), { code: "EAUTH" });
    expect(mailErrorName(err)).toBe("Error.EAUTH");
    expect(mailErrorName(err)).not.toContain("hunter2");
    expect(mailErrorName("a string with a secret")).toBe("NonError");
  });
});
