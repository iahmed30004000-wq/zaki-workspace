import type { DoorPermission } from "@/server/door/tokens";

/**
 * The systems that may hold a token of the door (W1, «الإعدادات ← توكنات الأنظمة»). Each system has a fixed name and fixed scopes: the owner picks the
 * system, never the scopes, so a token made here can never be wider than what its system's contract needs.
 *
 * «الميديا باير» (contract `workspace-mediabuyer.v1`, repository zaki-mediabuyer): creates a person's open task and reads its status. Nothing else.
 */
export interface DoorSystem {
  key: string;
  /** shown on the page, and kept as the token's name */
  name: string;
  permissions: readonly DoorPermission[];
}

export const DOOR_SYSTEMS: readonly DoorSystem[] = [
  { key: "mediabuyer", name: "الميديا باير", permissions: ["tasks.write", "tasks.read"] },
  // the MCP server (docs/contracts/mcp.md): Claude logs the scheduled operations as tasks, comments and chat messages, in the name of whoever made the token
  { key: "claude-mcp", name: "Claude (MCP)", permissions: ["mcp.tasks", "mcp.chat"] },
  // «ميوز»: builds the structure of the chat (groups of topics) by the API alone; reads and writes no message (docs/contracts/chat-groups.md)
  { key: "muse", name: "ميوز", permissions: ["chat.structure"] },
];

export const DEFAULT_SYSTEM_EXPIRY_DAYS = 90;

/** An own-key lookup: «constructor» and «__proto__» are no system. */
export function doorSystem(key: unknown): DoorSystem | null {
  return typeof key === "string" ? (DOOR_SYSTEMS.find((s) => s.key === key) ?? null) : null;
}
