import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REWARD_CURRENCIES,
  REWARD_MAX_MINOR,
  amountTextToMinor,
  currencyName,
  fmtMinor,
  fmtReward,
  isRewardTaskStatus,
  listBadgeStatus,
  minorToAmountText,
  rewardBadgeText,
  rewardProblem,
  timeLeftText,
  totalsByCurrency,
} from "@/lib/rewards";
import { REWARD_FIELDS, canEditRewardTask, canPinTask, canSeeReward, canSetReward, withoutReward } from "@/server/policy/reward";
import { rewardBodySchema, toRewardRequest } from "@/server/services/reward-input";
import { AR } from "@/lib/i18n/dict";
import { FEATURES, FEATURE_DEFAULTS } from "@/lib/features";

const ROOT = path.resolve(__dirname, "..");

describe("a reward's money is exact: integer minor units, never a float", () => {
  it("reads typed text into minor units with integer arithmetic", () => {
    const cases: [string, number | null][] = [
      ["12.5", 1250],
      ["12.50", 1250],
      ["12", 1200],
      ["0.05", 5],
      ["0.1", 10],
      ["  7  ", 700],
      ["١٢٫٥", 1250], // Arabic-Indic digits and the Arabic decimal mark
      ["٣٠٠", 30000],
      ["1,250.5", 125050],
      ["1000000", 100_000_000],
      ["0", 0],
      ["1.234", null], // three decimals: refused, never rounded
      ["-5", null],
      ["", null],
      ["abc", null],
      ["1e3", null],
      ["12.", null],
      [".5", null],
      ["99999999999", null], // ten digits or more: refused
    ];
    for (const [text, minor] of cases) expect(amountTextToMinor(text), text).toBe(minor);
  });

  it("round-trips every cent and never drifts (0.1 + 0.2 is exactly 0.30)", () => {
    for (const whole of [0, 1, 7, 150, 99_999, 1_000_000]) {
      for (let cents = 0; cents < 100; cents++) {
        const minor = whole * 100 + cents;
        const text = minorToAmountText(minor);
        expect(amountTextToMinor(text), `${minor} -> ${text}`).toBe(minor);
      }
    }
    expect(amountTextToMinor("0.1")! + amountTextToMinor("0.2")!).toBe(30);
    expect(fmtMinor(amountTextToMinor("0.1")! + amountTextToMinor("0.2")!)).toBe("0.30");
  });

  it("shows it with the one number formatter: Western digits, commas, cents only when there are any", () => {
    expect(fmtMinor(15000)).toBe("150");
    expect(fmtMinor(15050)).toBe("150.50");
    expect(fmtMinor(125_000)).toBe("1,250");
    expect(fmtMinor(100_000_000)).toBe("1,000,000");
    expect(fmtMinor(5)).toBe("0.05");
    expect(fmtMinor(null)).toBe("");
    expect(fmtMinor(-1)).toBe("");
    expect(fmtMinor(1.5)).toBe("");
    expect(fmtReward(15000, "JOD")).toBe("150 دينار");
    expect(rewardBadgeText(15050, "USD")).toBe("🏆 مكافأة 150.50 دولار");
    expect(fmtReward(15000, "JOD")).not.toMatch(/[٠-٩]/);
  });

  it("every currency of the picker has an Arabic name (and the same list is the server's)", () => {
    expect([...REWARD_CURRENCIES]).toEqual(["USD", "JOD", "SYP", "EUR", "TRY"]);
    for (const code of REWARD_CURRENCIES) expect(currencyName(code), code).toMatch(/[؀-ۿ]/);
    expect(currencyName("XXX")).toBe("XXX");
    expect(currencyName(null)).toBe("");
  });

  it("refuses a reward with no day, no amount, 0, a negative, a fraction of a cent, past the cap, or a stranger currency", () => {
    const day = new Date();
    const ok = { amountMinor: 1250, currency: "USD", dueDate: day };
    expect(rewardProblem(ok)).toBeNull();
    expect(rewardProblem({ ...ok, dueDate: null })).toBe("reward.due_required");
    expect(rewardProblem({ ...ok, dueDate: undefined })).toBe("reward.due_required");
    for (const amountMinor of [0, -1, 1.5, NaN, "5", null, undefined]) expect(rewardProblem({ ...ok, amountMinor }), String(amountMinor)).toBe("reward.amount_invalid");
    expect(rewardProblem({ ...ok, amountMinor: REWARD_MAX_MINOR })).toBeNull();
    expect(rewardProblem({ ...ok, amountMinor: REWARD_MAX_MINOR + 1 })).toBe("reward.amount_too_big");
    expect(rewardProblem({ ...ok, currency: "usd" })).toBe("reward.currency_invalid");
    expect(rewardProblem({ ...ok, currency: "XXX" })).toBe("reward.currency_invalid");
    expect(rewardProblem({ ...ok, note: "x".repeat(301) })).toBe("reward.note_long");
    expect(rewardProblem({ ...ok, note: "x".repeat(300) })).toBeNull();
    // every key the server can answer with has its Arabic sentence
    for (const key of ["reward.due_required", "reward.amount_invalid", "reward.amount_too_big", "reward.currency_invalid", "reward.note_long", "reward.owner_only"]) {
      expect(AR[key], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("adds money per currency, never across currencies", () => {
    expect(
      totalsByCurrency([
        { currency: "USD", amountMinor: 10 },
        { currency: "USD", amountMinor: 20 },
        { currency: "JOD", amountMinor: 500 },
        { currency: null, amountMinor: 99 },
        { currency: "EUR", amountMinor: null },
      ]),
    ).toEqual([
      { currency: "JOD", minor: 500, count: 1 },
      { currency: "USD", minor: 30, count: 2 },
    ]);
  });

  it("the request body: an amount typed or in minor units; garbled text is a 422 key, an unknown field is refused", () => {
    expect(toRewardRequest(rewardBodySchema.parse({ amount: "12.5", currency: "USD", note: "ملاحظة" }))).toEqual({ amountMinor: 1250, currency: "USD", note: "ملاحظة" });
    expect(toRewardRequest(rewardBodySchema.parse({ amount: 7.25 }))).toEqual({ amountMinor: 725, currency: null, note: null });
    expect(toRewardRequest(rewardBodySchema.parse({ amountMinor: 300, currency: "EUR" }))).toMatchObject({ amountMinor: 300 });
    expect(() => toRewardRequest(rewardBodySchema.parse({ amount: "abc" }))).toThrow();
    expect(() => toRewardRequest(rewardBodySchema.parse({ currency: "USD" }))).toThrow();
    expect(rewardBodySchema.safeParse({ amount: "5", rewardStatus: "AWARDED" }).success).toBe(false);
  });
});

describe("the time left, in Arabic", () => {
  const now = new Date("2031-03-10T10:00:00.000Z");
  const at = (ms: number) => new Date(now.getTime() + ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  it("says the largest whole unit, with the Arabic number forms", () => {
    expect(timeLeftText(at(-1), now)).toBe("انتهت المهلة");
    expect(timeLeftText(now, now)).toBe("انتهت المهلة");
    expect(timeLeftText(at(30_000), now)).toBe("باقي أقل من دقيقة");
    expect(timeLeftText(at(MIN), now)).toBe("باقي دقيقة");
    expect(timeLeftText(at(2 * MIN), now)).toBe("باقي دقيقتين");
    expect(timeLeftText(at(5 * MIN), now)).toBe("باقي 5 دقائق");
    expect(timeLeftText(at(15 * MIN), now)).toBe("باقي 15 دقيقة");
    expect(timeLeftText(at(HOUR), now)).toBe("باقي ساعة");
    expect(timeLeftText(at(2 * HOUR + 5 * MIN), now)).toBe("باقي ساعتين");
    expect(timeLeftText(at(7 * HOUR), now)).toBe("باقي 7 ساعات");
    expect(timeLeftText(at(DAY), now)).toBe("باقي يوم");
    expect(timeLeftText(at(2 * DAY), now)).toBe("باقي يومين");
    expect(timeLeftText(at(4 * DAY), now)).toBe("باقي 4 أيام");
    expect(timeLeftText(at(15 * DAY), now)).toBe("باقي 15 يومًا");
    expect(timeLeftText(null, now)).toBe("");
    expect(timeLeftText("not a date", now)).toBe("");
  });
});

describe("who may do what with a reward (the one policy)", () => {
  it("a reward task is editable by an owner only; a plain task by everybody", () => {
    for (const status of ["OPEN", "AWARDED", "CANCELLED"]) {
      expect(canEditRewardTask({ isOwner: false }, { rewardStatus: status }), status).toBe(false);
      expect(canEditRewardTask({ isOwner: true }, { rewardStatus: status }), status).toBe(true);
    }
    for (const status of [null, undefined, "NONE"]) expect(canEditRewardTask({ isOwner: false }, { rewardStatus: status }), String(status)).toBe(true);
    expect(isRewardTaskStatus("NONE")).toBe(false);
    expect(listBadgeStatus("CANCELLED")).toBe(false);
    expect(listBadgeStatus("OPEN")).toBe(true);
    expect(canSetReward({ isOwner: false })).toBe(false);
    expect(canSetReward({ isOwner: true })).toBe(true);
  });

  it("a partner (an org guest, or a guest row in the space) never sees a reward; the owner always does", () => {
    expect(canSeeReward({ orgRole: "GUEST" })).toBe(false);
    expect(canSeeReward({ orgRole: "GUEST", spaceRole: "ADMIN" })).toBe(false);
    expect(canSeeReward({ orgRole: "MEMBER", spaceRole: "GUEST" })).toBe(false);
    expect(canSeeReward({ orgRole: "OWNER", spaceRole: "GUEST" })).toBe(true);
    for (const orgRole of ["OWNER", "ADMIN", "LEAD", "MEMBER"]) expect(canSeeReward({ orgRole, spaceRole: "MEMBER" }), orgRole).toBe(true);
  });

  it("the owner and the space's admin pin; a lead, a member and a guest do not", () => {
    expect(canPinTask({ orgRole: "OWNER" })).toBe(true);
    expect(canPinTask({ orgRole: "MEMBER", spaceRole: "ADMIN" })).toBe(true);
    expect(canPinTask({ orgRole: "ADMIN", spaceRole: "MEMBER" })).toBe(true); // an org ADMIN who is in the space
    expect(canPinTask({ orgRole: "ADMIN", spaceRole: null })).toBe(false); // no row, no space
    expect(canPinTask({ orgRole: "LEAD", spaceRole: "MEMBER" })).toBe(false);
    expect(canPinTask({ orgRole: "MEMBER", spaceRole: "MEMBER" })).toBe(false);
    expect(canPinTask({ orgRole: "GUEST", spaceRole: "ADMIN" })).toBe(false);
  });

  it("strips every reward field and nothing else", () => {
    const row = Object.fromEntries([...REWARD_FIELDS.map((f) => [f, "x"]), ["id", "t1"], ["title", "T"], ["pinnedAt", "p"]]);
    expect(withoutReward(row)).toEqual({ id: "t1", title: "T", pinnedAt: "p" });
    expect(JSON.stringify(withoutReward(row))).not.toMatch(/reward/i);
  });
});

describe("the switch and the words", () => {
  it("«مهام بمكافأة وتثبيت» is a switch, on by default, with its two lines", () => {
    expect(FEATURES).toContain("taskRewards");
    expect(FEATURE_DEFAULTS.taskRewards).toBe(true);
    expect(AR["features.taskRewards.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.taskRewards.hint"]).toMatch(/[؀-ۿ]/);
  });

  it("the money line carries the ⚠️ and the 🔧 together", () => {
    expect(AR["reward.money_note"]).toContain("⚠️");
    expect(AR["reward.money_note"]).toContain("الرواتب");
    expect(AR["reward.money_fix"]).toContain("🔧");
    expect(AR["reward.locked"]).toBe("هالمهمة بمكافأة: بس المالك بيعدّلها.");
  });

  it("the push of an award is generic: the title says nothing of the amount", () => {
    expect(AR["reward.notif.title"]).toBe("اعتُمدت مكافأتك على مهمة");
    expect(AR["reward.notif.title"]).not.toMatch(/\{|\d/);
  });
});

// ---- a guard on the SOURCE: nobody adds a writer of tasks that skips the reward lock without it being written down here ----

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("every writer of a task is accounted for", () => {
  // file -> why it may write a task without the reward lock
  const KNOWN: Record<string, string> = {
    "src/server/services/tasks.ts": "the service layer: create (owner-checked reward), update and delete (assertRewardEditable), move and complete (status moves stay open)",
    "src/server/services/rewards.ts": "set, award, cancel and pin: each checks the owner (or owner/space admin for a pin) itself",
    "src/server/services/task-assign.ts": "who holds a task: the accept/return of an assignment request keeps its rank rule; no locked field is touched",
    "src/server/services/teams.ts": "leaving a team frees the person's open tasks: assignee only",
    "src/server/services/accounts.ts": "offboarding hands the person's open work to somebody else: assignee only, by the owner or users.manage",
    "src/server/services/space-delete.ts": "the OWNER deletes a whole space with its work",
    "src/server/chat/make-work.ts": "links a new task to its message (sourceMessageId)",
    "src/server/services/recurrence-spawn.ts": "links a task to its series (recurrenceId); an occurrence is a NEW plain task: a reward is never copied into it",
    "src/server/services/task-recurrence.ts": "links a task to its series (recurrenceId): no locked field is touched",
    "src/server/services/task-privacy-bulk.ts": "the space managers' one-click «المعنيين بس»: writes `visibility` only (who sees a task), never a locked field",
    "src/server/services/departments.ts": "W1.6 «حوّل لمهمة»: links a new task to its ticket (sourceTicketId) right after createTask: no locked field is touched",
    "src/server/services/card-links.ts": "W1.6: fills `sourceCardId` of a task the card's audit log names (only where it is empty): no locked field is touched",
  };
  it("a `task.update/updateMany/delete/deleteMany` outside the list is a new door: guard it with assertRewardEditable and add it above", () => {
    const found = new Set<string>();
    for (const file of walk(path.join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      if (/\b(?:db|tx|prisma|client)\.task\.(?:update|updateMany|delete|deleteMany|upsert)\(/.test(text)) found.add(path.relative(ROOT, file).replace(/\\/g, "/"));
    }
    expect([...found].sort()).toEqual(Object.keys(KNOWN).sort());
  });

  it("the generic routes reach the lock only through the service (they never write a task themselves)", () => {
    for (const rel of ["src/app/api/tasks/route.ts", "src/app/api/tasks/[id]/route.ts", "src/app/api/tasks/[id]/move/route.ts", "src/app/api/tasks/[id]/complete/route.ts", "src/app/api/instant/task/route.ts"]) {
      expect(readFileSync(path.join(ROOT, rel), "utf8"), rel).not.toMatch(/\.task\.(update|updateMany|delete|deleteMany|create)\(/);
    }
    const service = readFileSync(path.join(ROOT, "src/server/services/tasks.ts"), "utf8");
    expect(service).toMatch(/assertRewardEditable\(actor, before\)/);
    expect(service).toMatch(/assertRewardEditable\(actor, task\)/);
    expect(service).toMatch(/prepareReward\(actor, input\.reward/);
  });

  it("no webhook or push payload of a task carries a reward field", () => {
    for (const rel of ["src/app/api/tasks/route.ts", "src/app/api/tasks/[id]/move/route.ts", "src/app/api/tasks/[id]/complete/route.ts", "src/app/api/tasks/[id]/route.ts"]) {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      for (const call of text.matchAll(/dispatchEvent\([^;]*\);/g)) expect(call[0], `${rel}: ${call[0]}`).not.toMatch(/reward|amount|pinned/i);
    }
    const rewards = readFileSync(path.join(ROOT, "src/server/services/rewards.ts"), "utf8");
    expect(rewards).not.toMatch(/dispatchEvent/);
    expect(rewards).toMatch(/pushBody: label/);
  });
});
