import { z, type ZodTypeAny } from "zod";

/**
 * «خادم MCP» — the eight tools of docs/contracts/mcp.md: their names, what the model reads about them, the arguments they accept (as JSON Schema for the client and as
 * zod for the check) and the scope of the token each one needs. Pure: no database here, so the protocol tests can use it as it is.
 */
export type McpScope = "mcp.tasks" | "mcp.chat";

export interface McpToolDef {
  name: string;
  description: string;
  scope: McpScope;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  schema: ZodTypeAny;
}

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().trim().min(1).max(max);
const day = z.string().trim().min(8).max(40);

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });

export const MCP_TOOL_DEFS: readonly McpToolDef[] = [
  {
    name: "list_tasks",
    scope: "mcp.tasks",
    description:
      "List tasks the token's person can see. Narrow by projectId, boardId, columnId, or a words query on the title. With none of them it looks in every space the person is in (newest first, at most 100). Returns id, number, title, column, assignee and dueDate.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: str("Only tasks of this project."),
        boardId: str("Only tasks of this board."),
        columnId: str("Only tasks in this column."),
        query: str("Words that must appear in the title (case-insensitive)."),
      },
      additionalProperties: false,
    },
    schema: z.object({ projectId: id.optional(), boardId: id.optional(), columnId: id.optional(), query: text(200).optional() }).strict(),
  },
  {
    name: "create_task",
    scope: "mcp.tasks",
    description: "Create a task in a column of a board. The person must be allowed to add tasks in that space. dueDate is a day (2026-11-30) or a full ISO time. Arabic text is kept as it is.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: str("The project the board belongs to."),
        boardId: str("The board."),
        columnId: str("The column the task starts in."),
        title: str("The task's title.", { maxLength: 280 }),
        description: str("Longer text, optional.", { maxLength: 10000 }),
        assigneeId: str("User id of who holds it, optional."),
        dueDate: str("Due day (YYYY-MM-DD) or ISO time, optional."),
      },
      required: ["projectId", "boardId", "columnId", "title"],
      additionalProperties: false,
    },
    schema: z
      .object({ projectId: id, boardId: id, columnId: id, title: text(280), description: z.string().max(10_000).optional(), assigneeId: id.optional(), dueDate: day.optional() })
      .strict(),
  },
  {
    name: "move_task",
    scope: "mcp.tasks",
    description: "Move a task to another column of its board (this finishes it when the column is a done column).",
    inputSchema: {
      type: "object",
      properties: { taskId: str("The task."), columnId: str("The destination column.") },
      required: ["taskId", "columnId"],
      additionalProperties: false,
    },
    schema: z.object({ taskId: id, columnId: id }).strict(),
  },
  {
    name: "comment_task",
    scope: "mcp.tasks",
    description: "Add a comment to a task, in the token's person's name.",
    inputSchema: {
      type: "object",
      properties: { taskId: str("The task."), body: str("The comment.", { maxLength: 10000 }) },
      required: ["taskId", "body"],
      additionalProperties: false,
    },
    schema: z.object({ taskId: id, body: text(10_000) }).strict(),
  },
  {
    name: "update_task",
    scope: "mcp.tasks",
    description: "Change a task: title, description, assigneeId (null takes it off), dueDate (null removes it) or archived. Send only what changes.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: str("The task."),
        title: str("New title.", { maxLength: 280 }),
        description: { type: ["string", "null"], description: "New description, or null to clear it." },
        assigneeId: { type: ["string", "null"], description: "User id, or null to take it off." },
        dueDate: { type: ["string", "null"], description: "Day (YYYY-MM-DD) or ISO time, or null to remove it." },
        archived: { type: "boolean", description: "true archives the task, false brings it back." },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    schema: z
      .object({ taskId: id, title: text(280).optional(), description: z.string().max(10_000).nullable().optional(), assigneeId: id.nullable().optional(), dueDate: day.nullable().optional(), archived: z.boolean().optional() })
      .strict(),
  },
  {
    name: "post_message",
    scope: "mcp.chat",
    description: "Post a message in a chat topic or conversation. It works only where the token's person is allowed to post.",
    inputSchema: {
      type: "object",
      properties: { conversationId: str("The conversation or topic."), body: str("The message text.", { maxLength: 8000 }) },
      required: ["conversationId", "body"],
      additionalProperties: false,
    },
    schema: z.object({ conversationId: id, body: text(8000) }).strict(),
  },
  {
    name: "list_conversations",
    scope: "mcp.chat",
    description: "List the topics and conversations of one space the token's person can see: id, title and kind.",
    inputSchema: { type: "object", properties: { workspaceId: str("The space.") }, required: ["workspaceId"], additionalProperties: false },
    schema: z.object({ workspaceId: id }).strict(),
  },
  {
    name: "get_board",
    scope: "mcp.tasks",
    description: "Read a board's columns: id, name and stage (TODO, DOING, REVIEW or DONE).",
    inputSchema: { type: "object", properties: { boardId: str("The board.") }, required: ["boardId"], additionalProperties: false },
    schema: z.object({ boardId: id }).strict(),
  },
];

/** The scope a tool needs, or null for a name that is no tool. */
export function scopeOfTool(name: string): McpScope | null {
  return MCP_TOOL_DEFS.find((d) => d.name === name)?.scope ?? null;
}

export const MCP_SCOPES: readonly McpScope[] = ["mcp.tasks", "mcp.chat"];
