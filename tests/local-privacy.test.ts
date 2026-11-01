import { describe, expect, it } from "vitest";
import { redactText, redactTextRelaxed } from "@/server/ai/redact";
import { buildChatPrompt, redactChatText, type ChatRow } from "@/server/ai/redact-chat";
import { providerReady, relaxApplies } from "@/server/services/assistant-provider";
import type { PublicSettings } from "@/server/services/owner-assistant-settings";

/**
 * «نموذج محلي» — PRIVACY BY PROVIDER, the pure part. The external model's filter is what it always was; the relaxed filter exists only
 * for a model on the owner's own machine and only when he switches it on; secrets, tokens and long identifiers are masked in BOTH.
 */

const base: PublicSettings = {
  hasKey: true,
  keyLast4: "ABCD",
  model: "claude-sonnet-5-5",
  dailyLimit: 50,
  monthlyTokenBudget: 2_000_000,
  allowNames: false,
  allowTitles: false,
  ownerProvider: "claude",
  chatProvider: "claude",
  localBaseUrl: null,
  localModel: null,
  gatewayBaseUrl: null,
  gatewayModel: null,
  hasGatewayKey: false,
  gatewayKeyLast4: null,
  gatewayConfirmedLocal: false,
  localRelaxRedaction: false,
};
const settings = (over: Partial<PublicSettings>): PublicSettings => ({ ...base, ...over });

const PHONE = "0791234567";
const MAIL = "zaid@example.com";
const LINK = "https://shop.example.com/order/55";
const META_TOKEN = "EAAGm0PX4ZCpsBAKZCtestTOKENvalue1234567890"; // scan-secrets:ignore
const API_KEY = "sk-ant-api03-TESTKEY-must-never-appear-0987654321"; // scan-secrets:ignore
const BEARER = "Bearer abcdefghijklmnop1234567890"; // scan-secrets:ignore
const HEX = "0123456789abcdef0123456789abcdef0123456789";
const LONG_LETTERS = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnop";

describe("the relaxed filter lets customer-looking text through and keeps masking secrets", () => {
  const text = `كلّم الزبون على ${PHONE} أو ${MAIL} أو ${LINK}`;

  it("the strict filter masks the phone, the e-mail and the link (unchanged)", () => {
    const r = redactText(text);
    expect(r.text).not.toContain(PHONE);
    expect(r.text).not.toContain(MAIL);
    expect(r.text).not.toContain("shop.example.com");
  });

  it("the relaxed filter passes them", () => {
    const r = redactTextRelaxed(text);
    expect(r.text).toBe(text);
    expect(r.count).toBe(0);
  });

  it.each([
    ["an API key", `المفتاح ${API_KEY} للتجربة`, API_KEY],
    ["an ad / access token", `توكن الإعلانات ${META_TOKEN}`, META_TOKEN],
    ["a labelled password", "password: hunter2hunter2", "hunter2hunter2"],
    ["an Arabic labelled password", "كلمة السر: مفتاح-سري-123", "مفتاح-سري-123"],
    ["a bearer token", `Authorization: ${BEARER}`, "abcdefghijklmnop1234567890"],
    ["a long hex string", `الرمز ${HEX}`, HEX],
    ["a long run of letters", `القيمة ${LONG_LETTERS}`, LONG_LETTERS],
    ["an identifier", "الطلب c1234567890abcdefghij12345", "c1234567890abcdefghij12345"],
  ])("%s is masked even by the relaxed filter", (_name, input, secret) => {
    const r = redactTextRelaxed(input);
    expect(r.text).not.toContain(secret);
    expect(r.count).toBeGreaterThan(0);
  });

  it("a plain date and ordinary words are not touched", () => {
    expect(redactTextRelaxed("الموعد 2026-10-30 ورقم الطلب 55").text).toBe("الموعد 2026-10-30 ورقم الطلب 55");
  });
});

describe("chat text", () => {
  it("redactChatText: strict masks addresses too, relaxed leaves them and the phone", () => {
    const input = `العنوان شارع الجامعة عمارة 5 طابق 3 ورقمه ${PHONE}`;
    const strict = redactChatText(input);
    expect(strict.text).not.toContain("الجامعة");
    expect(strict.text).not.toContain(PHONE);
    expect(strict.masked.address).toBeGreaterThan(0);
    const loose = redactChatText(input, true);
    expect(loose.text).toBe(input);
    expect(loose.masked.address).toBe(0);
  });

  const rows = (body: string): ChatRow[] => [
    { id: "m1", authorId: "u1", authorName: "عمر حداد", body: `الزبون سارة الأحمد على ${PHONE} وإيميله ${MAIL}` },
    { id: "m2", authorId: "u2", authorName: "سارة الأحمد", body },
  ];
  const opts = { askingMessageId: "m2", companyNames: ["عمر حداد", "سارة الأحمد", "ليلى خالد"] };

  it("buildChatPrompt: the default is exactly the strict filter", () => {
    const p = buildChatPrompt(rows("@المساعد لخّص وكلمة سر: topsecretpass99"), { ...opts, allowNames: false });
    expect(p.content).not.toContain(PHONE);
    expect(p.content).not.toContain("example.com");
    expect(p.content).not.toContain("عمر");
    expect(p.content).not.toContain("topsecretpass99");
    expect(p.maskedTotal).toBeGreaterThan(0);
  });

  it("buildChatPrompt with the relaxed filter and names allowed: numbers and names pass, a secret still does not", () => {
    const p = buildChatPrompt(rows(`@المساعد لخّص. التوكن ${META_TOKEN} وكلمة سر: topsecretpass99`), { ...opts, allowNames: true, relax: true });
    expect(p.content).toContain(PHONE);
    expect(p.content).toContain(MAIL);
    expect(p.content).toContain("عمر حداد");
    expect(p.content).not.toContain(META_TOKEN);
    expect(p.content).not.toContain("topsecretpass99");
  });

  it("the relaxed flag alone, with names NOT allowed, still hides names (they are two separate decisions made by the caller)", () => {
    const p = buildChatPrompt(rows("@المساعد لخّص"), { ...opts, allowNames: false, relax: true });
    expect(p.content).toContain(PHONE);
    expect(p.content).not.toContain("عمر حداد");
  });

  it("a smaller window for a small local model: fewer messages, fewer characters; the asking message is always in", () => {
    const many: ChatRow[] = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, authorId: "u1", authorName: "ا", body: `رسالة رقم ${i} ${"ك".repeat(100)}` }));
    many.push({ id: "ask", authorId: "u2", authorName: "ب", body: "@المساعد سؤالي هنا" });
    const wide = buildChatPrompt(many, { askingMessageId: "ask", companyNames: [], allowNames: false });
    const narrow = buildChatPrompt(many, { askingMessageId: "ask", companyNames: [], allowNames: false, windowMessages: 12, windowChars: 3000 });
    expect(narrow.messages).toBeLessThanOrEqual(12);
    expect(narrow.messages).toBeLessThan(wide.messages);
    expect(narrow.chars).toBeLessThan(wide.chars);
    expect(narrow.content).toContain("سؤالي هنا");
  });
});

describe("which provider, and when the filter may be relaxed — the whole rule", () => {
  const matrix: { name: string; s: PublicSettings; ollama: boolean; openai: boolean; claude: boolean }[] = [
    { name: "nothing on", s: settings({}), ollama: false, openai: false, claude: false },
    { name: "the switch only", s: settings({ localRelaxRedaction: true }), ollama: true, openai: false, claude: false },
    { name: "the confirmation only", s: settings({ gatewayConfirmedLocal: true }), ollama: false, openai: false, claude: false },
    { name: "the switch and the confirmation", s: settings({ localRelaxRedaction: true, gatewayConfirmedLocal: true }), ollama: true, openai: true, claude: false },
  ];
  it.each(matrix)("$name", ({ s, ollama, openai, claude }) => {
    expect(relaxApplies(s, "ollama")).toBe(ollama);
    expect(relaxApplies(s, "openai")).toBe(openai);
    // Claude is NEVER relaxed, whatever is switched on
    expect(relaxApplies(s, "claude")).toBe(claude);
  });

  it("readiness: Claude needs the key, Ollama its address and name, the gateway its address and name", () => {
    expect(providerReady(settings({ hasKey: false }), "owner")).toBe(false);
    expect(providerReady(settings({ hasKey: true }), "owner")).toBe(true);
    const local = settings({ ownerProvider: "ollama", chatProvider: "ollama", hasKey: false });
    expect(providerReady(local, "owner")).toBe(false);
    expect(providerReady({ ...local, localBaseUrl: "http://ollama:11434" }, "owner")).toBe(false);
    expect(providerReady({ ...local, localBaseUrl: "http://ollama:11434", localModel: "llama3.2:3b" }, "owner")).toBe(true);
    // a stored address that is no longer acceptable (edited in the database) is «not ready»
    expect(providerReady({ ...local, localBaseUrl: "https://api.openai.com", localModel: "llama3.2:3b" }, "chat")).toBe(false);
    const gw = settings({ chatProvider: "openai", gatewayBaseUrl: "http://hermes:8642", gatewayModel: "hermes-3" });
    expect(providerReady(gw, "chat")).toBe(true);
    expect(providerReady(gw, "owner")).toBe(true); // the owner slot is still Claude, whose key is saved
    expect(providerReady({ ...gw, hasKey: false }, "owner")).toBe(false);
  });
});
