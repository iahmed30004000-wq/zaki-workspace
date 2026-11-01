import { createHash } from "node:crypto";

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  bytes?: Uint8Array;
  trashed?: boolean;
}

/** An in-memory Drive answering the few requests the store makes, and recording them. */
export function fakeDrive() {
  const files = new Map<string, FakeFile>();
  const sessions = new Map<string, FakeFile>();
  const calls: Array<{ method: string; url: string; auth: string | null; range: string | null }> = [];
  const state = { failUploads: false, staleToken: null as string | null, n: 0 };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  async function handle(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const auth = headers.get("authorization");
    calls.push({ method, url: url.toString(), auth, range: headers.get("range") });

    if (url.host === "oauth2.googleapis.com") return json({ access_token: "fresh-token" });
    if (url.host === "upload.fake") {
      const pending = sessions.get(url.pathname);
      if (!pending || method !== "PUT") return json({}, 404);
      const bytes = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
      const file = { ...pending, bytes };
      files.set(file.id, file);
      return json({ id: file.id, size: String(bytes.length), md5Checksum: createHash("md5").update(bytes).digest("hex") });
    }
    if (!auth?.startsWith("Bearer ")) return json({}, 401);
    if (state.staleToken && auth === `Bearer ${state.staleToken}`) return json({}, 401);

    const path = url.pathname;
    if (path === "/drive/v3/files" && method === "GET") {
      const tag = /value='([^']+)'/.exec(url.searchParams.get("q") ?? "")?.[1];
      const hit = [...files.values()].filter((f) => !f.trashed && f.appProperties["zaki"] === tag);
      return json({ files: hit.map((f) => ({ id: f.id })) });
    }
    if (path === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(String(init.body)) as Partial<FakeFile>;
      const id = `folder-${++state.n}`;
      files.set(id, { id, name: meta.name ?? "", mimeType: meta.mimeType ?? "", parents: meta.parents ?? [], appProperties: meta.appProperties ?? {} });
      return json({ id });
    }
    if (path === "/upload/drive/v3/files" && method === "POST") {
      if (state.failUploads) return json({ error: "backendError" }, 503);
      const meta = JSON.parse(String(init.body)) as Partial<FakeFile>;
      const session = `/session/${++state.n}`;
      sessions.set(session, { id: `file-${state.n}`, name: meta.name ?? "", mimeType: headers.get("x-upload-content-type") ?? "", parents: meta.parents ?? [], appProperties: meta.appProperties ?? {} });
      return json({}, 200, { location: `https://upload.fake${session}` });
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    const file = one ? files.get(decodeURIComponent(one[1]!)) : undefined;
    if (one && !file) return json({}, 404);
    if (file && method === "GET" && url.searchParams.get("alt") === "media") {
      const bytes = file.bytes ?? new Uint8Array();
      const m = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") ?? "");
      if (!m) return new Response(new Uint8Array(bytes), { status: 200 });
      return new Response(new Uint8Array(bytes.subarray(Number(m[1]), Number(m[2]) + 1)), { status: 206 });
    }
    if (file && method === "PATCH") {
      const add = url.searchParams.get("addParents");
      const remove = url.searchParams.get("removeParents");
      if (add) file.parents = [...file.parents.filter((p) => p !== remove), add];
      const body = JSON.parse(String(init.body ?? "{}")) as { trashed?: boolean };
      if (body.trashed) file.trashed = true;
      return json({ id: file.id });
    }
    return json({ error: "unexpected" }, 400);
  }

  const byName = (name: string) => [...files.values()].find((f) => f.name === name);
  return { files, calls, state, handle, byName };
}
