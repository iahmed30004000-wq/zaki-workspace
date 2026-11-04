import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as inboxRoute from "@/app/api/integrations/mail-to-task/route";
import * as testRoute from "@/app/api/integrations/mail-to-task/test/route";
import { withFeature } from "@/lib/features";
import { decryptSecrets } from "@/server/crypto";
import { runDueJobs } from "@/server/jobs/run";
import { setMailSourceFactoryForTests, MailSourceError, type InboxMail, type MailAccount, type MailBoxInfo, type MailSource } from "@/server/mail-task/source";
import { pollMailbox, runMailToTask } from "@/server/services/mail-to-task";
import { call, db, loginAs, makeProject, makeTeam, makeWorkspace } from "./helpers";

/**
 * «بريد يصير مهمة»: the company mailbox becomes tasks. Against a real PostgreSQL and a FAKE mailbox (the `MailSource` interface).
 *
 * Pins: the OWNER alone (403 for an admin, a member and a guest); the switch off = nothing runs and the settings answer 404 (taking
 * the mailbox out still works); the password is stored encrypted, never returned, never logged, refused without ENCRYPTION_KEY; the first
 * run only notes where the mailbox ends; a new mail makes ONE ordinary task (title, «من:» and excerpt, assignee, place); a Message-ID never
 * makes two tasks; a sender outside the allow-list is skipped and counted; the mail is marked read only when the owner chose it and only
 * when it has its task; 20 mails a run; the five-minute rhythm; five failed runs stop the reading («تعطّل») and saving starts it again;
 * a failed task creation frees the mail for the next run; nothing is ever sent to a model.
 */

const KEY = "mail-test-encryption-key-0123456789-abcdef";
const PASSWORD = "app-pass-w0rd-Zq81";
const saved: Record<string, string | undefined> = {};

interface FakeMail {
  uid: number;
  messageId: string | null;
  subject: string | null;
  from: string | null;
  bodyType?: "text/plain" | "text/html" | null;
  body?: string | null;
  seen?: boolean;
}

class FakeMailbox {
  uidValidity = "1";
  mails: FakeMail[] = [];
  openError: unknown = null;
  opened = 0;
  closed = 0;
  fetched: number[] = [];
  marked: number[] = [];
  accounts: MailAccount[] = [];
  add(m: Omit<FakeMail, "uid"> & { uid?: number }): FakeMail {
    const uid = m.uid ?? (this.mails.length === 0 ? 1 : Math.max(...this.mails.map((x) => x.uid)) + 1);
    const mail = { bodyType: "text/plain" as const, body: "", seen: false, ...m, uid };
    this.mails.push(mail);
    return mail;
  }
  source(account: MailAccount): MailSource {
    this.accounts.push(account);
    const box = this;
    return {
      async open(): Promise<MailBoxInfo> {
        box.opened += 1;
        if (box.openError) throw box.openError;
        return { uidValidity: box.uidValidity, uidNext: (box.mails.length === 0 ? 0 : Math.max(...box.mails.map((x) => x.uid))) + 1, exists: box.mails.length };
      },
      async listUnseen(after: number, limit: number) {
        return box.mails.filter((m) => !m.seen && m.uid > after).map((m) => m.uid).sort((a, b) => a - b).slice(0, limit);
      },
      async fetch(uid: number): Promise<InboxMail | null> {
        box.fetched.push(uid);
        const m = box.mails.find((x) => x.uid === uid);
        if (!m) return null;
        return { uid, messageId: m.messageId, subject: m.subject, from: m.from, bodyType: m.bodyType ?? null, body: m.body ?? null };
      },
      async markSeen(uid: number) {
        box.marked.push(uid);
        const m = box.mails.find((x) => x.uid === uid);
        if (m) m.seen = true;
      },
      async close() {
        box.closed += 1;
      },
    };
  }
}

let box = new FakeMailbox();
let factoryCalls = 0;
let clock = 0;
const logLines: string[] = [];

beforeAll(() => {
  for (const k of ["ENCRYPTION_KEY"]) saved[k] = process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setMailSourceFactoryForTests(null);
});
beforeEach(async () => {
  // the job reads EVERY company's mailbox: leftovers of an earlier test must not be polled by this one
  await db.mailInbox.deleteMany({});
  await db.mailTaskSeen.deleteMany({});
  process.env["ENCRYPTION_KEY"] = KEY;
  box = new FakeMailbox();
  factoryCalls = 0;
  logLines.length = 0;
  setMailSourceFactoryForTests((account) => {
    factoryCalls += 1;
    return box.source(account);
  });
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logLines.push(args.map(String).join(" ")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function world(opts: { on?: boolean } = {}) {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
  const proj = await makeProject(ws.id);
  if (opts.on !== false) await setSwitch(team.org.id, true);
  return { ...team, ws, ...proj };
}
type World = Awaited<ReturnType<typeof world>>;

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "emailToTask", on) as Prisma.InputJsonValue } });
}

const URL_BASE = "http://localhost/api/integrations/mail-to-task";

function body(w: World, over: Record<string, unknown> = {}) {
  return {
    host: "mail.example.com",
    port: 993,
    secure: true,
    username: "company@example.com",
    password: PASSWORD,
    folder: "INBOX",
    workspaceId: w.ws.id,
    projectId: w.project.id,
    assigneeId: w.member.id,
    allowList: [] as string[],
    markSeen: false,
    ...over,
  };
}

const put = (b: unknown) => call(inboxRoute.PUT, { method: "PUT", url: URL_BASE, body: b });
const get = () => call(inboxRoute.GET, { url: URL_BASE });
const del = () => call(inboxRoute.DELETE, { method: "DELETE", url: URL_BASE });
const check = (b: unknown) => call(testRoute.POST, { method: "POST", url: `${URL_BASE}/test`, body: b });

/** Saves the card as the owner and makes the first run (it only notes where the mailbox ends). */
async function started(w: World, over: Record<string, unknown> = {}) {
  await loginAs(w.owner.id);
  const saved = await put(body(w, over));
  expect(saved.status, saved.text).toBe(200);
  await tick();
  return saved;
}

/** One run of the job, 6 minutes after the last one. */
async function tick() {
  clock += 6 * 60_000;
  return runMailToTask(new Date(Date.UTC(2030, 0, 1) + clock));
}

const tasksOf = (w: World) => db.task.findMany({ where: { orgId: w.org.id }, orderBy: { number: "asc" } });
const inboxOf = (w: World) => db.mailInbox.findUniqueOrThrow({ where: { orgId: w.org.id } });

describe("who and when", () => {
  it("is the owner's alone: an admin, a member and a guest get 403 on every route", async () => {
    const w = await world();
    for (const user of [w.admin, w.member, w.guest]) {
      await loginAs(user.id);
      expect((await get()).status).toBe(403);
      expect((await put(body(w))).status).toBe(403);
      expect((await del()).status).toBe(403);
      expect((await check(body(w))).status).toBe(403);
    }
    expect(await db.mailInbox.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(factoryCalls).toBe(0);
  });

  it("switch off: save and test answer 404, nothing runs, taking the mailbox out still works; on again, it all comes back", async () => {
    const w = await world();
    await started(w);
    await setSwitch(w.org.id, false);
    box.add({ messageId: "<a@x>", subject: "Hello", from: "a@x.com" });
    const before = factoryCalls;
    await tick();
    await runDueJobs(new Date(Date.UTC(2031, 0, 1)));
    expect(factoryCalls).toBe(before);
    expect(await tasksOf(w)).toHaveLength(0);

    await loginAs(w.owner.id);
    expect((await put(body(w))).status).toBe(404);
    expect((await check(body(w))).status).toBe(404);
    const state = await get();
    expect(state.status).toBe(200);
    expect(state.json?.["switchOn"]).toBe(false);
    expect(state.json?.["state"]).toBe("off");

    await setSwitch(w.org.id, true);
    await tick();
    expect(await tasksOf(w)).toHaveLength(1);

    await setSwitch(w.org.id, false);
    expect((await del()).status).toBe(200);
    expect(await db.mailInbox.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("another company's owner cannot see or change this company's mailbox", async () => {
    const a = await world();
    const b = await world();
    await started(a);
    await loginAs(b.owner.id);
    const state = await get();
    expect(state.json?.["config"]).toBeNull();
    expect(state.json?.["state"]).toBe("none");
    expect(JSON.stringify(state.json)).not.toContain("company@example.com");
  });
});

describe("the password", () => {
  it("is stored encrypted, never returned by any route, never logged, never audited", async () => {
    const w = await world();
    const res = await started(w);
    expect(res.text).not.toContain(PASSWORD);
    const row = await db.mailInbox.findUniqueOrThrow({ where: { orgId: w.org.id } });
    expect(row.passwordEnc).not.toContain(PASSWORD);
    expect(row.passwordEnc.startsWith("v2:")).toBe(true);
    expect(decryptSecrets<{ password: string }>(row.passwordEnc)?.password).toBe(PASSWORD);

    await loginAs(w.owner.id);
    const state = await get();
    expect(state.text).not.toContain(PASSWORD);
    expect(state.text).not.toContain(row.passwordEnc);
    expect(state.json?.["passwordSaved"]).toBe(true);
    expect(Object.keys(state.json ?? {})).not.toContain("password");

    // the connection test and a failing run do not echo it either
    box.openError = Object.assign(new Error(`login failed for ${PASSWORD}`), { authenticationFailed: true });
    const t = await check(body(w, { password: undefined }));
    expect(t.json).toEqual({ ok: false, reasonKey: "mail.err.auth" });
    expect(t.text).not.toContain(PASSWORD);
    await tick();
    expect(box.accounts.every((a) => a.password === PASSWORD)).toBe(true);

    const audits = await db.auditLog.findMany({ where: { orgId: w.org.id } });
    expect(JSON.stringify(audits)).not.toContain(PASSWORD);
    expect(logLines.join("\n")).not.toContain(PASSWORD);
    expect(logLines.join("\n")).not.toContain("login failed");
  });

  it("a save without a password keeps the saved one; a new mailbox needs one", async () => {
    const w = await world();
    await started(w);
    const before = (await inboxOf(w)).passwordEnc;
    await loginAs(w.owner.id);
    expect((await put(body(w, { password: undefined, markSeen: true }))).status).toBe(200);
    const after = await inboxOf(w);
    expect(after.passwordEnc).toBe(before);
    expect(after.markSeen).toBe(true);

    const w2 = await world();
    await loginAs(w2.owner.id);
    const r = await put(body(w2, { password: undefined }));
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json?.["details"])).toContain("mail.err.password_required");
  });

  it("without ENCRYPTION_KEY the card refuses to save and the state says so", async () => {
    const w = await world();
    delete process.env["ENCRYPTION_KEY"];
    await loginAs(w.owner.id);
    const r = await put(body(w));
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json?.["details"])).toContain("mail.err.no_key");
    expect(await db.mailInbox.count({ where: { orgId: w.org.id } })).toBe(0);
    expect((await get()).json?.["keyConfigured"]).toBe(false);
  });

  it("taking the mailbox out deletes the password with it", async () => {
    const w = await world();
    await started(w);
    await loginAs(w.owner.id);
    expect((await del()).status).toBe(200);
    expect(await db.mailInbox.count({ where: { orgId: w.org.id } })).toBe(0);
  });
});

describe("what the owner may type", () => {
  it("refuses a private server address, a bad folder, a bad list entry, a project of another place and a person who cannot take the task", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const bad = async (over: Record<string, unknown>, key: string) => {
      const r = await put(body(w, over));
      expect(r.status, key).toBe(422);
      expect(JSON.stringify(r.json?.["details"]), key).toContain(key);
    };
    await bad({ host: "10.0.0.5" }, "mail.err.private_host");
    await bad({ host: "127.0.0.1" }, "mail.err.private_host");
    await bad({ host: "https://mail.example.com" }, "mail.err.host_invalid");
    await bad({ folder: "a*" }, "mail.err.folder_invalid");
    await bad({ allowList: ["not valid!"] }, "mail.err.allow_invalid");
    await bad({ projectId: "nope" }, "mail.err.project_missing");
    const other = await world();
    await bad({ projectId: other.project.id }, "mail.err.project_missing");
    await bad({ assigneeId: "nobody-here" }, "mail.err.assignee_invalid");
    expect(await db.mailInbox.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("the card's lists show the owner every space and project and the active people, never a guest", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const state = await get();
    const spaces = state.json?.["spaces"] as { id: string; projects: { id: string }[] }[];
    expect(spaces.find((s) => s.id === w.ws.id)?.projects.map((p) => p.id)).toContain(w.project.id);
    const people = (state.json?.["people"] as { id: string }[]).map((p) => p.id);
    expect(people).toContain(w.member.id);
    expect(people).not.toContain(w.guest.id);
  });
});

describe("the test button", () => {
  it("connects, counts the folder, closes; a failure is a dictionary key", async () => {
    const w = await world();
    box.add({ messageId: "<1@x>", subject: "one", from: "a@x.com" });
    box.add({ messageId: "<2@x>", subject: "two", from: "a@x.com" });
    await loginAs(w.owner.id);
    const ok = await check(body(w));
    expect(ok.json).toEqual({ ok: true, count: 2 });
    expect(box.closed).toBe(1);
    expect(await db.mailInbox.count({ where: { orgId: w.org.id } })).toBe(0);

    box.openError = new MailSourceError("mail.err.private_host");
    expect((await check(body(w))).json).toEqual({ ok: false, reasonKey: "mail.err.private_host" });
    box.openError = Object.assign(new Error("raw words of the server"), { code: "ECONNREFUSED" });
    const bad = await check(body(w));
    expect(bad.json).toEqual({ ok: false, reasonKey: "mail.err.connect" });
    expect(bad.text).not.toContain("raw words");
    expect(box.closed).toBe(3);
  });
});

describe("the job", () => {
  it("the first run only notes where the mailbox ends: mail that was already there is not turned into tasks", async () => {
    const w = await world();
    box.add({ messageId: "<old@x>", subject: "Old mail", from: "a@x.com" });
    await started(w);
    expect(await tasksOf(w)).toHaveLength(0);
    const row = await inboxOf(w);
    expect(row.lastUid).toBe(1);
    expect(row.uidValidity).toBe("1");
    box.add({ messageId: "<new@x>", subject: "New mail", from: "a@x.com" });
    await tick();
    expect((await tasksOf(w)).map((t) => t.title)).toEqual(["New mail"]);
  });

  it("a new mail makes one ordinary task: title, «من:» and excerpt, place, assignee, activity and the bell", async () => {
    const w = await world();
    await started(w);
    box.add({
      messageId: "<m1@example.com>",
      subject: `  Invoice ${String.fromCharCode(0)}question\nplease  `,
      from: "Boss@Example.com",
      bodyType: "text/html",
      body: `<p>Hi,</p><p>See <a href="https://example.com/inv">the invoice</a> and tell me.</p><script>evil()</script>`,
    });
    const run = await tick();
    expect(run).toMatchObject({ inboxes: 1, created: 1, skipped: 0, failed: 0 });
    const [task] = await tasksOf(w);
    expect(task?.title).toBe("Invoice question please");
    expect(task?.description?.startsWith("من: boss@example.com\n\n")).toBe(true);
    expect(task?.description).toContain("Hi,");
    expect(task?.description).toContain("the invoice");
    expect(task?.description).toContain("https://example.com/inv");
    expect(task?.description).not.toContain("evil");
    expect(task?.description).not.toContain("<");
    expect(task?.workspaceId).toBe(w.ws.id);
    expect(task?.projectId).toBe(w.project.id);
    expect(task?.boardId).toBe(w.board.id);
    expect(task?.columnId).toBe(w.todo.id);
    expect(task?.assigneeId).toBe(w.member.id);
    expect(task?.creatorId).toBe(w.owner.id);
    const seen = await db.mailTaskSeen.findMany({ where: { orgId: w.org.id } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ messageId: "mid:m1@example.com", taskId: task?.id });
    // the audit row says it came from the mailbox; the assignee was told
    expect(await db.auditLog.count({ where: { orgId: w.org.id, action: "task.created", target: task?.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: w.member.id } })).toBeGreaterThan(0);
    const row = await inboxOf(w);
    expect(row.createdCount).toBe(1);
    expect(row.failures).toBe(0);
    expect(row.lastOkAt).not.toBeNull();
  });

  it("with nobody chosen the task is unassigned; a mail without subject or body still makes a task with a fallback title", async () => {
    const w = await world();
    await started(w, { assigneeId: null });
    box.add({ messageId: "<n@x>", subject: null, from: null, bodyType: null, body: null });
    await tick();
    const [task] = await tasksOf(w);
    expect(task?.assigneeId).toBeNull();
    expect(task?.title).toBe("(رسالة بدون موضوع)");
    expect(task?.description ?? "").toBe("");
  });

  it("title is cut to 200 and the excerpt to about 1500; only the first part of the body is used", async () => {
    const w = await world();
    await started(w);
    box.add({ messageId: "<big@x>", subject: "T".repeat(500), from: "a@x.com", body: "word ".repeat(2000) });
    await tick();
    const [task] = await tasksOf(w);
    expect(Array.from(task?.title ?? "")).toHaveLength(200);
    expect(Array.from(task?.description ?? "").length).toBeLessThanOrEqual(1500 + 40);
  });

  it("a Message-ID never makes two tasks: the same mail under another number, and the same run again", async () => {
    const w = await world();
    await started(w);
    box.add({ messageId: "<same@x>", subject: "Once", from: "a@x.com" });
    box.add({ messageId: "<SAME@x>", subject: "Once again (a copy)", from: "a@x.com" });
    const run = await tick();
    expect(run.created).toBe(1);
    expect(await tasksOf(w)).toHaveLength(1);
    // the stored UID has moved: another run finds nothing; even forced back, the Message-ID holds
    await db.mailInbox.update({ where: { orgId: w.org.id }, data: { lastUid: 0 } });
    const again = await pollMailbox(w.org.id);
    expect(again.created).toBe(0);
    expect(again.duplicates).toBe(2);
    expect(await tasksOf(w)).toHaveLength(1);
  });

  it("a mail without a Message-ID is remembered by its number and still not repeated", async () => {
    const w = await world();
    await started(w);
    box.add({ messageId: null, subject: "No id", from: "a@x.com" });
    await tick();
    await db.mailInbox.update({ where: { orgId: w.org.id }, data: { lastUid: 0 } });
    expect((await pollMailbox(w.org.id)).created).toBe(0);
    expect(await tasksOf(w)).toHaveLength(1);
  });

  it("the allow-list: a sender outside it is skipped and counted, one inside (address or domain) becomes a task", async () => {
    const w = await world();
    await started(w, { allowList: ["Boss@Example.com", "partner.io"] });
    box.add({ messageId: "<1@x>", subject: "From the boss", from: "boss@example.com" });
    box.add({ messageId: "<2@x>", subject: "From a stranger", from: "stranger@evil.test" });
    box.add({ messageId: "<3@x>", subject: "From the partner", from: "anyone@partner.io" });
    box.add({ messageId: "<4@x>", subject: "From a sub-domain", from: "x@mail.partner.io" });
    box.add({ messageId: "<5@x>", subject: "From nobody", from: null });
    const run = await tick();
    expect(run).toMatchObject({ created: 2, skipped: 3 });
    expect((await tasksOf(w)).map((t) => t.title)).toEqual(["From the boss", "From the partner"]);
    expect((await inboxOf(w)).skippedCount).toBe(3);
    // a skipped mail is not remembered as a task and not touched
    expect(await db.mailTaskSeen.count({ where: { orgId: w.org.id } })).toBe(2);
  });

  it("the mailbox is not changed unless the owner chose it; then only a mail that has its task is marked read", async () => {
    const w = await world();
    await started(w, { allowList: ["ok.test"] });
    box.add({ messageId: "<1@x>", subject: "kept", from: "a@ok.test" });
    box.add({ messageId: "<2@x>", subject: "skipped", from: "a@other.test" });
    await tick();
    expect(box.marked).toEqual([]);
    expect(box.accounts.at(-1)?.markSeen).toBe(false);

    await loginAs(w.owner.id);
    expect((await put(body(w, { password: undefined, allowList: ["ok.test"], markSeen: true }))).status).toBe(200);
    box.add({ messageId: "<3@x>", subject: "kept too", from: "a@ok.test" });
    box.add({ messageId: "<4@x>", subject: "skipped too", from: "a@other.test" });
    await tick();
    expect(box.accounts.at(-1)?.markSeen).toBe(true);
    expect(box.marked).toEqual([3]);
  });

  it("at most 20 mails a run, oldest first; the rest on the next run", async () => {
    const w = await world();
    await started(w);
    for (let i = 1; i <= 25; i++) box.add({ messageId: `<m${i}@x>`, subject: `Mail ${i}`, from: "a@x.com" });
    expect((await tick()).created).toBe(20);
    expect((await tasksOf(w)).map((t) => t.title)[0]).toBe("Mail 1");
    expect((await tick()).created).toBe(5);
    expect(await tasksOf(w)).toHaveLength(25);
    expect((await tick()).created).toBe(0);
  });

  it("each mailbox is read once every five minutes, whatever the tick rate", async () => {
    const w = await world();
    const t0 = new Date(Date.UTC(2032, 0, 1, 10, 0, 0));
    await loginAs(w.owner.id);
    expect((await put(body(w))).status).toBe(200);
    expect((await runMailToTask(t0)).inboxes).toBe(1);
    expect((await runMailToTask(new Date(t0.getTime() + 30_000))).inboxes).toBe(0);
    expect((await runMailToTask(new Date(t0.getTime() + 4 * 60_000))).inboxes).toBe(0);
    expect((await runMailToTask(new Date(t0.getTime() + 5 * 60_000))).inboxes).toBe(1);
    // the ordinary job runner carries it too
    const jobs = await runDueJobs(new Date(t0.getTime() + 11 * 60_000));
    expect(jobs.mailTasks?.inboxes).toBe(1);
    expect(jobs.failed).not.toContain("mailTasks");
  });

  it("a mailbox whose numbering was reset starts over by noting where it ends", async () => {
    const w = await world();
    await started(w);
    box.uidValidity = "2";
    box.add({ messageId: "<a@x>", subject: "after the reset", from: "a@x.com" });
    await tick();
    expect(await tasksOf(w)).toHaveLength(0);
    expect((await inboxOf(w)).uidValidity).toBe("2");
    box.add({ messageId: "<b@x>", subject: "later", from: "a@x.com" });
    await tick();
    expect((await tasksOf(w)).map((t) => t.title)).toEqual(["later"]);
  });

  it("a task that cannot be made frees its mail for the next run and does not skip it", async () => {
    const w = await world();
    await started(w);
    box.add({ messageId: "<a@x>", subject: "waits", from: "a@x.com" });
    await db.project.update({ where: { id: w.project.id }, data: { status: "ARCHIVED" } }).catch(() => undefined);
    await db.board.update({ where: { id: w.board.id }, data: { archived: true } });
    const failed = await tick();
    expect(failed.failed).toBe(1);
    expect(await tasksOf(w)).toHaveLength(0);
    expect(await db.mailTaskSeen.count({ where: { orgId: w.org.id } })).toBe(0);
    const row = await inboxOf(w);
    expect(row.failures).toBe(1);
    expect(row.lastUid).toBe(0);
    await db.board.update({ where: { id: w.board.id }, data: { archived: false } });
    await db.project.update({ where: { id: w.project.id }, data: { status: "ACTIVE" } });
    expect((await tick()).created).toBe(1);
    expect((await inboxOf(w)).failures).toBe(0);
  });
});

describe("failure", () => {
  it("logs the error NAME only, records a key, and stops after five failed runs in a row («تعطّل»); saving starts it again", async () => {
    const w = await world();
    await started(w);
    box.openError = Object.assign(new Error("the server said: SECRET-WORDS-123"), { authenticationFailed: true });
    for (let i = 1; i <= 4; i++) {
      await tick();
      const row = await inboxOf(w);
      expect(row.failures).toBe(i);
      expect(row.disabledAt).toBeNull();
      expect(row.lastErrorKey).toBe("mail.err.auth");
    }
    await tick();
    const stopped = await inboxOf(w);
    expect(stopped.failures).toBe(5);
    expect(stopped.disabledAt).not.toBeNull();
    expect(logLines.join("\n")).not.toContain("SECRET-WORDS");
    expect(logLines.some((l) => l.includes("mail_task.run_failed") && l.includes("mail.err.auth"))).toBe(true);

    await loginAs(w.owner.id);
    expect((await get()).json?.["state"]).toBe("disabled");
    const calls = factoryCalls;
    await tick();
    expect(factoryCalls).toBe(calls);

    box.openError = null;
    expect((await put(body(w, { password: undefined }))).status).toBe(200);
    const back = await inboxOf(w);
    expect(back.failures).toBe(0);
    expect(back.disabledAt).toBeNull();
    box.add({ messageId: "<a@x>", subject: "again", from: "a@x.com" });
    await tick();
    expect((await tasksOf(w)).map((t) => t.title)).toEqual(["again"]);
  });

  it("a success in between resets the count", async () => {
    const w = await world();
    await started(w);
    box.openError = new MailSourceError("mail.err.connect");
    await tick();
    await tick();
    expect((await inboxOf(w)).failures).toBe(2);
    box.openError = null;
    await tick();
    expect((await inboxOf(w)).failures).toBe(0);
  });

  it("a password that can no longer be opened is a failure with its own key, not a crash", async () => {
    const w = await world();
    await started(w);
    await db.mailInbox.update({ where: { orgId: w.org.id }, data: { passwordEnc: "v2:garbage.garbage.garbage" } });
    const run = await tick();
    expect(run.failed).toBe(1);
    expect((await inboxOf(w)).lastErrorKey).toBe("mail.err.password_unreadable");
  });

  it("changing the server or the account starts the mailbox over; changing only the place does not", async () => {
    const w = await world();
    box.add({ messageId: "<old@x>", subject: "old", from: "a@x.com" });
    await started(w);
    expect((await inboxOf(w)).lastUid).toBe(1);
    await loginAs(w.owner.id);
    expect((await put(body(w, { password: undefined, assigneeId: null }))).status).toBe(200);
    expect((await inboxOf(w)).lastUid).toBe(1);
    expect((await put(body(w, { password: undefined, username: "other@example.com" }))).status).toBe(200);
    expect((await inboxOf(w)).lastUid).toBeNull();
  });
});
