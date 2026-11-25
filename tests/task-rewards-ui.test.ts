import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/tasks/t1",
}));

import { PinMark, RewardBadge } from "@/components/rewards/reward-badge";
import { RewardCardView, type RewardCardData } from "@/components/rewards/reward-card";
import { MoneyNote, RewardFields, RewardToggleBlock, draftReady, emptyDraft, rewardBodyOf, rewardErrorText } from "@/components/rewards/reward-fields";
import { PinnedStrip } from "@/components/rewards/pinned-strip";
import { TaskRow } from "@/components/task-row";
import { ToastProvider } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import type { PinnedCard } from "@/server/services/pinned";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** The two rules every screen keeps: theme tokens only, and logical (RTL-safe) directions. */
function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
  // no Latin word on screen (the currency codes stay in `value=` attributes, never as text)
  // (a task's key, ZK-7, is an identifier read left to right: it is not a word)
  expect(textOf(markup).replace(/\b[A-Z]{2,}-\d+\b/g, "")).not.toMatch(/[A-Za-z]{2,}/);
}

/** A row draws toasts: it needs the page's provider. */
const row = (task: Record<string, unknown>) => render(createElement(ToastProvider, null, createElement(TaskRow, { task: task as never, editable: false, timeZone: "UTC" })));

const open: RewardCardData = {
  status: "OPEN",
  amountMinor: 15050,
  currency: "JOD",
  note: "للتسليم بالموعد",
  dueDate: "2031-03-20T09:00:00.000Z",
  completed: false,
  awardedToName: null,
  awardedAt: null,
  cancelReason: null,
};
const people = [
  { id: "u1", name: "سارة" },
  { id: "u2", name: "خالد" },
];

describe("the badge «🏆 مكافأة 150 دينار»", () => {
  it("draws the amount in Western digits and the currency in Arabic, with the theme's warn colour", () => {
    const markup = render(createElement(RewardBadge, { reward: { status: "OPEN", amountMinor: 15050, currency: "JOD" } }));
    expect(textOf(markup)).toBe("🏆 مكافأة 150.50 دينار");
    expect(markup).toContain("data-reward-badge");
    expect(markup).toContain('aria-label="مهمة بمكافأة: 150.50 دينار"');
    expect(classTokens(markup)).toEqual(expect.arrayContaining(["text-warn", "bg-warn/10", "border-warn/40"]));
    expectClean(markup);
  });

  it("is the ok colour once awarded, and draws nothing for a called-off reward, a missing one or no data at all", () => {
    expect(classTokens(render(createElement(RewardBadge, { reward: { status: "AWARDED", amountMinor: 100, currency: "USD" } })))).toContain("text-ok");
    for (const reward of [{ status: "CANCELLED", amountMinor: 100, currency: "USD" }, { status: "OPEN", amountMinor: null, currency: "USD" }, { status: null, amountMinor: 5, currency: "USD" }, null, undefined]) {
      expect(render(createElement(RewardBadge, { reward })), JSON.stringify(reward)).toBe("");
    }
  });

  it("a partner's row has no reward to draw: a list row without the field shows no badge, one with it shows it", () => {
    const base = { id: "t1", key: "ZK-1", title: "مهمة", priority: "NORMAL", dueDate: null, completedAt: null, assigneeId: null, assigneeName: null };
    expect(row(base)).not.toContain("data-reward-badge");
    const withReward = row({ ...base, reward: { status: "OPEN", amountMinor: 5000, currency: "USD" }, pinnedAt: new Date() });
    expect(withReward).toContain("data-reward-badge");
    expect(withReward).toContain("data-pin-mark");
    expect(textOf(withReward)).toContain("🏆 مكافأة 50 دولار");
  });

  it("the pin mark is a labelled icon", () => {
    const markup = render(createElement(PinMark));
    expect(markup).toContain('aria-label="مثبّتة"');
    expectClean(markup);
  });
});

describe("the reward card of the task page", () => {
  it("the owner sees the amount, the status, the deadline with the time left, the note, the edit and cancel buttons and the ⚠️/🔧 line", () => {
    const now = new Date("2031-03-10T09:00:00.000Z");
    const markup = render(createElement(RewardCardView, { reward: open, owner: true, people, now }));
    const text = textOf(markup);
    expect(text).toContain("150.50 دينار");
    expect(text).toContain("مفتوحة");
    expect(text).toContain("باقي 10 أيام");
    expect(text).toContain("للتسليم بالموعد");
    expect(text).toContain("عدّل المكافأة");
    expect(text).toContain("ألغِ المكافأة");
    expect(text).toContain("⚠️ المكافأة بتنصرف من الرواتب، هون تسجيل واعتماد بس.");
    expect(text).toContain("🔧");
    // not finished yet: nothing to award
    expect(markup).not.toContain("data-reward-pending");
    expect(markup).not.toContain("data-reward-locked");
    expectClean(markup);
  });

  it("a finished task shows the owner «بانتظار اعتماد المكافأة» with one «اعتمد المكافأة لـ…» button per person", () => {
    const markup = render(createElement(RewardCardView, { reward: { ...open, completed: true }, owner: true, people }));
    expect(markup).toContain("data-reward-pending");
    const text = textOf(markup);
    expect(text).toContain("بانتظار اعتماد المكافأة");
    expect(text).toContain("اعتمد المكافأة لـ سارة");
    expect(text).toContain("اعتمد المكافأة لـ خالد");
    expect(text).not.toContain("باقي"); // no countdown for finished work
    expectClean(markup);
  });

  it("an awarded reward names the person and the day and offers no more award or cancel; a called-off one shows its reason", () => {
    const awarded = render(createElement(RewardCardView, { reward: { ...open, status: "AWARDED", completed: true, awardedToName: "سارة", awardedAt: "2031-03-12T09:00:00.000Z" }, owner: true, people }));
    const text = textOf(awarded);
    expect(text).toContain("اعتُمدت لـ سارة");
    expect(text).toContain("معتمدة");
    expect(awarded).not.toContain("data-reward-pending");
    expect(text).not.toContain("ألغِ المكافأة");
    expect(text).not.toContain("عدّل المكافأة");
    const called = textOf(render(createElement(RewardCardView, { reward: { ...open, status: "CANCELLED", cancelReason: "تغيّرت الخطة" }, owner: true, people })));
    expect(called).toContain("ملغاة");
    expect(called).toContain("سبب الإلغاء: تغيّرت الخطة");
  });

  it("everybody else reads it with the lock line and has no button at all", () => {
    const markup = render(createElement(RewardCardView, { reward: { ...open, completed: true }, owner: false, people }));
    expect(markup).toContain("data-reward-locked");
    const text = textOf(markup);
    expect(text).toContain("هالمهمة بمكافأة: بس المالك بيعدّلها.");
    expect(text).toContain("150.50 دينار");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("data-reward-pending");
    expectClean(markup);
  });
});

describe("«مهمة بمكافأة» toggle of a creation form: the owner's alone", () => {
  const base = { on: false, onToggle: () => {}, draft: emptyDraft("JOD"), onDraft: () => {}, dayMissing: false, idPrefix: "t" };

  it("draws nothing when it is not offered (a member, a lead, an admin, a guest, or the switch off)", () => {
    expect(render(createElement(RewardToggleBlock, { ...base, offered: false }))).toBe("");
    expect(render(createElement(RewardToggleBlock, { ...base, offered: false, on: true }))).toBe("");
  });

  it("offered: a checkbox «مهمة بمكافأة»; on: amount, currency (Arabic names), note, and the required-day line when the day is missing", () => {
    const off = render(createElement(RewardToggleBlock, { ...base, offered: true }));
    expect(off).toContain("data-reward-toggle");
    expect(textOf(off)).toContain("مهمة بمكافأة");
    expect(off).not.toContain("data-reward-fields");

    const on = render(createElement(RewardToggleBlock, { ...base, offered: true, on: true, dayMissing: true }));
    const text = textOf(on);
    expect(on).toContain("data-reward-fields");
    for (const word of ["قيمة المكافأة", "العملة", "دولار", "دينار", "ليرة سورية", "يورو", "ليرة تركية", "المهمة بمكافأة تحتاج إلى تاريخ انتهاء."]) expect(text, word).toContain(word);
    expect(on).toContain("data-reward-money-note");
    // the values a form sends are the codes; the words a person reads are Arabic
    expect(on).toContain('value="USD"');
    expectClean(on);
    expect(render(createElement(RewardToggleBlock, { ...base, offered: true, on: true, dayMissing: false }))).not.toContain("المهمة بمكافأة تحتاج");
  });

  it("the draft becomes the request body, and is ready only with an amount and a currency", () => {
    expect(draftReady(emptyDraft(null))).toBe(false);
    expect(draftReady({ amount: "5", currency: "", note: "" })).toBe(false);
    expect(draftReady({ amount: "5", currency: "USD", note: "" })).toBe(true);
    expect(rewardBodyOf({ amount: " 12.5 ", currency: "USD", note: "  " })).toEqual({ amount: "12.5", currency: "USD", note: null });
    expect(textOf(render(createElement(MoneyNote)))).toContain("⚠️");
    expect(textOf(render(createElement(RewardFields, { value: emptyDraft("EUR"), onChange: () => {}, idPrefix: "x" })))).toContain("ملاحظة عن المكافأة");
  });

  it("an error shows its Arabic sentence: the reason inside a 422, else the answer's key, else the generic line", () => {
    const t = (key: string) => (({ "reward.due_required": "المهمة بمكافأة تحتاج إلى تاريخ انتهاء.", "reward.owner_only": "المالك وحده", "common.error": "حدث خطأ" }) as Record<string, string>)[key] ?? key;
    expect(rewardErrorText(new ApiError("validation.failed", 422, [{ path: "dueDate", message: "reward.due_required" }], "validation.failed"), t)).toBe("المهمة بمكافأة تحتاج إلى تاريخ انتهاء.");
    expect(rewardErrorText(new ApiError("forbidden", 403, undefined, "reward.owner_only"), t)).toBe("المالك وحده");
    expect(rewardErrorText(new Error("boom"), t)).toBe("حدث خطأ");
  });
});

describe("«مثبّتة»: the strip of a project and the compact card of «اليوم»", () => {
  const tasks: PinnedCard[] = [
    { id: "a", key: "ZK-7", title: "تجهيز العرض", dueDate: "2031-03-20T09:00:00.000Z", completed: false, projectName: "حملة", reward: { status: "OPEN", amountMinor: 20000, currency: "USD" } },
    { id: "b", key: "ZK-8", title: "مهمة منتهية", dueDate: null, completed: true, projectName: "حملة", reward: null },
  ];

  it("draws a link per task, the badge only where a reward was handed over, and nothing when empty", () => {
    const strip = render(createElement(PinnedStrip, { tasks }));
    expect(strip).toContain('data-pinned-strip="strip"');
    expect(strip).toContain('href="/tasks/a"');
    expect(strip).toContain('href="/tasks/b"');
    expect(textOf(strip)).toContain("مثبّتة");
    expect(textOf(strip)).toContain("🏆 مكافأة 200 دولار");
    expect(strip.match(/data-reward-badge/g)).toHaveLength(1);
    expect(classTokens(strip)).toContain("line-through");
    expectClean(strip);
    const card = render(createElement(PinnedStrip, { tasks, variant: "card" }));
    expect(card).toContain('data-pinned-strip="card"');
    expect(textOf(card)).toContain("مهام مثبّتة");
    expect(render(createElement(PinnedStrip, { tasks: [] }))).toBe("");
  });

  it("a partner's cards carry no reward: the same strip without the field draws none", () => {
    expect(render(createElement(PinnedStrip, { tasks: tasks.map((t) => ({ ...t, reward: null })) }))).not.toContain("data-reward-badge");
  });
});

describe("where the screens mount it", () => {
  it("the task page asks the server what the person may see and hands a partner nothing", () => {
    // the page and the phone read one sheet (src/server/services/task-sheet.ts): the lens decides there, the page only draws it
    const sheet = read("src/server/services/task-sheet.ts");
    expect(sheet).toMatch(/rewardLensFor\(actor, task\.workspaceId\)/);
    expect(sheet).toMatch(/lens\.rewards && rewardStatus/);
    expect(sheet).toMatch(/lockedFields/);
    const page = read("src/app/(app)/tasks/[id]/page.tsx");
    expect(page).toMatch(/sheet\.lens\.canPin \?/);
    expect(page).toMatch(/lockedFields=\{sheet\.lockedFields\}/);
  });

  it("the list, My Work, the board, the project page and «اليوم» ask the same lens before they draw a reward or a pin", () => {
    expect(read("src/app/(app)/list/page.tsx")).toMatch(/rewardLensFor\(actor, ctx\.workspaceId\)/);
    expect(read("src/app/(app)/list/page.tsx")).toMatch(/data-reward-totals/);
    expect(read("src/server/services/my-work.ts")).toMatch(/featureOn\(settingsByOrg\.get\(m\.organizationId\), "taskRewards"\) && m\.role !== "GUEST"/);
    expect(read("src/app/(app)/boards/[id]/page.tsx")).toMatch(/lens\.rewards && listBadgeStatus/);
    expect(read("src/app/(app)/projects/[id]/page.tsx")).toMatch(/<PinnedStrip tasks=\{pinned\} \/>/);
    expect(read("src/app/(app)/page.tsx")).toMatch(/<PinnedStrip tasks=\{pinned\} variant="card" \/>/);
    expect(read("src/components/board-view.tsx")).toContain("<RewardBadge reward={task.reward} />");
    expect(read("src/components/instant-work.tsx")).toContain("<RewardToggleBlock");
  });

  it("the money numbers never reach a model, a webhook or a push: no file of the feature imports one", () => {
    for (const file of ["src/server/services/rewards.ts", "src/server/services/pinned.ts", "src/server/services/reward-guard.ts", "src/lib/rewards.ts"]) {
      // the code, not the comments that explain why it is not there
      const text = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/anthropic|openai|n8n|dispatchEvent|telegram/i);
    }
  });
});
