import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const queryRaw = vi.fn();
const deleteMany = vi.fn();
vi.mock("@/server/db", () => ({ db: { $queryRaw: (...args: unknown[]) => queryRaw(...args), scheduledChatMessage: { deleteMany: (...args: unknown[]) => deleteMany(...args) } } }));
const deliver = vi.fn();
vi.mock("@/server/chat/scheduled", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/chat/scheduled")>()), deliverScheduled: (...args: unknown[]) => deliver(...args) }));

import { ScheduledList, failureText, type ScheduledAnswer, type ScheduledItem } from "@/components/chat/v2/composer/scheduled-list";
import type { ScheduledDto, ScheduledListDto } from "@/server/chat/scheduled";
import { SCHEDULE_FILES_WINDOW_MS, SCHEDULE_MAX_DAYS as DIALOG_MAX_DAYS, SCHEDULE_MIN_LEAD_MS as DIALOG_MIN_LEAD_MS, editChangesTime, instantOfWall, scheduleProblemOf, suggestedWall, wallFieldsOf, whenText } from "@/components/chat/v2/composer/schedule-dialog";
import { SCHEDULE_MENU_ITEM, SEND_MENU_ITEMS, SendMenu, sendMenuItemsOf } from "@/components/chat/v2/composer/send-menu";
import { ComposerSurface, type SurfaceEngine } from "@/components/chat/v2/composer/composer-surface";
import { runChatScheduled } from "@/server/jobs/chat-scheduled";
import { FILES_WINDOW_MS, MAX_LATE_MS, SCHEDULE_MAX_DAYS, SCHEDULE_MIN_LEAD_MS, messageClientIdOf, sendAtProblem } from "@/server/chat/scheduled";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";

/**
 * C3c.3 — «جدول الإرسال» without a database: the job's loop (what it counts, what it leaves for the next tick, that one broken row never stops the others), the
 * rules shared by the client and the server (the window), the dialog's wall-clock helpers in the company's zone, the send menu, the list and the surface drawn on the server,
 * and the pins that keep the table away from every message reader (the plan's trap). The database proofs (sends at its time, the permission re-check, cancel, edit, send now,
 * only the author, two runs) are `tests/db/chat-scheduled.test.ts`.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path.relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const html = (node: React.ReactElement) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, node));
const noop = () => undefined;

const NOW = new Date("2026-11-20T08:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  queryRaw.mockReset();
  deleteMany.mockReset();
  deliver.mockReset();
  deleteMany.mockResolvedValue({ count: 0 });
});

describe("the job's loop", () => {
  it("counts what each row became, leaves an author whose quota ran out for the next tick, and removes finished rows", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "a1", authorId: "A" },
      { id: "a2", authorId: "A" },
      { id: "b1", authorId: "B" },
      { id: "c1", authorId: "C" },
      { id: "d1", authorId: "D" },
    ]);
    deliver.mockImplementation(async (id: string) => {
      if (id === "a1") return { kind: "later" }; // A's send quota is used up: A's other rows are not even tried
      if (id === "b1") return { kind: "sent", message: null };
      if (id === "c1") return { kind: "failed", reason: "chat.e.post_denied" };
      if (id === "d1") return { kind: "gone" };
      throw new Error("a2 must not be tried");
    });
    deleteMany.mockResolvedValueOnce({ count: 3 });
    const run = await runChatScheduled(NOW);
    expect(run).toEqual({ sent: 1, failed: 1, skipped: 1, later: 1, purged: 3 });
    expect(deliver.mock.calls.map((c) => c[0])).toEqual(["a1", "b1", "c1", "d1"]);
    // every row is delivered as the JOB (due rows only, a failure is marked and told), at the clock it was given
    for (const call of deliver.mock.calls) expect(call.slice(1)).toEqual([NOW, "job"]);
    // a waiting row is never in the purge
    const where = (deleteMany.mock.calls[0]![0] as { where: { status: { in: string[] }; sendAt: { lt: Date } } }).where;
    expect(where.status.in).toEqual(["SENT", "CANCELLED", "FAILED"]);
    expect(where.sendAt.lt.getTime()).toBeLessThan(NOW.getTime() - 29 * DAY);
  });

  it("one broken row is logged and left: the others still go, and the loop ends", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "x1", authorId: "X" },
      { id: "y1", authorId: "Y" },
    ]);
    deliver.mockImplementation(async (id: string) => {
      if (id === "x1") throw new Error("the database blinked");
      return { kind: "sent", message: null };
    });
    const run = await runChatScheduled(NOW);
    expect(run.sent).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("rows that cannot move never hide the due rows behind them: an author whose quota ran out and a row that threw are left OUT of the next read", async () => {
    // a full batch whose head is author A (quota used up after the first), then one more row of B on the next read
    const head = Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, authorId: "A" }));
    queryRaw.mockResolvedValueOnce(head).mockResolvedValueOnce([{ id: "b1", authorId: "B" }]);
    deliver.mockImplementation(async (id: string) => (id === "a0" ? { kind: "later" } : { kind: "sent", message: null }));
    const run = await runChatScheduled(NOW);
    expect(run).toMatchObject({ sent: 1, later: 1 });
    expect(deliver.mock.calls.map((c) => c[0])).toEqual(["a0", "b1"]);
    const second = queryRaw.mock.calls[1]![0] as { sql: string; values: unknown[] };
    expect(second.sql).toContain('"authorId" NOT IN');
    expect(second.values).toContain("A");

    queryRaw.mockReset();
    deliver.mockReset();
    queryRaw.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, authorId: `U${i}` }))).mockResolvedValueOnce([]);
    deliver.mockImplementation(async (id: string) => {
      if (id === "x0") throw new Error("poison");
      return { kind: "gone" };
    });
    await runChatScheduled(NOW);
    const next = queryRaw.mock.calls[1]![0] as { sql: string; values: unknown[] };
    expect(next.sql).toContain('"id" NOT IN');
    expect(next.values).toContain("x0");
  });

  it("nothing due: one read, no delivery", async () => {
    queryRaw.mockResolvedValueOnce([]);
    expect(await runChatScheduled(NOW)).toEqual({ sent: 0, failed: 0, skipped: 0, later: 0, purged: 0 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("selects only PENDING rows that are due, of companies that have the switch on (default on), oldest first", () => {
    const src = read("src/server/jobs/chat-scheduled.ts");
    expect(src).toContain(`s."status" = 'PENDING'::"ScheduledChatStatus"`);
    expect(src).toContain('s."sendAt" <= ${now}');
    expect(src).toContain("COALESCE(o.\"settings\" #>> '{features,chatScheduled}', 'true') <> 'false'");
    expect(src).toContain('ORDER BY s."sendAt" ASC');
  });
});

describe("the delivery is built so that it cannot send twice", () => {
  const src = read("src/server/chat/scheduled.ts");
  it("a row is claimed with a lock and SKIP LOCKED, sent through the normal sendMessage with the clientId sch:<id>, and the twin message is found first", () => {
    expect(src).toContain("FOR UPDATE SKIP LOCKED");
    expect(src).toContain("await sendMessage(ctx, row.conversationId, input)");
    expect(src).toContain("clientId: messageClientIdOf(row.id)");
    expect(messageClientIdOf("abc")).toBe("sch:abc");
    // the twin check sits BEFORE the permission-dependent work
    expect(src.indexOf("twinFirst")).toBeGreaterThan(0);
    expect(src.indexOf("twinFirst")).toBeLessThan(src.indexOf("await sendMessage("));
  });
  it("there is no second way to send: no direct write of a ChatMessage", () => {
    expect(src).not.toMatch(/chatMessage\.create/);
  });
});

describe("the window (the same numbers on the client and on the server)", () => {
  it("a minute and a year, and the files' own day", () => {
    expect(SCHEDULE_MIN_LEAD_MS).toBe(60_000);
    expect(SCHEDULE_MAX_DAYS).toBe(365);
    expect(DIALOG_MIN_LEAD_MS).toBe(SCHEDULE_MIN_LEAD_MS);
    expect(DIALOG_MAX_DAYS).toBe(SCHEDULE_MAX_DAYS);
    expect(SCHEDULE_FILES_WINDOW_MS).toBe(FILES_WINDOW_MS);
    expect(MAX_LATE_MS).toBe(DAY);
  });
  it("the server's judgement: both edges are in, a millisecond beyond is out, a bad date is a bad time", () => {
    const at = (offset: number) => new Date(NOW.getTime() + offset);
    expect(sendAtProblem(at(SCHEDULE_MIN_LEAD_MS), NOW)).toBeNull();
    expect(sendAtProblem(at(SCHEDULE_MIN_LEAD_MS - 1), NOW)).toBe("chat.sched.e.too_soon");
    expect(sendAtProblem(at(SCHEDULE_MAX_DAYS * DAY), NOW)).toBeNull();
    expect(sendAtProblem(at(SCHEDULE_MAX_DAYS * DAY + 1), NOW)).toBe("chat.sched.e.too_far");
    expect(sendAtProblem(at(-1), NOW)).toBe("chat.sched.e.too_soon");
    expect(sendAtProblem(new Date("nope"), NOW)).toBe("chat.sched.e.bad_time");
  });
  it("the dialog's judgement agrees, and adds the files' day", () => {
    const at = (offset: number) => new Date(NOW.getTime() + offset);
    expect(scheduleProblemOf(at(SCHEDULE_MIN_LEAD_MS), NOW, false)).toBeNull();
    expect(scheduleProblemOf(at(SCHEDULE_MIN_LEAD_MS - 1), NOW, false)).toBe("chat.sched.e.too_soon");
    expect(scheduleProblemOf(at(SCHEDULE_MAX_DAYS * DAY), NOW, false)).toBeNull();
    expect(scheduleProblemOf(at(SCHEDULE_MAX_DAYS * DAY + 1), NOW, false)).toBe("chat.sched.e.too_far");
    expect(scheduleProblemOf(null, NOW, false)).toBe("chat.sched.e.bad_time");
    expect(scheduleProblemOf(at(2 * DAY), NOW, true)).toBe("chat.sched.e.files_window");
    expect(scheduleProblemOf(at(2 * DAY), NOW, false)).toBeNull();
    expect(scheduleProblemOf(at(DAY / 2), NOW, true)).toBeNull();
  });
});

describe("the dialog reads the clock of the COMPANY's zone, with Western digits", () => {
  it("an instant becomes the company's wall fields, and back", () => {
    // Damascus is three hours ahead of UTC all year (since 2022)
    expect(wallFieldsOf(new Date("2026-11-20T11:30:00.000Z"), "Asia/Damascus")).toEqual({ date: "2026-11-20", time: "14:30" });
    expect(instantOfWall("2026-11-20", "14:30", "Asia/Damascus")?.toISOString()).toBe("2026-11-20T11:30:00.000Z");
    // the same wall clock means another instant in another zone
    expect(instantOfWall("2026-11-20", "14:30", "UTC")?.toISOString()).toBe("2026-11-20T14:30:00.000Z");
    // across midnight
    expect(wallFieldsOf(new Date("2026-11-20T22:30:00.000Z"), "Asia/Damascus")).toEqual({ date: "2026-11-21", time: "01:30" });
  });
  it("a date that does not exist, or a time that is not a time, is nothing", () => {
    expect(instantOfWall("2026-02-31", "10:00", "UTC")).toBeNull();
    expect(instantOfWall("2026-13-01", "10:00", "UTC")).toBeNull();
    expect(instantOfWall("2026-11-20", "25:00", "UTC")).toBeNull();
    expect(instantOfWall("2026-11-20", "10:61", "UTC")).toBeNull();
    expect(instantOfWall("", "", "UTC")).toBeNull();
  });
  it("the suggestion is an hour ahead on a quarter, inside the window", () => {
    const wall = suggestedWall(new Date("2026-11-20T08:07:00.000Z"), "UTC");
    expect(wall).toEqual({ date: "2026-11-20", time: "09:15" });
    expect(scheduleProblemOf(instantOfWall(wall.date, wall.time, "UTC"), new Date("2026-11-20T08:07:00.000Z"), true)).toBeNull();
  });
  it("the list's time is year/month/day hour:minute, no month names and no Arabic-Indic digits", () => {
    const text = whenText("2026-11-20T11:30:00.000Z", "Asia/Damascus");
    expect(text).toBe("2026/11/20 14:30");
    expect(text).not.toMatch(/[٠-٩A-Za-z]/);
  });
});

describe("the review's fixes (source pins and pure helpers; each was a real finding)", () => {
  const engine = read("src/lib/chat/v2/composer/use-composer.ts");
  const service = read("src/server/chat/scheduled.ts");
  it("an edit that leaves the moment alone sends none (a row seconds from its time can still have its words edited); a changed minute is sent", () => {
    expect(editChangesTime("2026-11-21T09:00:00.000Z", "2026-11-21T09:00:00.000Z")).toBe(false);
    // the row's own moment may carry seconds: the dialog reads minutes
    expect(editChangesTime("2026-11-21T09:00:42.000Z", "2026-11-21T09:00:00.000Z")).toBe(false);
    expect(editChangesTime("2026-11-21T09:00:00.000Z", "2026-11-21T09:01:00.000Z")).toBe(true);
    expect(engine).toContain("editChangesTime(item.sendAt, input.sendAt) ? { sendAt: input.sendAt } : {}");
  });
  it("«جدول» while a send is running says so (a null would close the dialog as if it had worked)", () => {
    const fn = engine.slice(engine.indexOf("async function scheduleNow"), engine.indexOf("/** «عدّل» from the list"));
    expect(fn).toContain('if (busy) return ct("chat.sched.e.busy");');
    expect(fn).not.toMatch(/if \(busy\) return null/);
  });
  it("a retry after a refusal reuses the files already uploaded for this scheduling", () => {
    expect(engine).toContain("const scheduleUploads = React.useRef<{ files: File[]; ids: string[] } | null>(null);");
    expect(engine).toContain("const attachmentIds = reuse ? kept.ids : await uploadTray(tray);");
    expect(engine).toContain("scheduleUploads.current = null;");
  });
  it("«ابعت هلّق» plays the sent sound only when THIS action made a message", () => {
    const fn = engine.slice(engine.indexOf("function sendScheduledNow"), engine.indexOf("function deleteScheduled"));
    expect(fn).toMatch(/if \(answer\?\.message\) \{\s*onMessage\(answer\.message\);\s*playChatSound\("sent"\);\s*\}/);
  });
  it("the bell note is written in the SAME transaction as FAILED (a restart cannot lose it), and the quota counts rows that were really made", () => {
    expect(service).toContain("pushNotificationInTx(tx,");
    expect(service).not.toContain("tellAuthor");
    expect(service.indexOf("createLimiter.hit(")).toBeGreaterThan(service.indexOf("await checkFiles(ctx, attachmentIds, sendAt, null);"));
  });
});

describe("the send menu", () => {
  it("C3c.2's list is untouched; «جدول الإرسال» is added after it, only where the person may schedule", () => {
    expect(SEND_MENU_ITEMS).toEqual(["silent"]);
    expect(SCHEDULE_MENU_ITEM).toBe("schedule");
    const on = { silentSend: true, editing: false, canSubmit: true };
    expect(sendMenuItemsOf(on)).toEqual(["silent"]);
    expect(sendMenuItemsOf({ ...on, scheduling: true })).toEqual(["silent", "schedule"]);
    expect(sendMenuItemsOf({ ...on, silentSend: false, scheduling: true })).toEqual(["schedule"]);
    expect(sendMenuItemsOf({ ...on, scheduling: false })).toEqual(["silent"]);
    // never while an edit is saved, never with nothing to send
    expect(sendMenuItemsOf({ ...on, scheduling: true, editing: true })).toEqual([]);
    expect(sendMenuItemsOf({ ...on, scheduling: true, canSubmit: false })).toEqual([]);
  });
  it("opened, it lists the word «جدول الإرسال»", () => {
    const button = createElement("button", { type: "submit" }, "➤");
    const out = html(createElement(SendMenu, { items: ["silent", "schedule"], onPick: noop, defaultOpen: true, portal: false }, button));
    expect(out).toContain('data-send-item="schedule"');
    expect(out).toContain(AR["chatsched.menu.schedule"]!);
    expect(AR["chatsched.menu.schedule"]).toBe("جدول الإرسال");
  });
});

describe("the list of the person's own scheduled messages", () => {
  it("the client's shapes accept the server's (the compiler checks it: the client declares its own copy and imports nothing of the server)", () => {
    const asItem: ScheduledItem = {} as ScheduledDto;
    const asAnswer: ScheduledAnswer = {} as ScheduledListDto;
    expect([asItem, asAnswer]).toHaveLength(2);
  });
  const item = (over: Record<string, unknown> = {}) => ({
    id: "s1", conversationId: "c1", body: "رسالة بكرا", attachmentIds: [] as string[], mentions: [] as string[], mentionAll: false, replyToId: null, silent: false, noPreview: false,
    sendAt: "2026-11-21T09:00:00.000Z", status: "PENDING" as const, failReason: null as string | null, createdAt: "2026-11-20T08:00:00.000Z", ...over,
  });
  const list = (items: ReturnType<typeof item>[]) =>
    html(createElement(ScheduledList, { open: true, onClose: noop, items, timeZone: "Asia/Damascus", busyId: null, error: "", onSendNow: noop, onEdit: noop, onDelete: noop, portal: false }));

  it("a waiting row shows its time in the company's zone, its words, and the three actions", () => {
    const out = list([item({ attachmentIds: ["f1", "f2"], silent: true })]);
    expect(out).toContain("data-sched-list");
    expect(out).toContain("2026/11/21 12:00");
    expect(out).toContain("رسالة بكرا");
    for (const attr of ["data-sched-now", "data-sched-edit", "data-sched-delete"]) expect(out).toContain(attr);
    expect(out).toContain(AR["chatsched.list.now"]!);
    expect(out).toContain(AR["chatsched.list.edit"]!);
    expect(out).toContain(AR["chatsched.list.delete"]!);
    expect(out).toContain(AR["chatsched.list.silent"]!);
    expect(out).toContain("2 مرفقات");
  });
  it("a failed row says why and can only be deleted; a failure key the dictionary does not know becomes the general sentence", () => {
    const out = list([item({ status: "FAILED", failReason: "chat.e.post_denied" })]);
    expect(out).toContain(AR["chat.e.post_denied"]!);
    expect(out).not.toContain("data-sched-now");
    expect(out).not.toContain("data-sched-edit");
    expect(out).toContain("data-sched-delete");
    expect(failureText("something.unknown")).toBe(AR["chat.sched.e.failed"]);
    expect(failureText(null)).toBe(AR["chat.sched.e.failed"]);
    expect(failureText("chat.sched.e.too_late")).toBe(AR["chat.sched.e.too_late"]);
  });
  it("empty says so", () => {
    expect(list([])).toContain(AR["chatsched.list.empty"]!);
  });
});

describe("the composer surface", () => {
  function engine(over: Record<string, unknown> = {}): SurfaceEngine {
    return {
      body: "أهلا", files: [], busy: false, error: "", progress: [], voice: { mode: "idle" }, face: "send", canSubmit: true, choices: [], pickAt: 0, setPick: noop, hint: null,
      textRef: { current: null }, mediaInput: { current: null }, fileInput: { current: null }, addFiles: noop, removeFile: noop, selectMention: noop,
      onTextChange: noop, onKeyDown: noop, onPaste: noop, submit: noop, cancelRecording: noop, sendVoice: noop, onMicPointerDown: noop, onMicClick: noop, setPollOpen: noop, setRecall: noop,
      ...over,
    } as unknown as SurfaceEngine;
  }
  const surface = (c: SurfaceEngine) => html(createElement(ComposerSurface, { c, me: {}, reply: null, editing: null, onCancelReply: noop, onCancelEdit: noop, recents: [], onEmoji: noop }));

  it("an engine that knows nothing of scheduling draws nothing of it (the switch off, or no right to write)", () => {
    const out = surface(engine());
    expect(out).not.toContain("data-sched");
    expect(out).not.toContain("data-send-menu");
  });
  it("the calendar icon appears only when the conversation has scheduled messages, and counts them", () => {
    const rows = [{ id: "s1" }, { id: "s2" }];
    const out = surface(engine({ scheduling: true, scheduledItems: rows, scheduledZone: "Asia/Damascus" }));
    expect(out).toContain("data-sched-icon");
    expect(out).toContain(AR["chatsched.icon"]!.replace("{n}", "2"));
    expect(out).toContain("data-send-menu");
    expect(surface(engine({ scheduling: true, scheduledItems: [] }))).not.toContain("data-sched-icon");
  });
  it("the notice after a row was made is a status line", () => {
    expect(surface(engine({ scheduling: true, scheduleNotice: AR["chatsched.done"] }))).toContain("data-sched-notice");
  });
});

describe("the plan's trap: nothing that reads messages ever reads this table", () => {
  const files = walk(path.join(ROOT, "src"));
  it("only scheduled.ts, the job and the header (the author's own waiting count, never a message) touch ScheduledChatMessage", () => {
    const users = files.filter((f) => /scheduledChatMessage|ScheduledChatMessage/.test(read(f)));
    expect(users.sort()).toEqual(["src/server/chat/scheduled.ts", "src/server/chat/topics.ts", "src/server/jobs/chat-scheduled.ts"]);
  });
  it("only the three routes and the job reach scheduled.ts: the composer's folders import nothing of the server for it", () => {
    const users = files.filter((f) => /from "@\/server\/chat\/scheduled"/.test(read(f)) && f !== "src/server/chat/scheduled.ts");
    expect(users.sort()).toEqual([
      "src/app/api/chat/conversations/[id]/scheduled/route.ts",
      "src/app/api/chat/scheduled/[id]/route.ts",
      "src/app/api/chat/scheduled/[id]/send/route.ts",
      "src/server/jobs/chat-scheduled.ts",
    ]);
  });
  it("every route is guarded: withApi, and the service checks the company's switch first", () => {
    for (const route of ["src/app/api/chat/conversations/[id]/scheduled/route.ts", "src/app/api/chat/scheduled/[id]/route.ts", "src/app/api/chat/scheduled/[id]/send/route.ts"]) {
      expect(read(route), route).toContain("withApi(");
      expect(read(route), route).toContain("activeOrgCtx()");
    }
    const service = read("src/server/chat/scheduled.ts");
    expect(service).toContain('assertFeatureOn(ctx.orgId, "chatScheduled")');
    // every read of the table is the author's own
    expect(service.match(/scheduledChatMessage\.find(?:Many|First)\(\{[^}]*where/g)?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("the job runs where the scheduler runs (the app by default, the worker with JOBS_IN_WORKER=1)", () => {
  const scheduler = read("src/server/jobs/scheduler.ts");
  it("is called from the locked tick, before the other jobs, and its failure never fails the tick", () => {
    expect(scheduler).toContain('import { runChatScheduled } from "./chat-scheduled";');
    const tick = scheduler.slice(scheduler.indexOf("const work = async"), scheduler.indexOf("return await Promise.race"));
    expect(tick.indexOf("runChatScheduled(now)")).toBeGreaterThan(0);
    expect(tick.indexOf("runChatScheduled(now)")).toBeLessThan(tick.indexOf("runDueJobs(now)"));
    expect(tick).toMatch(/catch \(err\)[\s\S]*chatScheduled/);
    // the one lock and the one 30-second loop are still the scheduler's own
    expect(scheduler).toContain("pg_try_advisory_lock");
    expect(scheduler).toContain("JOBS_INTERVAL_MS = 30_000");
  });
  it("and the worker entry starts the same scheduler", () => {
    expect(scheduler).toContain('startJobRunner("worker")');
  });
});

describe("the strings", () => {
  it("every key the new files use exists and is Arabic with no Latin letter and Western digits only", () => {
    const sources = ["src/components/chat/v2/composer/schedule-dialog.tsx", "src/components/chat/v2/composer/scheduled-list.tsx", "src/components/chat/v2/composer/send-menu.tsx", "src/lib/chat/v2/composer/use-composer.ts", "src/components/chat/v2/composer/composer-surface.tsx", "src/server/chat/scheduled.ts"];
    const keys = new Set<string>();
    for (const file of sources) for (const m of read(file).matchAll(/["'`]((?:chatsched|chat\.sched\.e|notif\.type\.chat_scheduled)[\w.]*)["'`]/g)) keys.add(m[1]!);
    expect(keys.size).toBeGreaterThan(15);
    for (const key of keys) {
      expect(AR[key], key).toBeTruthy();
      const value = AR[key]!;
      expect(value.replace(/{[^{}]+}/g, " "), key).not.toMatch(/[A-Za-z]{2,}/);
      expect(value, key).not.toMatch(/[٠-٩]/);
      expect(value, key).not.toMatch(/ـاً/);
    }
    // the keys the code builds at run time (the failure reasons the server writes)
    for (const key of ["chat.sched.e.too_soon", "chat.sched.e.too_far", "chat.sched.e.too_late", "chat.sched.e.files_window", "chat.sched.e.not_pending", "chatsched.note.denied", "chatsched.note.late", "chatsched.note.files", "chatsched.note.failed"]) expect(AR[key], key).toBeTruthy();
  });
});
