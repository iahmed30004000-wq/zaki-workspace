import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_TYPES, MAX_RULES, SKIP_REASONS, TRIGGERS, cleanRuleDraft, readActions, runStatusOf, type ActionResult } from "../src/lib/task-rules";
import { FEATURES, FEATURE_DEFAULTS, featureOn } from "../src/lib/features";
import { AR } from "../src/lib/i18n/dict";
import { systemSentence, systemSentenceOfBody } from "../src/lib/chat/system-sentence";
import { inRuleRun, withinRuleRun } from "../src/server/services/task-rules-hook";

/**
 * «القواعد التلقائية», the half that needs no database: the one validator of a rule, the status of a run, the switch, the words, the
 * hook that keeps a rule from starting a rule, and the source rules that no test with a database can see.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const board = "b1";
const base = { name: "قاعدة", trigger: "CREATED", actions: [{ type: "SET_PRIORITY", priority: "HIGH" }] };

describe("cleanRuleDraft — the one validator of a rule", () => {
  it("accepts every trigger and every action once, and drops keys it does not name", () => {
    const ok = cleanRuleDraft({
      ...base,
      name: "  اسم   القاعدة  ",
      boardId: "",
      secret: "x",
      actions: [{ type: "NOTIFY", userId: "u1", note: "  ملاحظة  ", amount: 99 }, { type: "POST_MESSAGE", topicId: "t1", text: "  سلام  ", extra: 1 }],
    });
    expect(ok).toEqual({
      ok: true,
      value: {
        name: "اسم القاعدة",
        trigger: "CREATED",
        boardId: null,
        triggerColumnId: null,
        actions: [{ type: "NOTIFY", userId: "u1", note: "ملاحظة" }, { type: "POST_MESSAGE", topicId: "t1", text: "سلام" }],
      },
    });
    for (const trigger of TRIGGERS) {
      const res = cleanRuleDraft({ ...base, trigger, boardId: board, triggerColumnId: "c1" });
      expect(res.ok, trigger).toBe(true);
      // a column is kept only for the trigger that is about one
      if (res.ok) expect(res.value.triggerColumnId).toBe(trigger === "MOVED_TO_COLUMN" ? "c1" : null);
    }
    const kinds: Record<string, unknown> = {
      ASSIGN: { type: "ASSIGN", userId: "u" },
      SET_PRIORITY: { type: "SET_PRIORITY", priority: "LOW" },
      MOVE_TO_COLUMN: { type: "MOVE_TO_COLUMN", columnId: "c" },
      ADD_STEP: { type: "ADD_STEP", title: "خطوة" },
      NOTIFY: { type: "NOTIFY", userId: "u" },
      POST_MESSAGE: { type: "POST_MESSAGE", topicId: "t", text: "نص" },
    };
    expect(Object.keys(kinds).sort()).toEqual([...ACTION_TYPES].sort());
    for (const type of ACTION_TYPES) expect(cleanRuleDraft({ ...base, boardId: board, actions: [kinds[type]] }).ok, type).toBe(true);
  });

  it("refuses with a key the screen knows: name, trigger, count, duplicates, columns without a board, unknown actions", () => {
    const key = (raw: unknown) => {
      const res = cleanRuleDraft(raw);
      return res.ok ? "ok" : res.key;
    };
    expect(key(null)).toBe("taskrules.rule_invalid");
    expect(key({ ...base, name: " " })).toBe("taskrules.name_empty");
    expect(key({ ...base, name: "x".repeat(81) })).toBe("taskrules.name_long");
    expect(key({ ...base, trigger: "ON_FULL_MOON" })).toBe("taskrules.trigger_invalid");
    expect(key({ ...base, actions: [] })).toBe("taskrules.actions_count");
    expect(key({ ...base, actions: "x" })).toBe("taskrules.actions_count");
    expect(key({ ...base, actions: [base.actions[0], { type: "ADD_STEP", title: "a" }, { type: "NOTIFY", userId: "u" }] })).toBe("taskrules.actions_count");
    expect(key({ ...base, actions: [{ type: "ADD_STEP", title: "a" }, { type: "ADD_STEP", title: "b" }] })).toBe("taskrules.action_duplicate");
    expect(key({ ...base, trigger: "MOVED_TO_COLUMN", boardId: board })).toBe("taskrules.column_required");
    expect(key({ ...base, trigger: "MOVED_TO_COLUMN", triggerColumnId: "c" })).toBe("taskrules.board_required");
    expect(key({ ...base, actions: [{ type: "MOVE_TO_COLUMN", columnId: "c" }] })).toBe("taskrules.board_required");
    expect(key({ ...base, actions: [{ type: "MOVE_TO_COLUMN", columnId: "c" }], boardId: board })).toBe("ok");
    expect(key({ ...base, actions: [{ type: "PAY_REWARD" }] })).toBe("taskrules.action_invalid");
    expect(key({ ...base, actions: [{ type: "SET_PRIORITY", priority: "NONE" }] })).toBe("taskrules.priority_invalid");
    expect(key({ ...base, actions: [{ type: "ASSIGN" }] })).toBe("taskrules.person_required");
    expect(key({ ...base, actions: [{ type: "ADD_STEP", title: "  " }] })).toBe("taskrules.step_empty");
    expect(key({ ...base, actions: [{ type: "NOTIFY", userId: "u", note: "x".repeat(201) }] })).toBe("taskrules.note_long");
    expect(key({ ...base, actions: [{ type: "POST_MESSAGE", topicId: "t", text: " " }] })).toBe("taskrules.text_empty");
    expect(key({ ...base, actions: [{ type: "POST_MESSAGE", topicId: "t", text: "x".repeat(301) }] })).toBe("taskrules.text_long");
  });

  it("an action list has no money in it: no kind, key or value of a reward, an amount or a customer survives", () => {
    expect([...ACTION_TYPES].join(" ")).not.toMatch(/REWARD|MONEY|PRICE|AMOUNT|CUSTOMER|CASH|PAY/i);
    const res = cleanRuleDraft({ ...base, actions: [{ type: "SET_PRIORITY", priority: "HIGH", rewardAmountMinor: 5000, price: 3 }] });
    expect(res.ok && JSON.stringify(res.value)).not.toMatch(/5000|price|reward/i);
  });

  it("reads stored actions back and drops what it does not know", () => {
    expect(readActions([{ type: "ADD_STEP", title: "ok" }, { type: "FROM_THE_FUTURE" }, null, "x"])).toEqual([{ type: "ADD_STEP", title: "ok" }]);
    expect(readActions("not a list")).toEqual([]);
  });

  it("a project keeps ten rules", () => {
    expect(MAX_RULES).toBe(10);
  });
});

describe("runStatusOf", () => {
  const r = (status: ActionResult["status"]): ActionResult => ({ type: "ADD_STEP", status });
  it("all done is APPLIED, some is PARTIAL, none is SKIPPED (FAILED when one failed), nothing is SKIPPED", () => {
    expect(runStatusOf([r("APPLIED"), r("APPLIED")])).toBe("APPLIED");
    expect(runStatusOf([r("APPLIED"), r("SKIPPED")])).toBe("PARTIAL");
    expect(runStatusOf([r("APPLIED"), r("FAILED")])).toBe("PARTIAL");
    expect(runStatusOf([r("SKIPPED"), r("SKIPPED")])).toBe("SKIPPED");
    expect(runStatusOf([r("SKIPPED"), r("FAILED")])).toBe("FAILED");
    expect(runStatusOf([])).toBe("SKIPPED");
  });
});

describe("the switch and the words", () => {
  it("«القواعد التلقائية» is a switch, on until the owner turns it off, with its name and hint", () => {
    expect(FEATURES).toContain("taskRules");
    expect(FEATURE_DEFAULTS.taskRules).toBe(true);
    expect(featureOn({}, "taskRules")).toBe(true);
    expect(featureOn({ features: { taskRules: false } }, "taskRules")).toBe(false);
    expect(AR["features.taskRules.name"]).toBeTruthy();
    expect(AR["features.taskRules.hint"]).toBeTruthy();
  });

  it("every trigger, action, reason, status and error key a screen can show has its Arabic string", () => {
    const keys = [
      ...TRIGGERS.flatMap((t) => [`taskrules.trigger.${t}`, `taskrules.when.${t}`]),
      ...ACTION_TYPES.flatMap((t) => [`taskrules.action.${t}`, `taskrules.do.${t}`]),
      ...SKIP_REASONS.map((r) => `taskrules.reason.${r}`),
      ...["APPLIED", "PARTIAL", "SKIPPED", "FAILED"].map((s) => `taskrules.status.${s}`),
      ...["APPLIED", "SKIPPED", "FAILED"].map((s) => `taskrules.result.${s}`),
      "notif.type.task_rule",
      "chatc.sys.task_rule",
    ];
    // every machine key the validator and the service can throw
    const source = read("src/lib/task-rules.ts") + read("src/server/services/task-rules.ts");
    for (const m of source.matchAll(/"(taskrules\.[a-z_]+)"/g)) keys.push(m[1]!);
    for (const k of keys) expect(AR[k], k).toBeTruthy();
  });

  it("the card says, in words, that rules act by themselves (⚠️) and how to pause one (🔧)", () => {
    expect(AR["taskrules.note"]).toContain("⚠️");
    expect(AR["taskrules.fix"]).toContain("🔧");
    expect(AR["taskrules.fix"]).toContain("إيقاف");
    expect(read("src/components/task-rules/rules-card.tsx")).toMatch(/taskrules\.note[\s\S]*taskrules\.fix/);
  });

  it("the system line of a rule carries its own words; the author's name can not be replaced by them", () => {
    const meta = { k: "task_rule", p: { rule: "إعلان", task: "ZK-1 · مهمة", text: "جاهزة", name: "مزوّر" } };
    expect(systemSentence(meta, "سارة")).toBe("القاعدة «إعلان» على ZK-1 · مهمة: جاهزة");
    expect(systemSentenceOfBody(JSON.stringify(meta), "سارة")).toBe("القاعدة «إعلان» على ZK-1 · مهمة: جاهزة");
    // the old lines read as before
    expect(systemSentence({ k: "join" }, "سارة")).toBe("انضمام سارة إلى المحادثة");
  });
});

describe("no loops: the hook", () => {
  it("everything inside a rule run is marked, and the mark ends with the run", async () => {
    expect(inRuleRun()).toBe(false);
    const inside = await withinRuleRun("r1", async () => {
      await Promise.resolve();
      return inRuleRun();
    });
    expect(inside).toBe(true);
    expect(inRuleRun()).toBe(false);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("source rules a database test cannot see", () => {
  it("the log is append-only: no file of the app updates, upserts or deletes a TaskRuleRun", () => {
    const offenders = walk(path.join(ROOT, "src"))
      .filter((f) => /taskRuleRun\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("the three task services call the hook after their commit, and none of them imports the engine (it loads on demand)", () => {
    const tasks = read("src/server/services/tasks.ts");
    expect(tasks.match(/afterTaskEvents\(/g)?.length).toBe(3);
    expect(tasks).not.toMatch(/from "\.\/task-rules-run"/);
    expect(tasks).toMatch(/trigger: "CREATED"/);
    expect(tasks).toMatch(/trigger: "MOVED_TO_COLUMN"/);
    expect(tasks).toMatch(/trigger: "COMPLETED"/);
    // a repeating task's new occurrence is a task born like any other
    expect(read("src/server/services/recurrence-spawn.ts")).toMatch(/afterTaskEvents\(\[\{ trigger: "CREATED"/);
    // the engine runs every action inside the marked scope, and the hook refuses to start while it is open
    expect(read("src/server/services/task-rules-run.ts")).toMatch(/withinRuleRun\(rule\.id, \(\) => executeActions/);
    expect(read("src/server/services/task-rules-hook.ts")).toMatch(/if \(events\.length === 0 \|\| inRuleRun\(\)\) return;/);
  });

  it("the engine reaches money, rewards and customers through nothing: no import of the rewards or CRM services", () => {
    const engine = read("src/server/services/task-rules-run.ts") + read("src/server/services/task-rules.ts") + read("src/server/services/task-rules-guards.ts");
    expect(engine).not.toMatch(/from "\.\/rewards"|services\/rewards"|services\/crm"|from "\.\/crm"|prepareReward|rewardAmountMinor/);
    // ... but a reward task is recognised and left alone
    expect(engine).toMatch(/isRewardTaskStatus\(task\.rewardStatus\)\) return all\("reward_task"\)/);
  });

  it("the engine re-checks its admin, its people and its topic at run time", () => {
    const engine = read("src/server/services/task-rules-run.ts");
    expect(engine).toMatch(/stillManages\(task\.orgId, task\.workspaceId, rule\.runAsId\)/);
    expect(engine).toMatch(/eligiblePerson\(actor\.orgId, project, action\.userId\)/);
    expect(engine).toMatch(/usableTopic\(actor\.orgId, project, action\.topicId\)/);
    expect(engine).toMatch(/assertMemberCan\(actor, "projects\.edit"/);
  });

  it("every route of the rules goes through the services (no access decided in a route) and the page draws the card for managers only", () => {
    for (const f of ["src/app/api/projects/[id]/rules/route.ts", "src/app/api/projects/[id]/rules/[ruleId]/route.ts", "src/app/api/projects/[id]/rules/log/route.ts"]) {
      const text = read(f);
      expect(text, f).toMatch(/withApi/);
      expect(text, f).not.toMatch(/from "@\/server\/db"/);
    }
    const page = read("src/app/(app)/projects/[id]/page.tsx");
    expect(page).toMatch(/isSpaceManager\(membership\.role, spaceRow\?\.role\)/);
    expect(page).toMatch(/rulesOn && ruleOptions \? <RulesCard/);
  });

  it("the job runner runs the overdue rules, and the migration only creates", () => {
    expect(read("src/server/jobs/run.ts")).toMatch(/runTaskRules\(now\)/);
    const dirs = readdirSync(path.join(ROOT, "prisma/migrations")).filter((d) => d.endsWith("_task_rules"));
    expect(dirs).toHaveLength(1);
    expect(dirs[0]! > "20261103160000").toBe(true);
    const sql = read(`prisma/migrations/${dirs[0]}/migration.sql`);
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|ALTER COLUMN|RENAME)\b/i);
    expect(sql).toMatch(/CREATE TABLE "TaskRule"/);
    expect(sql).toMatch(/CREATE TABLE "TaskRuleRun"/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "TaskRuleRun_ruleId_taskId_key"/);
  });
});
