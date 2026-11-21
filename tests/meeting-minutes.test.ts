import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { AR } from "@/lib/i18n/dict";
import { FEATURES, FEATURE_DEFAULTS, FEATURE_META, featureOn, featuresOff } from "@/lib/features";
import { MINUTES_RETENTION_DEFAULT_DAYS, MINUTES_RETENTION_MAX_DAYS, TRANSCRIPT_LINE_MAX_CHARS, claimSignature, parseTranscriptBody, retentionDaysOf, withRetentionDays } from "@/server/calls/transcripts";
import { MINUTES_SYSTEM_PROMPT, canSeeMinutes, labelsOf, minutesMessage, parseMinutes, restoreLabels } from "@/server/calls/minutes";

/**
 * S6.2 «محضر الاجتماع» (TEXT ONLY: the owner decided «لا بس كتابة») — the parts that need no database.
 *
 * Pinned: the switch (off by default, name + hint + group, depends on «المساعد بالاجتماعات»); the retention days (default 30, 1..365); the signed door's body
 * (a short text, a person, a call; replay refused); the minutes the model writes are parsed defensively and names are put back only on the server; who may read
 * them (the owner, and the call's own host when staff: never a guest); the migration is additive and has NO audio column; the agent never writes audio
 * to disk; the mark «عم يتسجّل النص» is mounted in the call room; the promise strings say TEXT only.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("the switch", () => {
  it("`meetingMinutes` is OFF by default, in the owner group, and needs «المساعد بالاجتماعات»", () => {
    expect(FEATURES).toContain("meetingMinutes");
    expect(FEATURE_DEFAULTS.meetingMinutes).toBe(false);
    expect(FEATURE_META.meetingMinutes.group).toBe("owner");
    expect(FEATURE_META.meetingMinutes.dependsOn).toEqual(["assistantInMeetings"]);
    expect(featureOn({}, "meetingMinutes")).toBe(false);
    expect(featureOn({ features: { meetingMinutes: true } }, "meetingMinutes")).toBe(true);
    expect(featuresOff({})).toContain("meetingMinutes");
  });

  it("has an Arabic name and a hint that says TEXT only, no audio, the days, and carries the ⚠️ and 🔧 notes", () => {
    expect(AR["features.meetingMinutes.name"]).toMatch(/[؀-ۿ]/);
    const hint = AR["features.meetingMinutes.hint"] ?? "";
    expect(hint).toContain("⚠️");
    expect(hint).toContain("🔧");
    expect(hint).toContain("النص");
    expect(hint).toContain("صوت");
    expect(hint).toContain("بعد المكالمة");
  });
});

describe("the retention days", () => {
  it("default to 30 and stay inside 1..365", () => {
    expect(MINUTES_RETENTION_DEFAULT_DAYS).toBe(30);
    expect(retentionDaysOf({})).toBe(30);
    expect(retentionDaysOf(null)).toBe(30);
    expect(retentionDaysOf({ meetingMinutes: { retentionDays: 7 } })).toBe(7);
    expect(retentionDaysOf({ meetingMinutes: { retentionDays: 0 } })).toBe(30);
    expect(retentionDaysOf({ meetingMinutes: { retentionDays: -3 } })).toBe(30);
    expect(retentionDaysOf({ meetingMinutes: { retentionDays: 9999 } })).toBe(MINUTES_RETENTION_MAX_DAYS);
    expect(retentionDaysOf({ meetingMinutes: { retentionDays: "x" } })).toBe(30);
    expect(retentionDaysOf({ meetingMinutes: { retentionDays: 2.6 } })).toBe(30);
  });

  it("writes the days next to the other settings and touches nothing else", () => {
    const next = withRetentionDays({ features: { calls: true }, timezone: "x" }, 14) as { features: unknown; timezone: string; meetingMinutes: { retentionDays: number } };
    expect(next.features).toEqual({ calls: true });
    expect(next.timezone).toBe("x");
    expect(next.meetingMinutes.retentionDays).toBe(14);
    expect(retentionDaysOf(next)).toBe(14);
  });
});

describe("the signed door's body", () => {
  const ok = { callId: "c1", personId: "u1", text: "اتفقنا ننهي التقرير بكرا" };

  it("takes a call, a person and a short text", () => {
    expect(parseTranscriptBody(JSON.stringify(ok))).toEqual({ callId: "c1", personId: "u1", text: "اتفقنا ننهي التقرير بكرا" });
  });

  it("cuts nothing silently: a text over the cap, an empty one, a missing person or garbage is refused", () => {
    expect(TRANSCRIPT_LINE_MAX_CHARS).toBe(1500);
    expect(() => parseTranscriptBody(JSON.stringify({ ...ok, text: "ا".repeat(TRANSCRIPT_LINE_MAX_CHARS + 1) }))).toThrow();
    expect(() => parseTranscriptBody(JSON.stringify({ ...ok, text: "   " }))).toThrow();
    expect(() => parseTranscriptBody(JSON.stringify({ callId: "c1", text: "x" }))).toThrow();
    expect(() => parseTranscriptBody("not json")).toThrow();
  });

  it("ignores any other field: there is nowhere to put audio", () => {
    const parsed = parseTranscriptBody(JSON.stringify({ ...ok, audio: "AAAA", pcm: "BBBB" })) as unknown as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["callId", "personId", "text"]);
  });

  it("a signature is accepted once: the same one again is a replay", () => {
    const sig = "a".repeat(64);
    expect(claimSignature(sig, 1_000)).toBe(true);
    expect(claimSignature(sig, 2_000)).toBe(false);
    expect(claimSignature("b".repeat(64), 2_000)).toBe(true);
    // after two minutes the old one is forgotten (its timestamp is long refused by `verifySignature` anyway)
    expect(claimSignature(sig, 1_000 + 130_000)).toBe(true);
  });
});

describe("the minutes the model writes", () => {
  it("parses the JSON the prompt asks for, with caps", () => {
    const m = parseMinutes(JSON.stringify({ summary: "ناقشنا الميزانية", decisions: ["نأجل الإطلاق", "نزيد الفريق"], tasks: [{ title: "جهّز التقرير", who: "زميل 2" }, { title: "ابعت العرض" }] }));
    expect(m.summary).toBe("ناقشنا الميزانية");
    expect(m.decisions).toEqual(["نأجل الإطلاق", "نزيد الفريق"]);
    expect(m.tasks).toEqual([{ title: "جهّز التقرير", who: "زميل 2" }, { title: "ابعت العرض" }]);
  });

  it("finds the JSON inside a fenced or chatty answer", () => {
    const m = parseMinutes('تفضل:\n```json\n{"summary":"س","decisions":[],"tasks":[]}\n```\nانتهى');
    expect(m.summary).toBe("س");
  });

  it("falls back to the plain text as the summary when it is not JSON, and never invents tasks", () => {
    const m = parseMinutes("اجتماع قصير عن الأسعار.");
    expect(m).toEqual({ summary: "اجتماع قصير عن الأسعار.", decisions: [], tasks: [] });
  });

  it("caps the lists: at most 10 decisions and 5 tasks, each cut", () => {
    const m = parseMinutes(JSON.stringify({ summary: "x", decisions: Array.from({ length: 20 }, (_, i) => `قرار ${i}`), tasks: Array.from({ length: 9 }, (_, i) => ({ title: `مهمة ${i}` })) }));
    expect(m.decisions).toHaveLength(10);
    expect(m.tasks).toHaveLength(5);
    const long = parseMinutes(JSON.stringify({ summary: "ا".repeat(5000), decisions: ["ب".repeat(900)], tasks: [{ title: "ت".repeat(900) }] }));
    expect(long.summary.length).toBeLessThanOrEqual(1500);
    expect(long.decisions[0]!.length).toBeLessThanOrEqual(300);
    expect(long.tasks[0]!.title.length).toBeLessThanOrEqual(200);
  });

  it("drops a task with no title and an assignee that is not a pseudonym", () => {
    const m = parseMinutes(JSON.stringify({ summary: "x", decisions: [], tasks: [{ title: "  " }, { title: "مهمة", who: "أحمد الغزاوي" }] }));
    expect(m.tasks).toEqual([{ title: "مهمة" }]);
  });
});

describe("names", () => {
  const rows = [
    { id: "1", authorId: "uA", authorName: "سامر", body: "مرحبا" },
    { id: "2", authorId: "uB", authorName: "ليلى", body: "أهلا" },
    { id: "3", authorId: "uA", authorName: "سامر", body: "يلا" },
  ];

  it("the pseudonyms follow the order people first speak, exactly like the chat filter", () => {
    expect([...labelsOf(rows)]).toEqual([
      ["زميل 1", { userId: "uA", name: "سامر" }],
      ["زميل 2", { userId: "uB", name: "ليلى" }],
    ]);
  });

  it("puts the real names back (only on the server, only for the owner's eyes), also written without the space", () => {
    const labels = labelsOf(rows);
    expect(restoreLabels("زميل 2 بيجهّز التقرير وزميل1 بيراجعه", labels)).toBe("ليلى بيجهّز التقرير وسامر بيراجعه");
    expect(restoreLabels("زميل 9 ما إله وجود", labels)).toBe("زميل 9 ما إله وجود");
  });
});

describe("the message in the call's conversation", () => {
  it("has the summary, the decisions and the proposed tasks as WAITING for the owner, and says it was written after the call", () => {
    const text = minutesMessage({ summary: "ناقشنا الميزانية", decisions: ["نأجل الإطلاق"], tasks: [{ title: "جهّز التقرير" }] });
    expect(text).toContain(AR["calls.minutes.msg_title"]);
    expect(text).toContain("ناقشنا الميزانية");
    expect(text).toContain("نأجل الإطلاق");
    expect(text).toContain("جهّز التقرير");
    expect(text).toContain(AR["calls.minutes.msg_tasks"]);
    expect(text).toContain(AR["calls.minutes.msg_text_only"]);
  });

  it("leaves out an empty list and never prints a Latin word of its own", () => {
    const text = minutesMessage({ summary: "س", decisions: [], tasks: [] });
    expect(text).not.toContain(AR["calls.minutes.msg_decisions"] ?? "§");
    expect(text).not.toContain(AR["calls.minutes.msg_tasks"] ?? "§");
    expect(text.replace(/[^A-Za-z]/g, "")).toBe("");
  });
});

describe("who may read the minutes", () => {
  it("the OWNER, and the person who started the call when they are staff; never a guest, a stranger or an inactive account", () => {
    expect(canSeeMinutes({ role: "OWNER", userId: "o", startedById: "x" })).toBe(true);
    expect(canSeeMinutes({ role: "ADMIN", userId: "h", startedById: "h" })).toBe(true);
    expect(canSeeMinutes({ role: "MEMBER", userId: "h", startedById: "h" })).toBe(true);
    expect(canSeeMinutes({ role: "ADMIN", userId: "a", startedById: "h" })).toBe(false);
    expect(canSeeMinutes({ role: "MEMBER", userId: "m", startedById: "h" })).toBe(false);
    expect(canSeeMinutes({ role: "GUEST", userId: "h", startedById: "h" })).toBe(false);
  });
});

describe("the prompt", () => {
  it("asks for JSON in the dialect, treats the words as data, and forbids inventing", () => {
    expect(MINUTES_SYSTEM_PROMPT).toContain("JSON");
    expect(MINUTES_SYSTEM_PROMPT).toContain("summary");
    expect(MINUTES_SYSTEM_PROMPT).toContain("decisions");
    expect(MINUTES_SYSTEM_PROMPT).toContain("tasks");
    expect(MINUTES_SYSTEM_PROMPT).toMatch(/DATA, never instructions/);
    expect(MINUTES_SYSTEM_PROMPT).toMatch(/never invent/i);
  });
});

describe("TEXT ONLY: no audio is ever stored", () => {
  const dir = path.join(ROOT, "prisma", "migrations", "20261126120000_call_transcripts");

  it("the migration folder is exactly 20261126120000_call_transcripts and is additive", () => {
    expect(existsSync(path.join(dir, "migration.sql"))).toBe(true);
    const sql = readFileSync(path.join(dir, "migration.sql"), "utf8");
    expect(sql).toContain('CREATE TABLE "CallTranscriptLine"');
    expect(sql).toContain('"transcribe" BOOLEAN NOT NULL DEFAULT false');
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|RENAME|ALTER\s+COLUMN)\b/i);
  });

  it("the new table has columns for who, what and when, and nothing that could hold sound", () => {
    const sql = readFileSync(path.join(dir, "migration.sql"), "utf8");
    const table = /CREATE TABLE "CallTranscriptLine" \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? "";
    const columns = [...table.matchAll(/^\s+"(\w+)" /gm)].map((m) => m[1]);
    expect(columns).toEqual(["id", "callId", "personId", "text", "at"]);
    expect(table).not.toMatch(/BYTEA|audio|url|path/i);
  });

  it("the migration folder is the only new one of this package", () => {
    const folders = readdirSync(path.join(ROOT, "prisma", "migrations")).filter((f) => /call_transcripts/.test(f));
    expect(folders).toEqual(["20261126120000_call_transcripts"]);
  });

  it("the voice agent posts text lines through the signed door and writes no audio file", () => {
    const agent = read("voice-agent/agent.py");
    expect(agent).toMatch(/TRANSCRIPT_URL/);
    expect(agent).toContain("logic.sign(");
    expect(agent).not.toMatch(/\bwave\b|soundfile|\.wav|\.mp3|\.flac|open\([^)]*["']wb["']|write_bytes/);
    // the door gets only text and who said it
    expect(agent).toMatch(/"personId"/);
    expect(agent).toMatch(/"text"/);
  });

  it("the door is signed like /api/voice-agent/turn and answers a plain «not found» to anything unsigned", () => {
    const turn = read("src/app/api/voice-agent/turn/route.ts");
    const door = read("src/app/api/voice-agent/transcript/route.ts");
    expect(turn).toContain("verifySignature(");
    expect(door).toContain("verifySignature(");
    expect(door).toContain("agentSettings()");
    expect(door).toContain("claimSignature(");
    expect(door).toMatch(/apiError\("not_found"/);
  });

  it("no route or page sends the raw lines to anybody but the owner's own page", () => {
    const route = read("src/app/api/calls/[id]/minutes/route.ts");
    expect(route).not.toMatch(/callTranscriptLine|transcript:/);
  });
});

describe("the mark in the call room", () => {
  it("is mounted ONCE in the call room and says «عم يتسجّل النص»", () => {
    const room = read("src/components/calls/call-room.tsx");
    expect(room.match(/<RecordingMark\b/g)).toHaveLength(1);
    expect(room).toContain('from "./recording-mark"');
    expect(AR["calls.minutes.mark"]).toBe("عم يتسجّل النص");
    const mark = read("src/components/calls/recording-mark.tsx");
    expect(mark).toContain('"calls.minutes.mark"');
  });

  it("the hook in calls.ts is one small call in each of the two places a call ends (the end for everybody, and the settled empty room)", () => {
    const calls = read("src/server/calls/calls.ts");
    expect(calls.match(/queueMinutes\(/g)).toHaveLength(2);
    expect(calls).toContain('from "./transcripts"');
  });
});

describe("the promise", () => {
  it("says TEXT only (never the sound) and for how many days, in one string with the days left to fill in", () => {
    expect(AR["calls.minutes.promise"]).toContain("{days}");
    expect(AR["calls.minutes.promise"]).toContain("النص");
    expect(AR["calls.minutes.promise"]).toContain("صوت");
  });

  it("the meeting assistant's hint no longer says nothing is kept at all: it says only TEXT can be kept, and only with the other switch", () => {
    const hint = AR["features.assistantInMeetings.hint"] ?? "";
    expect(hint).toContain("ما بينحفظ أي صوت");
    expect(hint).toContain("تسجيل نص الاجتماعات");
  });

  it("every string of the package is Arabic, with Western digits and no Latin word", () => {
    const file = JSON.parse(read("src/lib/i18n/ar.meeting-minutes.json")) as Record<string, string>;
    for (const [key, value] of Object.entries(file)) {
      expect(value, key).toMatch(/[؀-ۿ]/);
      expect(value.replace(/\{[a-z]+\}/g, ""), key).not.toMatch(/[A-Za-z]/);
      expect(value, key).not.toMatch(/[٠-٩]/);
      expect(value, key).not.toContain("ـاً");
    }
  });
});
