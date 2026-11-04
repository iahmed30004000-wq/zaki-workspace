import { createHash } from "node:crypto";
import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { LocalQueue } from "@/server/ai/local-queue";
import { callLocal, jsonOf, type LocalTransport } from "@/server/ai/local-transport";
import { AiProviderError } from "@/server/ai/provider";
import { redactChatText } from "@/server/ai/redact-chat";
import { isFeatureOn } from "@/server/services/features";

/**
 * «بحث بالمعنى» — the connector and the pure rules. No database here.
 *
 *   WHERE   `EMBED_URL` (an origin such as `http://embed:8080` or `https://embeddings.example.com`) in the server's environment, judged by the
 *           same allow-list as the gateway and the transcript service (src/server/ai/local-host.ts): his own machine or private network, or an
 *           https PUBLIC NAME whose address is checked again on every connection. `EMBED_MODEL` (required, e.g. `bge-m3`), `EMBED_API_KEY`
 *           (optional, sent only as `Authorization: Bearer …` to that address; read from the environment here and nowhere else, never stored,
 *           logged, returned or put in an error). The service speaks the OpenAI shape: POST `/v1/embeddings`, `{ model, input: string[] }`,
 *           the answer `{ data: [{ index, embedding: number[] }] }`. Missing or refused address, or no model: there is no service and the
 *           search stays the ordinary word search.
 *   SWITCH  `semanticSearch`, off by default (text of messages and tasks leaves the app for that service, after the chat filter).
 *   TEXT    everything that leaves goes through `redactChatText` (phones, e-mails, links, handles, secrets and addresses masked) and is cut.
 *           Only the vector comes back and it stays on the server: no route ever returns one.
 *
 * ⚠️ A name or a word the filter cannot recognise still reaches that service. 🔧 The switch is off until the owner turns it on, and a service on
 * his own machine keeps everything inside.
 */

export const EMBED_PATH = "/v1/embeddings";
/** A message or a task is cut to this many characters BEFORE it is embedded (the filter runs first, then the cut). */
export const EMBED_TEXT_CHARS = 600;
/** The question is cut to this many characters (then filtered). */
export const QUERY_CHARS = 300;
/** A message shorter than this (trimmed) is not indexed: «تمام» and «شكرا» mean nothing apart. */
export const MIN_MESSAGE_CHARS = 12;
export const MIN_TASK_CHARS = 4;
/** Texts per request, and the longest vector kept (a vector longer than this is refused, not cut: cutting changes the meaning). */
export const EMBED_BATCH = 16;
export const MAX_DIMENSIONS = 4096;
export const EMBED_TIMEOUT_MS = 30_000;
export const QUERY_TIMEOUT_MS = 6_000;
/** The similarity below which nothing is shown, and how far under the best hit another may sit (a model-independent noise cut). */
export const DEFAULT_MIN_SCORE = 0.55;
export const SCORE_BAND = 0.15;

export interface EmbedServer {
  /** `http://embed:8080`: already judged. */
  origin: string;
  model: string;
  /** The address is an outside https name (its socket accepts public addresses only). */
  external: boolean;
  /** The lowest similarity shown. */
  minScore: number;
  /** The Authorization header, or null. A function, so serialising the object (a log line, a JSON answer) can never print the key. */
  auth: () => Record<string, string>;
}

/** The embeddings service of this installation, or null while it has none (the switch card then says «الخدمة مش جاهزة»). */
export function embedServer(source: Readonly<Record<string, string | undefined>> = process.env): EmbedServer | null {
  const url = (source["EMBED_URL"] ?? "").trim().replace(/\/+$/, "");
  if (!url) return null;
  const parsed = parseLocalBaseUrl(url, { external: true });
  if (!parsed.ok) return null;
  const model = (source["EMBED_MODEL"] ?? "").trim();
  if (!/^[\w./:-]{1,120}$/.test(model)) return null;
  const rawScore = (source["EMBED_MIN_SCORE"] ?? "").trim();
  const score = rawScore === "" ? DEFAULT_MIN_SCORE : Number(rawScore);
  const minScore = Number.isFinite(score) && score >= 0.2 && score <= 0.95 ? score : DEFAULT_MIN_SCORE;
  const key = (source["EMBED_API_KEY"] ?? "").trim();
  return {
    origin: parsed.target.origin,
    model,
    external: parsed.target.external === true,
    minScore,
    auth: (): Record<string, string> => (key ? { authorization: `Bearer ${key}` } : {}),
  };
}

/** Is the search by meaning to run for this company: the switch is on AND a service is set up. */
export async function semanticAvailable(orgId: string, source: Readonly<Record<string, string | undefined>> = process.env): Promise<boolean> {
  return embedServer(source) !== null && (await isFeatureOn(orgId, "semanticSearch"));
}

// ───────────────────────────────────────── the text that leaves ─────────────────────────────────────────

/** The text of a chat message as it may leave: filtered, then cut. null: not worth indexing (too short, or nothing left). */
export function messageText(body: string): string | null {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length < MIN_MESSAGE_CHARS) return null;
  return filtered(flat);
}

/** The text of a task as it may leave (title, then description): filtered, then cut. */
export function taskText(title: string, description: string | null): string | null {
  const flat = `${title}\n${description ?? ""}`.replace(/\s+/g, " ").trim();
  if (flat.length < MIN_TASK_CHARS) return null;
  return filtered(flat);
}

/** What was typed in the search box as it may leave. */
export function queryText(q: string): string | null {
  const flat = q.replace(/\s+/g, " ").trim().slice(0, QUERY_CHARS);
  return flat.length < 3 ? null : filtered(flat);
}

function filtered(flat: string): string | null {
  const clean = redactChatText(flat).text.trim().slice(0, EMBED_TEXT_CHARS).trim();
  return clean.length === 0 ? null : clean;
}

/** Tells a changed text from an unchanged one without keeping the text. The model is part of it: a new model re-makes every vector. */
export function textHash(text: string, model: string): string {
  return createHash("sha256").update(`${model}\n${text}`).digest("hex");
}

// ───────────────────────────────────────── the numbers ─────────────────────────────────────────

/** The vector scaled to length 1 (so cosine is a plain dot product), or null for a vector that is empty, has a non-number or is all zeros. */
export function normalize(vector: readonly number[]): number[] | null {
  if (vector.length === 0 || vector.length > MAX_DIMENSIONS) return null;
  let sum = 0;
  for (const x of vector) {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    sum += x * x;
  }
  if (sum === 0) return null;
  const length = Math.sqrt(sum);
  return vector.map((x) => x / length);
}

/** Cosine similarity of two vectors of the same length; 0 for any pair that cannot be compared (a different length, a zero vector). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface Candidate {
  id: string;
  vector: readonly number[];
}
export interface Scored {
  id: string;
  score: number;
}

/**
 * The candidates most like the question, best first. Nothing below `minScore`, nothing more than `SCORE_BAND` under the best one (so a
 * question with one real answer does not drag a tail of near-misses behind it), at most `limit`. Ties break by id (stable).
 */
export function rankBySimilarity(query: readonly number[], candidates: readonly Candidate[], options: { minScore: number; limit: number }): Scored[] {
  const scored: Scored[] = [];
  for (const c of candidates) {
    const score = cosine(query, c.vector);
    if (score >= options.minScore) scored.push({ id: c.id, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const best = scored[0]?.score ?? 0;
  return scored.filter((s) => s.score >= best - SCORE_BAND).slice(0, options.limit);
}

/** The lexical hits first, in their order; then the semantic ones the words did not already find, up to `cap` in all and `extra` of them. */
export function mergeHits<T extends { id: string }, S extends { id: string }>(
  lexical: readonly T[],
  semantic: readonly S[],
  options: { cap: number; extra: number },
): { hit: T | S; semantic: boolean }[] {
  const out: { hit: T | S; semantic: boolean }[] = lexical.map((hit) => ({ hit, semantic: false }));
  const seen = new Set(lexical.map((h) => h.id));
  let added = 0;
  for (const hit of semantic) {
    if (out.length >= Math.max(options.cap, lexical.length) || added >= options.extra) break;
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push({ hit, semantic: true });
    added += 1;
  }
  return out;
}

// ───────────────────────────────────────── the call ─────────────────────────────────────────

export class EmbedError extends Error {
  constructor(readonly key: string) {
    super(key);
    this.name = "EmbedError";
  }
}

/** Tests: a fake of the whole service (deterministic vectors), in place of the network. */
export type EmbedFunction = (texts: string[], server: EmbedServer) => Promise<number[][]>;
let injected: EmbedFunction | null = null;
export function setEmbedderForTests(fn: EmbedFunction | null): void {
  injected = fn;
}

/** Indexing waits in line (and is told «busy» past a long line: the next job tick picks the rest up); a question has a short line of its own. */
const indexQueue = new LocalQueue(200, 120_000);
const queryQueue = new LocalQueue(4, 3_000);

const failureKey = (err: unknown): string => {
  if (!(err instanceof AiProviderError)) return "search.embed_failed";
  if (err.key === "assistant.err_local_timeout") return "search.embed_timeout";
  if (err.key === "assistant.err_local_busy") return "search.embed_busy";
  if (err.key === "assistant.err_local_down" || err.key === "assistant.err_local_host") return "search.embed_down";
  return "search.embed_failed";
};

/**
 * Texts to vectors (unit length), in the order given, in batches. Everything is bounded: the batch, the time, the size of a vector.
 * A failure is a dictionary key, never the service's answer, the address or the texts.
 */
export async function embedTexts(
  server: EmbedServer,
  texts: readonly string[],
  options: { transport?: LocalTransport; purpose?: "index" | "query" } = {},
): Promise<number[][]> {
  const out: number[][] = [];
  const query = options.purpose === "query";
  for (let at = 0; at < texts.length; at += EMBED_BATCH) {
    const batch = texts.slice(at, at + EMBED_BATCH);
    let raw: number[][];
    try {
      if (injected) raw = await injected([...batch], server);
      else {
        const parsed = parseLocalBaseUrl(server.origin, { external: server.external });
        if (!parsed.ok) throw new EmbedError("search.embed_down");
        const target = parsed.target;
        const run = () =>
          callLocal({
            target,
            method: "POST",
            path: EMBED_PATH,
            headers: server.auth(),
            body: { model: server.model, input: batch },
            timeoutMs: query ? QUERY_TIMEOUT_MS : EMBED_TIMEOUT_MS,
            ...(options.transport ? { transport: options.transport } : {}),
          });
        const res = await (query ? queryQueue : indexQueue).run(run);
        raw = vectorsOf(jsonOf(res), batch.length);
      }
    } catch (err) {
      if (err instanceof EmbedError) throw err;
      throw new EmbedError(failureKey(err));
    }
    if (raw.length !== batch.length) throw new EmbedError("search.embed_failed");
    for (const v of raw) {
      const unit = normalize(v);
      if (!unit) throw new EmbedError("search.embed_failed");
      out.push(unit);
    }
  }
  return out;
}

/** `{ data: [{ index, embedding }] }` in the order of the request. Anything else is a failure. */
function vectorsOf(json: unknown, expected: number): number[][] {
  const data = json && typeof json === "object" ? (json as { data?: unknown }).data : null;
  if (!Array.isArray(data) || data.length !== expected) throw new EmbedError("search.embed_failed");
  const rows = data.map((row, i) => {
    const r = row as { index?: unknown; embedding?: unknown };
    if (!Array.isArray(r.embedding)) throw new EmbedError("search.embed_failed");
    return { index: typeof r.index === "number" ? r.index : i, embedding: r.embedding as number[] };
  });
  rows.sort((a, b) => a.index - b.index);
  return rows.map((r) => r.embedding);
}
