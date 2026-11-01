import { createElement } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/owner/assistant",
}));

import { AR } from "@/lib/i18n/dict";
import { buildNav, canOpenTab, locate, offeredToGuests } from "@/lib/nav/places";
import { CAPABILITIES } from "@/server/policy/capabilities";
import { ChatScreen, MaskedNote, type ChatScreenProps } from "@/components/owner-assistant/chat";
import { ProposalCard } from "@/components/owner-assistant/proposal-card";
import { SettingsForm } from "@/components/owner-assistant/settings-form";
import type { ProposalView } from "@/server/services/owner-assistant-proposals";
import type { MessageView } from "@/server/services/owner-assistant-chat";
import type { PublicSettings } from "@/server/services/owner-assistant-settings";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** The two rules every screen keeps (theme tokens only, logical directions) and no Latin word in its text (the JSON of «شو انبعت» is code). */
function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
  expect(textOf(markup.replace(/<pre[\s\S]*?<\/pre>/g, "")).replace(/\b[A-Z]{2,}-\d+\b/g, "")).not.toMatch(/[A-Za-z]{2,}/);
}

const proposal = (over: Partial<ProposalView> = {}): ProposalView => ({
  id: "p1",
  type: "reassign_task",
  status: "PENDING",
  createdAt: "2026-10-30T09:00:00.000Z",
  decidedAt: null,
  expiresAt: "2026-11-01T09:00:00.000Z",
  lines: [
    { labelKey: "assistant.field.task", value: "#12 تجهيز العرض" },
    { labelKey: "assistant.field.assignee", value: "سارة" },
  ],
  reason: "أحمد عنده 6 مهام متأخرة وسارة عندها 1",
  errorKey: null,
  requested: false,
  ...over,
});

const answer = (over: Partial<MessageView> = {}): MessageView => ({ id: "m2", role: "ASSISTANT", text: "أحمد متأخر في 3 مهام.\nالصيغة: متأخرة = مفتوحة وموعدها قبل اليوم.", createdAt: "2026-10-30T09:00:01.000Z", sent: '{\n  "model": "claude-sonnet-5-5",\n  "question": "مين متأخر؟"\n}', proposals: [proposal()], ...over });
const question: MessageView = { id: "m1", role: "USER", text: "مين متأخر؟", createdAt: "2026-10-30T09:00:00.000Z", sent: null, proposals: [] };

const usage = { day: "2026-10-30", requestsToday: 7, dailyLimit: 50, tokensThisMonth: 120_000, monthlyTokenBudget: 2_000_000 };
const screen = (over: Partial<ChatScreenProps> = {}) => render(createElement(ChatScreen, { conversationId: "c1", title: "مين متأخر؟", messages: [question, answer()], conversations: [{ id: "c1", title: "مين متأخر؟", updatedAt: "2026-10-30T09:00:00.000Z" }, { id: "c2", title: "حلّل الأسبوع", updatedAt: "2026-10-29T09:00:00.000Z" }], spaces: [{ id: "s1", name: "التسويق" }], hasKey: true, usage, ...over }));

describe("the chat screen", () => {
  it("shows the messages, the four quick questions, the scope, the usage meter, the history and «امسح المحادثة»", () => {
    const markup = screen();
    expectClean(markup);
    const text = textOf(markup);
    expect(text).toContain("مساعد المالك");
    expect(text).toContain("مين متأخر؟");
    expect(text).toContain("أحمد متأخر في 3 مهام.");
    for (const quick of ["حلّل أداء هالأسبوع", "مين متأخر وشو أسبابه؟", "اقترح توزيع للمهام المتأخرة", "شو أهم 3 مخاطر عندي؟"]) expect(text, quick).toContain(quick);
    // the scope: the board's own filters
    expect(markup).toContain('data-testid="ai-scope"');
    expect(text).toContain("7 أيام");
    expect(text).toContain("التسويق");
    expect(text).toContain("الحد الأقصى 92 يوم");
    // the meter: today's messages and the month's tokens
    expect(text).toContain("رسائل اليوم: 7 من 50");
    expect(text).toContain("توكنات هالشهر: 120,000 من 2,000,000");
    // the history is a row of plain links (a page load, no hidden state) and the clear button is there for an open conversation
    expect(markup).toContain('href="/owner/assistant?c=c2"');
    expect(markup).toContain('href="/owner/assistant"');
    expect(markup).toContain('data-testid="ai-clear"');
    expect(text).toContain("امسح المحادثة");
    expect(markup).toContain('href="/owner/assistant/settings"');
  });

  it("every answer carries «شو انبعت للنموذج» with the exact request, left to right, collapsed", () => {
    const markup = screen();
    expect(markup).toContain('data-testid="ai-sent"');
    expect(textOf(markup)).toContain("شو انبعت للنموذج");
    expect(markup).toMatch(/<details[^>]*data-testid="ai-sent"/);
    expect(markup).not.toMatch(/<details[^>]*data-testid="ai-sent"[^>]*open/);
    expect(markup).toMatch(/<pre dir="ltr"/);
    expect(markup).toContain("&quot;question&quot;: &quot;مين متأخر؟&quot;");
    // the question is not an answer: no expander under it
    expect(markup.match(/data-testid="ai-sent"/g)).toHaveLength(1);
  });

  it("a proposal sits under the answer that made it, with its two buttons", () => {
    const markup = screen();
    expect(markup).toContain('data-testid="ai-proposal"');
    expect(markup).toContain('data-testid="ai-approve"');
    expect(markup).toContain('data-testid="ai-reject"');
  });

  it("without a key: the notice and the settings link are there, and nothing can be sent", () => {
    const markup = screen({ hasKey: false, conversationId: null, messages: [], conversations: [] });
    expectClean(markup);
    expect(markup).toContain('data-testid="ai-no-key"');
    expect(textOf(markup)).toContain("ما في مفتاح محفوظ");
    expect(markup).toContain('data-testid="ai-send"');
    expect(markup).toMatch(/data-testid="ai-send"/);
    expect(markup.match(/<button[^>]*disabled[^>]*data-testid="ai-send"|<button[^>]*data-testid="ai-send"[^>]*disabled/)).not.toBeNull();
    expect(markup).not.toContain('data-testid="ai-clear"');
    expect(textOf(markup)).toContain(AR["assistant.empty"] as string);
  });

  it("says plainly what the filter can and cannot see (⚠️ with 🔧) and how the data is protected", () => {
    const markup = screen();
    const text = textOf(markup);
    expect(text).toContain("⚠️");
    expect(text).toContain("🔧");
    expect(text).toContain("ما بيقدر يعرف اسم عميل");
    expect(text).toContain("ما بنبعت أبدًا نص رسالة");
  });

  it("a piece of an answer is text, never markup: the answer is escaped", () => {
    const markup = screen({ messages: [answer({ text: "<img src=x onerror=alert(1)><script>x</script>", proposals: [], sent: null })] });
    expect(markup).not.toContain("<img src=x");
    expect(markup).not.toContain("<script>x");
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("the masked note says what was masked, and says nothing when nothing was", () => {
    const none = render(createElement(MaskedNote, { report: { masked: { phone: 0, email: 0, url: 0, handle: 0, id: 0, secret: 0 }, names: 0, titles: 0, total: 0 } }));
    expect(none).toBe("");
    expect(render(createElement(MaskedNote, { report: null }))).toBe("");
    const some = render(createElement(MaskedNote, { report: { masked: { phone: 2, email: 1, url: 0, handle: 0, id: 0, secret: 0 }, names: 1, titles: 3, total: 7 } }));
    expectClean(some);
    expect(textOf(some)).toBe("اتنقّت بياناتك قبل الإرسال: 2 أرقام، 1 بريد إلكتروني، 1 أسماء موظفين أو مساحات، 3 أجزاء من عناوين مهام");
  });
});

describe("the proposal card", () => {
  const card = (p: ProposalView) => render(createElement(ProposalCard, { proposal: p }));

  it("«اقتراح: …» with the exact parameters in plain Arabic, the reason, the expiry, the safety line and two buttons", () => {
    const markup = card(proposal());
    expectClean(markup);
    const text = textOf(markup);
    expect(text).toContain("اقتراح: نقل مهمة لشخص آخر");
    expect(text).toContain("المهمة #12 تجهيز العرض");
    expect(text).toContain("المسؤول سارة");
    expect(text).toContain("السبب: أحمد عنده 6 مهام متأخرة وسارة عندها 1");
    expect(text).toContain("بانتظار قرارك");
    expect(text).toContain("وافق");
    expect(text).toContain("ارفض");
    expect(text).toContain("بينتهي إذا ما قررت خلال 48 ساعة");
    expect(text).toContain("⚠️ ما بنفّذ شي بدون ضغطتك. 🔧");
  });

  it("each type has its own heading", () => {
    for (const type of ["create_task", "reassign_task", "set_due_date", "pin_task", "remind_person"]) {
      expect(textOf(card(proposal({ type })))).toContain(AR[`assistant.proposal.${type}`] as string);
    }
    expect(textOf(card(proposal({ type: "something_else" })))).toContain("اقتراح");
  });

  it("a decided proposal has no buttons: executed, rejected and expired say so; a failed one gives its Arabic reason", () => {
    for (const [status, label] of [["APPROVED", "نُفّذ"], ["REJECTED", "مرفوض"], ["EXPIRED", "انتهت مدته"]] as const) {
      const markup = card(proposal({ status }));
      expect(markup, status).not.toContain("ai-approve");
      expect(markup, status).not.toContain("ai-reject");
      expect(textOf(markup), status).toContain(label);
    }
    const failed = card(proposal({ status: "FAILED", errorKey: "assistant.exec_reward_task" }));
    expect(failed).not.toContain("ai-approve");
    expect(textOf(failed)).toContain("ما نجح التنفيذ");
    expect(textOf(failed)).toContain("المهمة عليها مكافأة، والمساعد لا يتعامل مع المهام المالية.");
    // an unknown reason falls back to the generic sentence, never a key
    expect(textOf(card(proposal({ status: "FAILED", errorKey: null })))).toContain("تعذّر تنفيذ الاقتراح ولم يتغير شيء.");
  });

  it("an assignment the rank rule turned into a request says so", () => {
    expect(textOf(card(proposal({ status: "APPROVED", requested: true })))).toContain("حوّل هالإسناد لطلب");
  });
});

describe("the settings screen", () => {
  const settings: PublicSettings = {
    hasKey: false,
    keyLast4: null,
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
  const form = (over: Partial<typeof settings> = {}) => render(createElement(SettingsForm, { settings: { ...settings, ...over }, usage, models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] }));

  it("no key yet: a masked, empty field and «ما في مفتاح محفوظ»", () => {
    const markup = form();
    expectClean(markup);
    expect(markup).toContain('data-testid="ai-key-none"');
    expect(markup).toMatch(/<input type="password"[^>]*autoComplete="off"|<input type="password"[^>]*autocomplete="off"/);
    expect(markup).not.toMatch(/<input type="password"[^>]*value="[^"]/);
    expect(markup).not.toContain('data-testid="ai-key-delete"');
  });

  it("a saved key: only «مفتاح محفوظ ••••xxxx», with «تغيير المفتاح» and «احذف المفتاح», and NO field holding anything", () => {
    const markup = form({ hasKey: true, keyLast4: "4321" });
    expectClean(markup);
    expect(textOf(markup)).toContain("مفتاح محفوظ ••••4321");
    expect(textOf(markup)).toContain("تغيير المفتاح");
    expect(textOf(markup)).toContain("احذف المفتاح");
    // the Claude key has no field once it is saved; the ONLY password field left is the gateway's own optional key («نموذج محلي»)
    expect(markup).not.toContain('data-testid="ai-key-input"');
    expect(markup.match(/type="password"/g) ?? []).toHaveLength(1);
    expect(markup).toContain('data-testid="ai-gateway-key-input"');
  });

  it("the defaults: sonnet, 50 messages a day, 2,000,000 tokens a month, both privacy switches off with the ⚠️ + 🔧 pair on titles", () => {
    const markup = form();
    expect(markup).toContain('value="claude-sonnet-5-5" selected');
    expect(markup).toContain('data-testid="ai-daily"');
    expect(markup).toMatch(/data-testid="ai-daily"[^>]*value="50"|value="50"[^>]*data-testid="ai-daily"/);
    expect(markup).toMatch(/value="2000000"/);
    expect(markup).not.toMatch(/data-testid="ai-allow-names"[^>]*checked|checked[^>]*data-testid="ai-allow-names"/);
    expect(markup).not.toMatch(/data-testid="ai-allow-titles"[^>]*checked|checked[^>]*data-testid="ai-allow-titles"/);
    const text = textOf(markup);
    expect(text).toContain("اسمح بأسماء الموظفين");
    expect(text).toContain("اسمح بعناوين المهام بعد التنقية");
    expect(textOf(markup.match(/data-testid="ai-titles-warning"[^>]*>[\s\S]*?<\/span>/)?.[0] ?? "")).toMatch(/⚠️[\s\S]*🔧/);
    // the three known models are offered in Arabic, plus «معرّف آخر»
    for (const name of ["سونيت", "أوبس", "هايكو", "معرّف آخر"]) expect(text, name).toContain(name);
  });

  it("a model id that is not one of the three opens the free-text field with that id", () => {
    const markup = form({ model: "my-own-model-1" });
    expect(markup).toContain('data-testid="ai-model-custom"');
    expect(markup).toContain('value="my-own-model-1"');
  });
});

describe("the map: a tab «المساعد» next to «لوحة المالك», for the OWNER rank and only while the switch is on", () => {
  const caps = [...CAPABILITIES];
  const admin = (subject: Parameters<typeof buildNav>[0]) => buildNav(subject).places.find((p) => p.key === "admin")?.tabs.map((t) => t.key) ?? [];

  it("the owner sees it right after the board; switched off it is gone and nothing else moves", () => {
    const on = admin({ role: "OWNER", caps });
    expect(on.indexOf("assistant")).toBe(on.indexOf("board") + 1);
    const off = admin({ role: "OWNER", caps, off: ["ownerAssistant"] });
    expect(off).not.toContain("assistant");
    expect(on.filter((k) => k !== "assistant")).toEqual(off);
  });

  it("an admin, a lead, a member and a guest never see it, whatever capabilities they were given", () => {
    for (const role of ["ADMIN", "LEAD", "MEMBER", "GUEST"] as const) {
      expect(canOpenTab({ role, caps }, "assistant"), role).toBe(false);
      expect(admin({ role, caps }), role).not.toContain("assistant");
    }
    expect(offeredToGuests("assistant")).toBe(false);
  });

  it("its addresses belong to it, not to the board", () => {
    expect(locate("/owner/assistant")).toEqual({ place: "admin", tab: "assistant" });
    expect(locate("/owner/assistant/settings")).toEqual({ place: "admin", tab: "assistant" });
    expect(locate("/owner")).toEqual({ place: "admin", tab: "board" });
    expect(AR["nav.tab.assistant"]).toBe("المساعد");
  });
});

// ───────────────────────────────────────── pinned in the source ─────────────────────────────────────────

function filesUnder(dir: string, pick: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full, pick) : pick(name) ? [full] : [];
  });
}
/** The code without its comments (a comment may say «the key is never logged»; only code can log it). */
const code = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the gates, pinned in the source (where a database test cannot see them)", () => {
  const routes = filesUnder(path.join(ROOT, "src/app/api/owner-assistant"), (n) => n === "route.ts");
  const pages = filesUnder(path.join(ROOT, "src/app/(app)/owner/assistant"), (n) => n === "page.tsx");

  it("every route and page decides access through assistantAccess and nothing else, and every route answers through withAssistantApi", () => {
    expect(routes.length).toBe(9); // the seven of the assistant + the local model's «اختبر الاتصال» and the gateway's key
    expect(pages.length).toBe(2);
    for (const file of [...routes, ...pages]) {
      const src = read(path.relative(ROOT, file));
      expect(src, file).toMatch(/assistantAccess\(/);
      expect(src, file).not.toMatch(/actor\.role\s*[=!]==|orgRole\s*[=!]==|=== "OWNER"|\.isOwner/);
    }
    for (const file of routes) expect(read(path.relative(ROOT, file)), file).toMatch(/withAssistantApi\(/);
  });

  it("the cipher is read in ONE place (the settings service): not by a route, a page, a component or any other service", () => {
    const offenders = filesUnder(path.join(ROOT, "src"), (n) => /\.(ts|tsx)$/.test(n))
      .filter((f) => /keyCipher/i.test(code(f)))
      .map((f) => path.relative(ROOT, f).replace(/\\/g, "/"));
    expect(offenders).toEqual(["src/server/services/owner-assistant-settings.ts"]);
    // and that service selects it only in `readKey` (never in a public read)
    const settings = code(path.join(ROOT, "src/server/services/owner-assistant-settings.ts"));
    expect(settings).toMatch(/PUBLIC_COLUMNS = \{\s*keyLast4: true/);
    expect(settings).not.toMatch(/PUBLIC_COLUMNS[^;]*keyCipher/i);
    expect(settings.match(/(?<![A-Za-z])keyCipher: true/g) ?? []).toHaveLength(1);
    // the gateway's key is held the same way: selected once, in `readGatewayKey`, never in a public read
    expect(settings.match(/gatewayKeyCipher: true/g) ?? []).toHaveLength(1);
  });

  it("the key reaches no log line, no audit row and no error: nothing of the assistant logs or audits a value", () => {
    const files = [
      ...filesUnder(path.join(ROOT, "src/server/ai"), () => true),
      ...filesUnder(path.join(ROOT, "src/app/api/owner-assistant"), () => true),
      ...filesUnder(path.join(ROOT, "src/components/owner-assistant"), () => true),
      ...["access", "settings", "data", "names", "chat", "proposals"].map((n) => path.join(ROOT, `src/server/services/owner-assistant-${n}.ts`)),
    ];
    for (const file of files) {
      const src = code(file);
      // no log call that could carry a key or a text: only names, counters and paths
      for (const m of src.matchAll(/log\.(?:debug|info|warn|error)\([^)]*\)/g)) expect(m[0], `${file}: ${m[0]}`).not.toMatch(/apiKey|\bkey\b|\bplain\b|\bbody\b|\btext\b|\bcontent\b|\bmessage\s*:/);
      expect(src, file).not.toMatch(/console\./);
      expect(src, file).not.toMatch(/localStorage|sessionStorage/);
    }
    // the audit rows name fields and ids, never a value
    const settings = code(path.join(ROOT, "src/server/services/owner-assistant-settings.ts"));
    for (const m of settings.matchAll(/auditLog\.create\(\{[^}]*\}[^)]*\)/g)) expect(m[0]).not.toMatch(/keyCipher|plain|apiKey/);
  });

  it("the provider's address is a constant and nothing is user-supplied (no env, no setting, no body)", () => {
    const provider = code(path.join(ROOT, "src/server/ai/provider.ts"));
    expect(provider).toMatch(/export const ANTHROPIC_URL = "https:\/\/api\.anthropic\.com\/v1\/messages"/);
    expect(provider).not.toMatch(/process\.env/);
    expect(provider.match(/doFetch\(/g)).toHaveLength(1);
    expect(provider).toMatch(/doFetch\(ANTHROPIC_URL,/);
  });

  it("the assistant only reads the board, and writes nothing outside its own tables and the ordinary services", () => {
    const data = code(path.join(ROOT, "src/server/services/owner-assistant-data.ts"));
    expect(data).not.toMatch(/(db|tx)\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(data).not.toMatch(/chatMessage|\.body\b|StoredFile|comment|crm|opportunity|customer/i);
    // the services that act are the ordinary ones
    const proposals = code(path.join(ROOT, "src/server/services/owner-assistant-proposals.ts"));
    expect(proposals).toMatch(/createTask\(/);
    expect(proposals).toMatch(/updateTask\(/);
    expect(proposals).toMatch(/setPinned\(/);
    expect(proposals).toMatch(/pushNotification\(/);
    expect(proposals).not.toMatch(/db\.task\.(create|update|delete)|tx\.task\.(create|update|delete)|deleteTask|db\.user\.|organizationMember\.(update|create|delete)/);
  });

  it("every key the assistant can show exists in Arabic (the errors in plain Modern Standard Arabic: no dialect markers)", () => {
    const src = filesUnder(path.join(ROOT, "src"), (n) => /\.(ts|tsx)$/.test(n))
      .filter((f) => /owner-assistant|[\\/]ai[\\/]/.test(f))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const keys = new Set([...src.matchAll(/["'`](assistant\.[a-z_.-]+)["'`]/gi)].map((m) => m[1] as string));
    for (const key of keys) if (!key.endsWith(".")) expect(AR[key] ?? AR[key.replace(/\.[^.]+$/, "")], key).toBeTruthy();
    const errors = Object.entries(AR).filter(([k]) => /^assistant\.(err_|exec_|no_key$|key_invalid|model_invalid|limit_invalid|budget_invalid|message_invalid|daily_limit|monthly_budget|context_blocked|proposal_not_pending|proposal_expired)/.test(k));
    expect(errors.length).toBeGreaterThan(20);
    for (const [key, text] of errors) {
      expect(text, key).toMatch(/[؀-ۿ]/);
      expect(text, key).not.toMatch(/\b(شو|هلق|هالـ|هاد|بدك|ما بيقدر|عم )/);
    }
  });
});
