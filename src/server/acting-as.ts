import { AsyncLocalStorage } from "node:async_hooks";

/**
 * «يشتغل باسم»: the one door through which a machine caller (today only the MCP server, src/app/mcp/route.ts) borrows a person's identity for the length of ONE call.
 *
 * The routes of the app ask `requireUser()` who is asking; a token carries no cookie, so the MCP route authenticates the TOKEN first (src/server/services/api-door.ts:
 * its person must still be an active member who may manage integrations, in a space they reach) and only then runs the existing handlers inside `runAsUser(person, …)`.
 * Inside, `currentUser()` answers that person, and every rule the routes and services already hold (ranks, spaces, teams, private tasks, «يضيف ويعدّل») applies to the
 * token exactly as it applies to the person. Nothing here widens anything; it only lets the existing checks see who is asking.
 *
 * ⚠️ Only the files named in tests/mcp-acting-as.test.ts may import this module.
 */
const store = new AsyncLocalStorage<{ userId: string }>();

/** The person the current call acts for, or null (an ordinary request: the cookie decides). */
export function actingUserId(): string | null {
  return store.getStore()?.userId ?? null;
}

export function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ userId }, fn);
}
