import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as boardsRoute from "@/app/api/boards/route";
import * as columnsRoute from "@/app/api/boards/[id]/columns/route";
import * as columnRoute from "@/app/api/boards/[id]/columns/[columnId]/route";
import { sqlStatements } from "../../scripts/lint-migrations.mjs";
import { DEFAULT_BOARD_COLUMNS } from "@/server/services/tasks";
import { createInstantTask } from "@/server/services/instant-work";
import { WORK_STAGES, DEFAULT_WORK_STAGE, workStageSchema, isWorkStage } from "@/lib/work/stage";
import { columnLabel, enumLabel, enumValues } from "@/lib/i18n/enums";
import { FEATURE_DEFAULTS } from "@/lib/features";
import { call, db, loginAs, makeProject, makeTeam, makeWorkspace } from "./helpers";

/**
 * W1.3: a normalized stage on board columns.
 *
 *   - structure (own folder): `BoardColumn.stage TEXT NOT NULL DEFAULT 'DOING'`, nothing else;
 *   - data (ANOTHER folder): two UPDATEs, each with a WHERE, safe to repeat; ties on position: the smallest id;
 *     a column a person already set is never touched;
 *   - a manager chooses the stage (column settings); new boards' default columns are TODO / DOING / DONE;
 *   - `done` keeps its meaning, `columnLabel()` still shows the board's OWN column name.
 *
 * The column is read and written with plain SQL where it matters: these tests stand on the database, not on the
 * generated client.
 */

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const folders = () => readdirSync(MIGRATIONS);
const COLUMN_FOLDER = () => folders().find((f) => /^\d{14}_board_column_stage$/.test(f));
const DATA_FOLDER = () => folders().find((f) => /^\d{14}_board_column_stage_backfill$/.test(f));
/** The statements of a migration (the empty tail after the last semicolon is dropped). */
const statementsOf = (folder: string | undefined): string[] =>
  sqlStatements(sqlOf(folder))
    .map((s) => s.code.trim())
    .filter(Boolean);
const sqlOf = (folder: string | undefined) => (folder ? readFileSync(path.join(MIGRATIONS, folder, "migration.sql"), "utf8") : "");

let t: Awaited<ReturnType<typeof makeTeam>>;
let wsId: string;

beforeEach(async () => {
  t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [
    { userId: t.member.id, role: "MEMBER" },
    { userId: t.admin.id, role: "ADMIN" },
  ]);
  wsId = ws.id;
});

async function stageOf(columnId: string): Promise<string> {
  const rows = await db.$queryRaw<{ stage: string }[]>`SELECT "stage" FROM "BoardColumn" WHERE "id" = ${columnId}`;
  return rows[0]!.stage;
}

async function stagesOfBoard(boardId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ stage: string }[]>`SELECT "stage" FROM "BoardColumn" WHERE "boardId" = ${boardId} ORDER BY "position", "id"`;
  return rows.map((r) => r.stage);
}

async function setStage(columnId: string, stage: string): Promise<void> {
  await db.$executeRaw`UPDATE "BoardColumn" SET "stage" = ${stage} WHERE "id" = ${columnId}`;
}

async function plantBoard(columns: { id?: string; name: string; position: number; done?: boolean }[]) {
  const project = await db.project.create({ data: { workspaceId: wsId, name: `P ${Math.random()}` } });
  const board = await db.board.create({ data: { projectId: project.id, name: "لوحة" } });
  const made: string[] = [];
  for (const c of columns) {
    const row = await db.boardColumn.create({ data: { ...(c.id ? { id: c.id } : {}), boardId: board.id, name: c.name, position: c.position, done: c.done ?? false } });
    made.push(row.id);
  }
  return { project, board, ids: made };
}

describe("W1.3: the stage vocabulary (src/lib/work/stage.ts)", () => {
  it("four stages in their natural order, DOING is the default, and the zod enum accepts only those", () => {
    expect([...WORK_STAGES]).toEqual(["TODO", "DOING", "REVIEW", "DONE"]);
    expect(DEFAULT_WORK_STAGE).toBe("DOING");
    for (const s of WORK_STAGES) expect(workStageSchema.safeParse(s).success).toBe(true);
    for (const bad of ["todo", "Doing", "BLOCKED", "", null, 1]) expect(workStageSchema.safeParse(bad).success, String(bad)).toBe(false);
    expect(isWorkStage("REVIEW")).toBe(true);
    expect(isWorkStage("done")).toBe(false);
  });

  it("every stage has an Arabic label through the enum registry", () => {
    expect(enumValues("WorkStage")).toEqual([...WORK_STAGES]);
    for (const s of WORK_STAGES) expect(enumLabel("WorkStage", s)).toMatch(/[؀-ۿ]/);
  });

  it("columnLabel still shows a board's OWN column name, whatever its stage", () => {
    expect(columnLabel("مراجعة العميل")).toBe("مراجعة العميل");
    expect(columnLabel("Waiting for client")).toBe("Waiting for client");
  });

  it("the switch workStages exists and is OFF by default", () => {
    expect(FEATURE_DEFAULTS.workStages).toBe(false);
  });
});

describe("W1.3: structure and data live in two folders", () => {
  it("the structure folder only adds the column; the data folder only updates", () => {
    expect(COLUMN_FOLDER(), "board_column_stage folder").toBeTruthy();
    expect(DATA_FOLDER(), "board_column_stage_backfill folder").toBeTruthy();
    const structure = sqlOf(COLUMN_FOLDER());
    const data = sqlOf(DATA_FOLDER());
    expect(structure).toMatch(/ALTER TABLE "BoardColumn" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'DOING'/);
    expect(structure).not.toMatch(/\bUPDATE\b/i);
    expect(data).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
    // the timestamp of each folder starts with the package's date and number
    expect(COLUMN_FOLDER()!.startsWith("20261123102100")).toBe(true);
    expect(DATA_FOLDER()! > COLUMN_FOLDER()!).toBe(true);
  });

  it("the data folder has exactly the two statements of the plan, each with a WHERE", () => {
    const statements = statementsOf(DATA_FOLDER());
    expect(statements).toHaveLength(2);
    for (const s of statements) {
      expect(s).toMatch(/^\s*UPDATE "BoardColumn"/i);
      expect(s).toMatch(/\bWHERE\b/i);
    }
    expect(statements[0]).toMatch(/"?stage"?\s*=\s*'DONE'/i);
    expect(statements[0]).toMatch(/"?done"?\s*=\s*true/i);
    expect(statements[1]).toMatch(/"?stage"?\s*=\s*'TODO'/i);
    expect(statements[1]).toMatch(/"?done"?\s*=\s*false/i);
  });

  it("the column is TEXT NOT NULL DEFAULT 'DOING' on the real database", async () => {
    const col = await db.$queryRaw<{ data_type: string; is_nullable: string; column_default: string | null }[]>`
      SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'BoardColumn' AND column_name = 'stage'`;
    expect(col).toHaveLength(1);
    expect(col[0]!.data_type).toBe("text");
    expect(col[0]!.is_nullable).toBe("NO");
    expect(col[0]!.column_default).toContain("DOING");
  });
});

describe("W1.3: the data move on realistic boards", () => {
  const run = async () => {
    for (const s of statementsOf(DATA_FOLDER())) await db.$executeRawUnsafe(s);
  };

  it("a done column becomes DONE, the first column TODO, every other one stays DOING", async () => {
    const b = await plantBoard([
      { name: "أولى", position: 0 },
      { name: "وسط", position: 1 },
      { name: "مراجعة", position: 2 },
      { name: "منتهي", position: 3, done: true },
    ]);
    await run();
    expect(await stagesOfBoard(b.board.id)).toEqual(["TODO", "DOING", "DOING", "DONE"]);
  });

  it("the first column is chosen PER BOARD, and a done first column stays DONE (not TODO)", async () => {
    const a = await plantBoard([
      { name: "أ1", position: 5 },
      { name: "أ2", position: 9 },
    ]);
    const b = await plantBoard([
      { name: "ب1", position: 0, done: true },
      { name: "ب2", position: 1 },
    ]);
    await run();
    expect(await stagesOfBoard(a.board.id)).toEqual(["TODO", "DOING"]);
    expect(await stagesOfBoard(b.board.id)).toEqual(["DONE", "DOING"]);
  });

  it("ties on position: only the column with the smallest id becomes TODO", async () => {
    const b = await plantBoard([
      { id: "col_b", name: "ثانية", position: 0 },
      { id: "col_a", name: "أولى", position: 0 },
      { id: "col_c", name: "ثالثة", position: 0 },
      { id: "col_z", name: "بعيدة", position: 4 },
    ]);
    await run();
    expect(await stageOf("col_a")).toBe("TODO");
    expect(await stageOf("col_b")).toBe("DOING");
    expect(await stageOf("col_c")).toBe("DOING");
    expect(await stageOf("col_z")).toBe("DOING");
    expect(b.ids).toHaveLength(4);
  });

  it("running it again changes nothing, and never touches a column a person already set", async () => {
    const b = await plantBoard([
      { name: "أولى", position: 0 },
      { name: "وسط", position: 1 },
      { name: "آخر", position: 2, done: true },
      { name: "آخر ثاني", position: 3, done: true },
    ]);
    await run();
    const first = await stagesOfBoard(b.board.id);
    await run();
    expect(await stagesOfBoard(b.board.id)).toEqual(first);

    // a person set the first column to REVIEW and a done column to REVIEW: neither is overwritten by another run
    await setStage(b.ids[0]!, "REVIEW");
    await setStage(b.ids[2]!, "REVIEW");
    await run();
    expect(await stageOf(b.ids[0]!)).toBe("REVIEW");
    expect(await stageOf(b.ids[2]!)).toBe("REVIEW");
    expect(await stageOf(b.ids[3]!)).toBe("DONE");
  });

  it("touches nothing but `stage`: done, name, position, colour stay", async () => {
    const b = await plantBoard([
      { name: "أولى", position: 0 },
      { name: "منتهي", position: 1, done: true },
    ]);
    const snap = async () =>
      JSON.stringify(await db.$queryRaw`SELECT "id", "name", "position", "color", "done", "boardId" FROM "BoardColumn" WHERE "boardId" = ${b.board.id} ORDER BY "id"`);
    const before = await snap();
    await run();
    expect(await snap()).toBe(before);
  });
});

describe("W1.3: new boards start with TODO / DOING / DONE columns", () => {
  it("DEFAULT_BOARD_COLUMNS carries a stage per column: only TODO, DOING and DONE, the done column is DONE", () => {
    expect(DEFAULT_BOARD_COLUMNS.map((c) => c.stage)).toEqual(["TODO", "TODO", "DOING", "DOING", "DONE"]);
    expect(new Set(DEFAULT_BOARD_COLUMNS.map((c) => c.stage))).toEqual(new Set(["TODO", "DOING", "DONE"]));
    expect(DEFAULT_BOARD_COLUMNS.map((c) => c.done)).toEqual([false, false, false, false, true]);
  });

  it("POST /api/boards writes those stages", async () => {
    const { project } = await makeProject(wsId);
    await loginAs(t.admin.id);
    const res = await call(boardsRoute.POST, { body: { projectId: project.id, name: "جديدة" } });
    expect(res.status).toBe(201);
    const boardId = (res.json as { board: { id: string } }).board.id;
    expect(await stagesOfBoard(boardId)).toEqual(["TODO", "TODO", "DOING", "DOING", "DONE"]);
    const done = await db.boardColumn.findMany({ where: { boardId }, orderBy: { position: "asc" }, select: { done: true } });
    expect(done.map((c) => c.done)).toEqual([false, false, false, false, true]);
  });

  it("the inbox / instant board gets them too (instant-work.ts)", async () => {
    const ctx = { orgId: t.org.id, orgRole: "ADMIN" as const, userId: t.admin.id };
    const made = await createInstantTask(ctx, wsId, { title: "سريعة", assigneeId: t.admin.id, priority: "NORMAL", dueDate: null });
    const task = await db.task.findUniqueOrThrow({ where: { id: made.id }, select: { boardId: true } });
    expect(await stagesOfBoard(task.boardId)).toEqual(["TODO", "TODO", "DOING", "DOING", "DONE"]);
  });
});

describe("W1.3: column settings - only a manager sets the stage", () => {
  async function board() {
    const { board, todo, done } = await makeProject(wsId);
    return { board, todo, done };
  }

  it("a plain member can still rename a column, but is refused when the body carries a stage (403), and nothing changes", async () => {
    const { board: b, todo } = await board();
    await loginAs(t.member.id);
    const rename = await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { name: "اسم جديد" } });
    expect(rename.status).toBe(200);
    for (const stage of ["REVIEW", "DOING"]) {
      const res = await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { stage } });
      expect(res.status, stage).toBe(403);
    }
    const both = await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { name: "ثالث", stage: "DONE" } });
    expect(both.status).toBe(403);
    expect((await db.boardColumn.findUniqueOrThrow({ where: { id: todo.id } })).name).toBe("اسم جديد");
    expect(await stageOf(todo.id)).toBe("DOING");
  });

  it("the space's manager (a space ADMIN) and the owner set it; it is stored and answered", async () => {
    const { board: b, todo } = await board();
    await loginAs(t.admin.id);
    const res = await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { stage: "REVIEW" } });
    expect(res.status).toBe(200);
    expect((res.json as { column: { stage: string } }).column.stage).toBe("REVIEW");
    expect(await stageOf(todo.id)).toBe("REVIEW");
    await loginAs(t.owner.id);
    const again = await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { stage: "TODO" } });
    expect(again.status).toBe(200);
    expect(await stageOf(todo.id)).toBe("TODO");
  });

  it("an unknown stage is refused with 422 even for a manager", async () => {
    const { board: b, todo } = await board();
    await loginAs(t.admin.id);
    for (const stage of ["BLOCKED", "done", "", 3]) {
      const res = await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { stage } });
      expect(res.status, String(stage)).toBe(422);
    }
    expect(await stageOf(todo.id)).toBe("DOING");
  });

  it("a guest of the company cannot set it", async () => {
    const { board: b, todo } = await board();
    await loginAs(t.guest.id);
    const res = await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { stage: "DONE" } });
    expect([403, 404]).toContain(res.status);
    expect(await stageOf(todo.id)).toBe("DOING");
  });

  it("`done` keeps its meaning: the stage and the flag are independent in both directions", async () => {
    const { board: b, todo } = await board();
    await loginAs(t.admin.id);
    expect((await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { stage: "DONE" } })).status).toBe(200);
    expect((await db.boardColumn.findUniqueOrThrow({ where: { id: todo.id } })).done).toBe(false);
    expect((await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { stage: "TODO", done: true } })).status).toBe(200);
    expect((await db.boardColumn.findUniqueOrThrow({ where: { id: todo.id } })).done).toBe(true);
    expect(await stageOf(todo.id)).toBe("TODO");
    // the flag alone, set by a plain member, leaves the stage as it was
    await loginAs(t.member.id);
    expect((await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { done: false } })).status).toBe(200);
    expect(await stageOf(todo.id)).toBe("TODO");
  });

  it("adding a column: a member adds one with the default stage; a stage in the body is the manager's alone", async () => {
    const { board: b } = await board();
    await loginAs(t.member.id);
    const plain = await call(columnsRoute.POST, { params: { id: b.id }, body: { name: "عمود" } });
    expect(plain.status).toBe(201);
    expect((plain.json as { column: { id: string; stage: string } }).column.stage).toBe("DOING");
    const refused = await call(columnsRoute.POST, { params: { id: b.id }, body: { name: "عمود تاني", stage: "REVIEW" } });
    expect(refused.status).toBe(403);
    expect(await db.boardColumn.count({ where: { boardId: b.id, name: "عمود تاني" } })).toBe(0);
    await loginAs(t.admin.id);
    const ok = await call(columnsRoute.POST, { params: { id: b.id }, body: { name: "عمود تاني", stage: "REVIEW" } });
    expect(ok.status).toBe(201);
    expect(await stageOf((ok.json as { column: { id: string } }).column.id)).toBe("REVIEW");
  });

  it("GET lists the columns with their stage, says whether the switch is on and whether the viewer may choose", async () => {
    const { board: b, todo, done } = await board();
    await setStage(done.id, "DONE");
    await loginAs(t.member.id);
    const asMember = await call(columnsRoute.GET, { method: "GET", params: { id: b.id } });
    expect(asMember.status).toBe(200);
    const m = asMember.json as { columns: { id: string; stage: string; position: number }[]; stagesOn: boolean; canSetStage: boolean };
    expect(m.columns.map((c) => [c.id, c.stage])).toEqual([[todo.id, "DOING"], [done.id, "DONE"]]);
    expect(m.stagesOn).toBe(false); // the switch is OFF by default
    expect(m.canSetStage).toBe(false);
    await loginAs(t.admin.id);
    const asManager = await call(columnsRoute.GET, { method: "GET", params: { id: b.id } });
    expect((asManager.json as { canSetStage: boolean }).canSetStage).toBe(true);
  });

  it("the switch is the UI's: with it off a manager's PATCH still works (the column exists either way)", async () => {
    const { board: b, todo } = await board();
    await loginAs(t.admin.id);
    expect((await call(columnRoute.PATCH, { method: "PATCH", params: { id: b.id, columnId: todo.id }, body: { stage: "REVIEW" } })).status).toBe(200);
  });

  it("source: the board screen keeps its three page reloads (W1.5 replaces them) and gates the stage picker by the switch", () => {
    const src = readFileSync(path.join(process.cwd(), "src", "components", "board-view.tsx"), "utf8");
    expect((src.match(/window\.location\.reload\(\)/g) ?? []).length).toBe(3);
    expect(src).toContain("stagesOn");
    expect(existsSync(path.join(process.cwd(), "src", "lib", "work", "stage.ts"))).toBe(true);
  });
});
