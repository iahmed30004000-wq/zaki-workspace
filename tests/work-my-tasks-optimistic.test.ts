import { afterEach, describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { optimisticChange, restoreChange, workActionOptions } from "@/components/work/my-tasks/use-work-tasks";
import { DEFAULT_MY_TASKS_PARAMS, workTasksKey, type MyTasksParams, type WorkTaskDto, type WorkTasksResult } from "@/lib/work/my-tasks";

/**
 * W1.1 — optimistic complete / move / due date with restore on failure: the cached answers change the moment a person acts (every cached state of the screen:
 * the list and the board agree), the door is called, and a refusal puts the old answers back and tells the person. Run on a real TanStack client with the network
 * stubbed, no page needed.
 */

const task = (id: string, over: Partial<WorkTaskDto> = {}): WorkTaskDto => ({
  id,
  key: `ZK-${id}`,
  title: `task ${id}`,
  priority: "NORMAL",
  dueDate: null,
  dueDay: null,
  completedAt: null,
  columnId: "c",
  columnName: "todo",
  columnStage: "TODO",
  columnDone: false,
  workspaceId: "w",
  spaceName: "S",
  projectId: "p",
  projectName: "P",
  assigneeId: "u",
  assigneeName: "U",
  assigneeIds: ["u"],
  assigneeNames: ["U"],
  creatorId: "u",
  visibility: "SPACE",
  updatedAt: "2026-11-01T00:00:00.000Z",
  editable: true,
  ...over,
});

const answer = (params: MyTasksParams, tasks: WorkTaskDto[]): WorkTasksResult => ({
  params,
  tasks,
  truncated: false,
  counts: { today: 0, overdue: 0, week: 0, nodate: 0, done: 0, created: 0 },
  spaces: [],
  projects: [],
  current: { id: "w", hq: false },
  space: { id: "w", name: "ألفا" },
  scopeFellBack: false,
  timeZone: "Asia/Damascus",
  todayIso: "2026-11-20",
  month: null,
  canAdd: true,
});

const LIST = { ...DEFAULT_MY_TASKS_PARAMS };
const BOARD = { ...DEFAULT_MY_TASKS_PARAMS, view: "board" as const };

function seed() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const tasks = () => [task("a"), task("b", { columnStage: "DOING" })];
  qc.setQueryData(workTasksKey(LIST), answer(LIST, tasks()));
  qc.setQueryData(workTasksKey(BOARD), answer(BOARD, tasks()));
  return qc;
}
const rows = (qc: QueryClient, params: MyTasksParams) => qc.getQueryData<WorkTasksResult>(workTasksKey(params))!.tasks;

/** A door that answers when the test says so. */
function door() {
  let finish!: (res: { status: number; body: unknown }) => void;
  const pending = new Promise<{ status: number; body: unknown }>((resolve) => (finish = resolve));
  const fetchMock = vi.fn(async () => {
    const { status, body } = await pending;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, answer: finish };
}
afterEach(() => vi.unstubAllGlobals());

describe("ticking a task", () => {
  it("takes it off the open list and marks it done on the board at once, before the door answers; the door is the complete route", async () => {
    const qc = seed();
    const fail = vi.fn();
    const { fetchMock, answer: reply } = door();
    const run = new MutationObserver(qc, workActionOptions(qc, { timeZone: "Asia/Damascus", fail }).complete).mutate({ id: "a", done: true });
    await vi.waitFor(() => expect(rows(qc, LIST).map((t) => t.id)).toEqual(["b"]));
    // the board keeps every task and shows it finished
    expect(rows(qc, BOARD).find((t) => t.id === "a")?.completedAt).not.toBeNull();
    expect(rows(qc, BOARD).find((t) => t.id === "b")?.completedAt).toBeNull();
    reply({ status: 200, body: { task: {} } });
    await run;
    expect(fail).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks/a/complete");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ complete: true });
  });

  it("when the door refuses, the old answers come back everywhere and the person is told", async () => {
    const qc = seed();
    const before = JSON.stringify([rows(qc, LIST), rows(qc, BOARD)]);
    const fail = vi.fn();
    const { answer: reply } = door();
    const run = new MutationObserver(qc, workActionOptions(qc, { timeZone: "Asia/Damascus", fail }).complete).mutate({ id: "a", done: true });
    await vi.waitFor(() => expect(rows(qc, LIST).map((t) => t.id)).toEqual(["b"]));
    reply({ status: 403, body: { error: "forbidden", message: "task.not_found" } });
    await run.catch(() => undefined);
    expect(JSON.stringify([rows(qc, LIST), rows(qc, BOARD)])).toBe(before);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail.mock.calls[0]![1]).toBe("a");
    expect((fail.mock.calls[0]![0] as { code: string }).code).toBe("forbidden");
  });
});

describe("moving to a stage", () => {
  it("moves the card at once (only DONE finishes it), posts to the stage route, and a 422 «no column of that stage» puts it back", async () => {
    const qc = seed();
    const before = JSON.stringify(rows(qc, BOARD));
    const fail = vi.fn();
    const { fetchMock, answer: reply } = door();
    const run = new MutationObserver(qc, workActionOptions(qc, { timeZone: "Asia/Damascus", fail }).stage).mutate({ id: "a", to: "DONE" });
    await vi.waitFor(() => expect(rows(qc, BOARD).find((t) => t.id === "a")?.columnStage).toBe("DONE"));
    expect(rows(qc, BOARD).find((t) => t.id === "a")?.completedAt).not.toBeNull();
    expect(rows(qc, BOARD).find((t) => t.id === "b")?.columnStage).toBe("DOING");
    reply({ status: 422, body: { error: "validation.failed", message: "validation.failed", details: [{ path: "stage", message: "work.stage_missing" }] } });
    await run.catch(() => undefined);
    expect(JSON.stringify(rows(qc, BOARD))).toBe(before);
    expect(JSON.stringify((fail.mock.calls[0]![0] as { details: unknown }).details)).toContain("work.stage_missing");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/work/tasks/a/stage");
    expect(JSON.parse(init.body as string)).toEqual({ stage: "DONE" });
  });
});

describe("changing the due day", () => {
  it("shows the day at once (noon of the company's day), sends the day as picked, and a refusal restores the old day", async () => {
    const qc = seed();
    const before = JSON.stringify(rows(qc, LIST));
    const fail = vi.fn();
    const { fetchMock, answer: reply } = door();
    const run = new MutationObserver(qc, workActionOptions(qc, { timeZone: "Asia/Damascus", fail }).due).mutate({ id: "a", day: "2026-12-05" });
    await vi.waitFor(() => expect(rows(qc, LIST).find((t) => t.id === "a")?.dueDay).toBe("2026-12-05"));
    // noon in Damascus, not the browser's: the instant of the picked day in the COMPANY's zone
    expect(rows(qc, LIST).find((t) => t.id === "a")?.dueDate).toMatch(/^2026-12-05T/);
    reply({ status: 500, body: { error: "internal" } });
    await run.catch(() => undefined);
    expect(JSON.stringify(rows(qc, LIST))).toBe(before);
    expect(fail).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks/a");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ dueDate: "2026-12-05" });
  });

  it("clearing the day sends null and empties the cached day", async () => {
    const qc = seed();
    await optimisticChange(qc, (tasks) => tasks.map((t) => ({ ...t, dueDay: "2026-12-05", dueDate: "2026-12-05T09:00:00.000Z" })));
    const { answer: reply } = door();
    const run = new MutationObserver(qc, workActionOptions(qc, { timeZone: "Asia/Damascus", fail: vi.fn() }).due).mutate({ id: "a", day: null });
    await vi.waitFor(() => expect(rows(qc, LIST).find((t) => t.id === "a")?.dueDay).toBeNull());
    expect(rows(qc, LIST).find((t) => t.id === "a")?.dueDate).toBeNull();
    reply({ status: 200, body: {} });
    await run;
  });
});

describe("the snapshot", () => {
  it("restoreChange puts back exactly what optimisticChange found, in every cached state; an empty cache is untouched", async () => {
    const qc = seed();
    const before = JSON.stringify([rows(qc, LIST), rows(qc, BOARD)]);
    const previous = await optimisticChange(qc, (tasks) => tasks.slice(1));
    expect(rows(qc, LIST)).toHaveLength(1);
    expect(rows(qc, BOARD)).toHaveLength(1);
    restoreChange(qc, previous);
    expect(JSON.stringify([rows(qc, LIST), rows(qc, BOARD)])).toBe(before);
    restoreChange(qc, undefined);
    const empty = new QueryClient();
    expect(await optimisticChange(empty, (tasks) => tasks)).toEqual([]);
  });
});
