import { db } from "@/server/db";
import { accessibleWorkspaceIds } from "@/server/services/access";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as moveRoute from "@/app/api/tasks/[id]/move/route";
import * as commentsRoute from "@/app/api/tasks/[id]/comments/route";
import * as boardRoute from "@/app/api/boards/[id]/route";
import * as chatListRoute from "@/app/api/chat/list/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { MCP_TOOL_DEFS } from "./defs";
import { McpToolError, type McpContext, type McpTool } from "./rpc";

/**
 * «خادم MCP»: what each of the eight tools does. NOTHING of the app's business is repeated here: a tool builds the request the browser would have sent and hands it to the
 * SAME route handler (`/api/tasks`, `/api/tasks/:id`, `…/move`, `…/comments`, `/api/boards/:id`, `/api/chat/list`, `/api/chat/conversations/:id/messages`), which runs
 * inside the token's person (set by the route of /mcp after the token passed the door). So the ranks, the spaces, the teams, the private tasks and
 * «من يقدر يكتب في الموضوع» are decided by the code that already decides them, and every audit row of those routes is written under that person.
 * Only what the routes do not offer is read here, read-only and AFTER the route let the person in (the column names of a task list, the `stage` of a column).
 */
type Handler = (req: Request, ctx: { params: { id: string } }) => Promise<Response>;

interface Call {
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  id?: string;
}

async function invoke(handler: unknown, call: Call): Promise<Record<string, unknown>> {
  const url = new URL(`http://mcp.internal${call.path}`);
  for (const [k, v] of Object.entries(call.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
  const req = new Request(url, {
    method: call.method,
    headers: { "content-type": "application/json" },
    ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
  });
  const res = await (handler as Handler)(req, { params: { id: call.id ?? "" } });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = typeof json?.["error"] === "string" ? (json["error"] as string) : `http_${res.status}`;
    const message = typeof json?.["message"] === "string" ? (json["message"] as string) : code;
    throw new McpToolError(code, message, json?.["details"]);
  }
  return json ?? {};
}

const NAMES = { assignee: (a: unknown) => (a && typeof a === "object" ? { id: (a as { id: string }).id, name: (a as { name: string }).name } : null) };

interface TaskRow {
  id: string;
  number: number;
  title: string;
  columnId: string;
  assignee: unknown;
  dueDate: string | null;
}

async function workspacesFor(userId: string, a: { projectId?: string; boardId?: string }): Promise<string[]> {
  if (a.boardId) {
    const board = await db.board.findUnique({ where: { id: a.boardId }, select: { project: { select: { workspaceId: true } } } });
    if (!board) throw new McpToolError("not_found", "board.not_found");
    return [board.project.workspaceId];
  }
  if (a.projectId) {
    const project = await db.project.findUnique({ where: { id: a.projectId }, select: { workspaceId: true } });
    if (!project) throw new McpToolError("not_found", "project.not_found");
    return [project.workspaceId];
  }
  return (await accessibleWorkspaceIds(userId)).slice(0, 25);
}

async function listTasks(ctx: McpContext, a: { projectId?: string; boardId?: string; columnId?: string; query?: string }) {
  const spaces = await workspacesFor(ctx.userId, a);
  const words = a.query?.toLocaleLowerCase();
  const rows: TaskRow[] = [];
  for (const workspaceId of spaces) {
    let answer: Record<string, unknown>;
    try {
      answer = await invoke(tasksRoute.GET, { method: "GET", path: "/api/tasks", query: { workspaceId, projectId: a.projectId, boardId: a.boardId, limit: "100" } });
    } catch (err) {
      // a space this person cannot open (the list across all spaces) is skipped; one they NAMED is an error
      if (spaces.length > 1 && err instanceof McpToolError) continue;
      throw err;
    }
    for (const t of (answer["tasks"] as TaskRow[] | undefined) ?? []) {
      if (a.columnId && t.columnId !== a.columnId) continue;
      if (words && !t.title.toLocaleLowerCase().includes(words)) continue;
      rows.push(t);
    }
  }
  const shown = rows.slice(0, 100);
  // the names of the columns: read only for the ids the route just handed over
  const columns = await db.boardColumn.findMany({ where: { id: { in: [...new Set(shown.map((t) => t.columnId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(columns.map((c) => [c.id, c.name]));
  return {
    tasks: shown.map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      column: { id: t.columnId, name: nameOf.get(t.columnId) ?? null },
      assignee: NAMES.assignee(t.assignee),
      dueDate: t.dueDate ?? null,
    })),
    truncated: rows.length > shown.length,
  };
}

async function createTask(_ctx: McpContext, a: { projectId: string; boardId: string; columnId: string; title: string; description?: string; assigneeId?: string; dueDate?: string }) {
  const project = await db.project.findUnique({ where: { id: a.projectId }, select: { workspaceId: true } });
  if (!project) throw new McpToolError("not_found", "project.not_found");
  // the route would quietly put a task of an unknown column into the board's first one: a caller that NAMED a column must get that column or an error
  const column = await db.boardColumn.findFirst({ where: { id: a.columnId, boardId: a.boardId, board: { projectId: a.projectId } }, select: { id: true } });
  if (!column) throw new McpToolError("not_found", "column.not_found");
  const out = await invoke(tasksRoute.POST, {
    method: "POST",
    path: "/api/tasks",
    body: { workspaceId: project.workspaceId, projectId: a.projectId, boardId: a.boardId, columnId: a.columnId, title: a.title, description: a.description, assigneeId: a.assigneeId, dueDate: a.dueDate },
  });
  const t = out["task"] as { id: string; number: number; title: string; columnId: string };
  return { id: t.id, number: t.number, title: t.title, columnId: t.columnId };
}

async function moveTask(_ctx: McpContext, a: { taskId: string; columnId: string }) {
  const out = await invoke(moveRoute.POST, { method: "POST", path: `/api/tasks/${encodeURIComponent(a.taskId)}/move`, id: a.taskId, body: { columnId: a.columnId } });
  const t = out["task"] as { id: string; number: number; title: string; columnId: string };
  return { id: t.id, number: t.number, title: t.title, columnId: t.columnId };
}

async function commentTask(_ctx: McpContext, a: { taskId: string; body: string }) {
  const out = await invoke(commentsRoute.POST, { method: "POST", path: `/api/tasks/${encodeURIComponent(a.taskId)}/comments`, id: a.taskId, body: { body: a.body } });
  const c = (out["comment"] ?? out) as { id?: string };
  return { id: c.id ?? null, taskId: a.taskId };
}

async function updateTask(_ctx: McpContext, a: { taskId: string; title?: string; description?: string | null; assigneeId?: string | null; dueDate?: string | null; archived?: boolean }) {
  const { taskId, ...changes } = a;
  if (Object.keys(changes).length === 0) throw new McpToolError("validation.failed", "Send at least one field to change.");
  const out = await invoke(taskRoute.PATCH, { method: "PATCH", path: `/api/tasks/${encodeURIComponent(taskId)}`, id: taskId, body: changes });
  const t = out["task"] as { id: string; number: number; title: string; columnId: string; archived: boolean };
  return { id: t.id, number: t.number, title: t.title, columnId: t.columnId, archived: t.archived };
}

async function postMessage(_ctx: McpContext, a: { conversationId: string; body: string }) {
  const out = await invoke(messagesRoute.POST, { method: "POST", path: `/api/chat/conversations/${encodeURIComponent(a.conversationId)}/messages`, id: a.conversationId, body: { body: a.body } });
  const m = out as { id?: string; createdAt?: string };
  return { id: m.id ?? null, conversationId: a.conversationId, createdAt: m.createdAt ?? null };
}

async function listConversations(_ctx: McpContext, a: { workspaceId: string }) {
  const out = await invoke(chatListRoute.GET, { method: "GET", path: "/api/chat/list", query: { spaceId: a.workspaceId } });
  const rows = (out["rows"] as { id: string; title: string; kind: string }[] | undefined) ?? [];
  return { conversations: rows.map((r) => ({ id: r.id, title: r.title, kind: r.kind })) };
}

async function getBoard(_ctx: McpContext, a: { boardId: string }) {
  // the route lets the person in (or answers 404/403); the stage is read for the same columns afterwards
  const out = await invoke(boardRoute.GET, { method: "GET", path: `/api/boards/${encodeURIComponent(a.boardId)}`, id: a.boardId });
  const columns = (out["columns"] as { id: string; name: string }[] | undefined) ?? [];
  const stages = await db.boardColumn.findMany({ where: { boardId: a.boardId }, select: { id: true, stage: true } });
  const stageOf = new Map(stages.map((c) => [c.id, c.stage]));
  return { board: out["board"], columns: columns.map((c) => ({ id: c.id, name: c.name, stage: stageOf.get(c.id) ?? null })) };
}

const RUN: Record<string, McpTool["run"]> = {
  list_tasks: listTasks as McpTool["run"],
  create_task: createTask as McpTool["run"],
  move_task: moveTask as McpTool["run"],
  comment_task: commentTask as McpTool["run"],
  update_task: updateTask as McpTool["run"],
  post_message: postMessage as McpTool["run"],
  list_conversations: listConversations as McpTool["run"],
  get_board: getBoard as McpTool["run"],
};

export const MCP_TOOLS: readonly McpTool[] = MCP_TOOL_DEFS.map((def) => ({ ...def, run: RUN[def.name] as McpTool["run"] }));
