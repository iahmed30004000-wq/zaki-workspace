import type { QueryClient } from "@tanstack/react-query";

/**
 * C1.5 — who is signed in, and is the person an external partner. The device copy is named after the person (`zaki-chat-<userId>`)
 * and is never written for a guest, so both must be known BEFORE anything is stored.
 *
 *  - The id: `GET /api/me` (an existing route). 401 means nobody is signed in (the driver wipes the device on the sign-in page);
 *    anything else that is not an answer means «unknown», and unknown never writes and never wipes.
 *  - External: the role in the person's company (the one the chat endpoints serve: the OLDEST active membership, `requireActor`, which is
 *    `organizations[0]` of the answer), from `/api/workspaces` through the SAME query the shell uses (`fetchSpaces`,
 *    key `["orgs"]`), so it is one request shared with the shell, not a second one. A guest (role GUEST = `actor.isExternal`) keeps
 *    nothing on the device. Unknown (the request failed, no membership) again writes nothing: the rule fails closed.
 */
export type MeResult = { status: "ok"; userId: string } | { status: "signed_out" } | { status: "unknown" };

export async function fetchMe(): Promise<MeResult> {
  try {
    const res = await fetch("/api/me", { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
    if (res.status === 401) return { status: "signed_out" };
    if (!res.ok) return { status: "unknown" };
    const body = (await res.json().catch(() => null)) as { user?: { id?: unknown } } | null;
    const id = body?.user?.id;
    return typeof id === "string" && id ? { status: "ok", userId: id } : { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

/** true: an external partner · false: staff · null: not known (nothing is kept then). */
export async function fetchIsExternal(qc: QueryClient): Promise<boolean | null> {
  try {
    // loaded on demand: the sign-in page must not carry the space switcher
    const { fetchSpaces, ORGS_QUERY_KEY } = await import("@/components/shell/space-switcher");
    const orgs = await qc.fetchQuery({ queryKey: ORGS_QUERY_KEY, queryFn: fetchSpaces, staleTime: 60_000 });
    const role = orgs.organizations[0]?.role;
    if (typeof role !== "string" || !role) return null;
    return role === "GUEST";
  } catch {
    return null;
  }
}
