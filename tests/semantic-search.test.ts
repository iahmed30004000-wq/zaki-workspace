import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AR } from "@/lib/i18n/dict";
import { ECONOMY_FORCED_OFF, FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import type { LocalHttpRequest, LocalTransport } from "@/server/ai/local-transport";
import {
  cosine,
  DEFAULT_MIN_SCORE,
  EMBED_TEXT_CHARS,
  embedServer,
  embedTexts,
  EmbedError,
  mergeHits,
  messageText,
  normalize,
  queryText,
  rankBySimilarity,
  SCORE_BAND,
  taskText,
  textHash,
} from "@/server/services/search-embeddings";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SERVER = embedServer({ EMBED_URL: "http://embed:8080", EMBED_MODEL: "bge-m3", EMBED_API_KEY: "sk-secret-key-123" })!;

function fake(answer: { status: number; text: string } | Error) {
  const seen: LocalHttpRequest[] = [];
  const transport: LocalTransport = async (request) => {
    seen.push(request);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { seen, transport };
}

describe("«بحث بالمعنى»: where the service lives", () => {
  it("needs an address AND a model; a refused address, a path or a bad model means no service", () => {
    expect(embedServer({})).toBeNull();
    expect(embedServer({ EMBED_URL: "http://embed:8080" })).toBeNull();
    expect(embedServer({ EMBED_MODEL: "bge-m3" })).toBeNull();
    expect(embedServer({ EMBED_URL: "http://8.8.8.8:8080", EMBED_MODEL: "m" })).toBeNull();
    expect(embedServer({ EMBED_URL: "http://169.254.169.254", EMBED_MODEL: "m" })).toBeNull();
    expect(embedServer({ EMBED_URL: "http://embed:8080/v1/embeddings", EMBED_MODEL: "m" })).toBeNull();
    expect(embedServer({ EMBED_URL: "http://embed:8080", EMBED_MODEL: "a b; rm" })).toBeNull();
    expect(embedServer({ EMBED_URL: "http://embed:8080", EMBED_MODEL: "bge-m3" })).toMatchObject({ origin: "http://embed:8080", model: "bge-m3", external: false, minScore: DEFAULT_MIN_SCORE });
  });

  it("an https public name is accepted (and marked outside), a plain http public name is not", () => {
    expect(embedServer({ EMBED_URL: "https://embeddings.example.com/v1", EMBED_MODEL: "m" })).toMatchObject({ origin: "https://embeddings.example.com", external: true });
    expect(embedServer({ EMBED_URL: "http://embeddings.example.com", EMBED_MODEL: "m" })).toBeNull();
  });

  it("the lowest score is bounded and nonsense falls back to the default", () => {
    const base = { EMBED_URL: "http://embed:8080", EMBED_MODEL: "m" };
    expect(embedServer({ ...base, EMBED_MIN_SCORE: "0.7" })?.minScore).toBe(0.7);
    expect(embedServer({ ...base, EMBED_MIN_SCORE: "0.01" })?.minScore).toBe(DEFAULT_MIN_SCORE);
    expect(embedServer({ ...base, EMBED_MIN_SCORE: "abc" })?.minScore).toBe(DEFAULT_MIN_SCORE);
  });

  it("the key is not part of the object: serialising it (a log line, an answer) never prints it", () => {
    expect(JSON.stringify(SERVER)).not.toContain("sk-secret");
    expect(String(Object.values(SERVER).join(" "))).not.toContain("sk-secret");
    expect(SERVER.auth()).toEqual({ authorization: "Bearer sk-secret-key-123" });
    expect(embedServer({ EMBED_URL: "http://embed:8080", EMBED_MODEL: "m" })!.auth()).toEqual({});
  });
});

describe("the numbers", () => {
  it("cosine: identical is 1, orthogonal 0, opposite -1, and what cannot be compared is 0", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it("normalize scales to length 1 and refuses an empty, non-finite or all-zero vector", () => {
    const v = normalize([3, 4])!;
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(normalize([])).toBeNull();
    expect(normalize([0, 0])).toBeNull();
    expect(normalize([1, Number.NaN])).toBeNull();
    expect(normalize(new Array(5000).fill(1))).toBeNull();
  });

  it("ranks best first, drops what is under the threshold and what sits far under the best one, and caps", () => {
    const q = [1, 0];
    const c = (id: string, x: number) => ({ id, vector: [x, Math.sqrt(1 - x * x)] });
    const ranked = rankBySimilarity(q, [c("far", 0.2), c("ok", 0.8), c("best", 0.95), c("near", 0.9), c("tail", 0.6)], { minScore: 0.55, limit: 10 });
    // 0.2 is under the threshold; 0.6 is more than SCORE_BAND under 0.95; the rest in order
    expect(ranked.map((r) => r.id)).toEqual(["best", "near", "ok"]);
    expect(0.95 - 0.8).toBeLessThanOrEqual(SCORE_BAND + 1e-9);
    expect(rankBySimilarity(q, [c("a", 0.9), c("b", 0.89), c("d", 0.88)], { minScore: 0.5, limit: 2 }).map((r) => r.id)).toEqual(["a", "b"]);
    expect(rankBySimilarity(q, [c("a", 0.3)], { minScore: 0.55, limit: 5 })).toEqual([]);
    expect(rankBySimilarity(q, [], { minScore: 0.55, limit: 5 })).toEqual([]);
  });

  it("a tie breaks by id, so the order is stable", () => {
    const q = [1, 0];
    const same = [0.8, 0.6];
    expect(rankBySimilarity(q, [{ id: "b", vector: same }, { id: "a", vector: same }], { minScore: 0.5, limit: 5 }).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("merging with the word search", () => {
  const lex = [{ id: "l1" }, { id: "l2" }];

  it("the words come first and in their order; the semantic ones fill in after, never twice", () => {
    const merged = mergeHits(lex, [{ id: "l2" }, { id: "s1" }, { id: "s2" }], { cap: 8, extra: 5 });
    expect(merged.map((m) => [m.hit.id, m.semantic])).toEqual([["l1", false], ["l2", false], ["s1", true], ["s2", true]]);
  });

  it("is capped: by the total and by the number of extras; a full lexical list takes none", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}` }));
    expect(mergeHits(many, [{ id: "s1" }], { cap: 8, extra: 5 }).map((m) => m.hit.id)).toEqual(many.map((m) => m.id));
    expect(mergeHits(lex, [{ id: "a" }, { id: "b" }, { id: "c" }], { cap: 8, extra: 2 }).filter((m) => m.semantic)).toHaveLength(2);
    expect(mergeHits(lex, [{ id: "a" }, { id: "b" }], { cap: 3, extra: 5 })).toHaveLength(3);
    expect(mergeHits([], [{ id: "a" }], { cap: 8, extra: 5 })).toEqual([{ hit: { id: "a" }, semantic: true }]);
  });
});

describe("the text that leaves", () => {
  it("a short message is not indexed; a long one is filtered and cut", () => {
    expect(messageText("شكرا")).toBeNull();
    expect(messageText("   تمام تمام   ")).toBeNull();
    const text = messageText("كلمني على 0791234567 أو ahmad@example.com بخصوص الكراتين الجديدة")!;
    expect(text).not.toContain("0791234567");
    expect(text).not.toContain("ahmad@example.com");
    expect(text).toContain("الكراتين");
    expect(messageText("ا".repeat(5000))!.length).toBeLessThanOrEqual(EMBED_TEXT_CHARS);
  });

  it("a task is its title and description, filtered; an empty one is not indexed", () => {
    expect(taskText("   ", null)).toBeNull();
    const text = taskText("طلب كراتين", "اتصل بالمورد على 0791234567")!;
    expect(text).toContain("طلب كراتين");
    expect(text).not.toContain("0791234567");
  });

  it("the question is cut to 300 characters, filtered, and a tiny one is not asked", () => {
    expect(queryText("ab")).toBeNull();
    expect(queryText("   ")).toBeNull();
    expect(queryText("علب التغليف")).toBe("علب التغليف");
    expect(queryText("ب".repeat(1000))!.length).toBeLessThanOrEqual(300);
    expect(queryText("رقمي 0791234567 علب")).not.toContain("0791234567");
  });

  it("the hash tells a changed text and a changed model apart, and is not the text", () => {
    expect(textHash("a", "m")).toBe(textHash("a", "m"));
    expect(textHash("a", "m")).not.toBe(textHash("b", "m"));
    expect(textHash("a", "m")).not.toBe(textHash("a", "n"));
    expect(textHash("secret words", "m")).not.toContain("secret");
  });
});

describe("the call", () => {
  const answer = (vectors: number[][]) => ({ status: 200, text: JSON.stringify({ data: vectors.map((embedding, index) => ({ index, embedding })) }) });

  it("posts the model and the texts to /v1/embeddings with the key as a header only, and returns unit vectors in order", async () => {
    const f = fake(answer([[3, 4], [0, 2]]));
    const out = await embedTexts(SERVER, ["one", "two"], { transport: f.transport });
    expect(out[0]![0]).toBeCloseTo(0.6);
    expect(out[1]).toEqual([0, 1]);
    const req = f.seen[0] as LocalHttpRequest;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://embed:8080/v1/embeddings");
    expect(JSON.parse(req.body as string)).toEqual({ model: "bge-m3", input: ["one", "two"] });
    expect(req.headers["authorization"]).toBe("Bearer sk-secret-key-123");
    expect(req.body).not.toContain("sk-secret");
    expect(req.url).not.toContain("sk-secret");
  });

  it("an answer out of order is put back by its index; a long list goes in batches", async () => {
    const f = fake({ status: 200, text: JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }) });
    expect(await embedTexts(SERVER, ["a", "b"], { transport: f.transport })).toEqual([[1, 0], [0, 1]]);
    let calls = 0;
    const transport: LocalTransport = async (request) => {
      calls += 1;
      const n = (JSON.parse(request.body as string) as { input: string[] }).input.length;
      return answer(Array.from({ length: n }, () => [1, 0]));
    };
    expect(await embedTexts(SERVER, Array.from({ length: 40 }, (_, i) => `t${i}`), { transport })).toHaveLength(40);
    expect(calls).toBe(3);
  });

  it("a failure is a dictionary key: never the service's words, its address, the key or the texts", async () => {
    const cases: [{ status: number; text: string } | Error, string][] = [
      [{ status: 500, text: "boom http://embed:8080 sk-secret-key-123" }, "search.embed_failed"],
      [{ status: 200, text: "<html>no</html>" }, "search.embed_failed"],
      [{ status: 200, text: JSON.stringify({ data: [] }) }, "search.embed_failed"],
      [{ status: 200, text: JSON.stringify({ data: [{ index: 0, embedding: [0, 0] }] }) }, "search.embed_failed"],
      [{ status: 429, text: "" }, "search.embed_busy"],
      [new Error("ECONNREFUSED embed:8080"), "search.embed_down"],
    ];
    for (const [a, key] of cases) {
      const f = fake(a);
      const err = await embedTexts(SERVER, ["text"], { transport: f.transport }).catch((e: unknown) => e);
      expect(err, key).toBeInstanceOf(EmbedError);
      expect((err as EmbedError).key).toBe(key);
      expect((err as Error).message).toBe(key);
      expect(AR[key], key).toBeTruthy();
    }
  });
});

describe("the switch, the words and the screen", () => {
  it("is off by default (text leaves the app), has its words with ⚠️ and 🔧, and economy mode does not own it", () => {
    expect(FEATURES).toContain("semanticSearch");
    expect(FEATURE_DEFAULTS.semanticSearch).toBe(false);
    expect(AR["features.semanticSearch.name"]).toBeTruthy();
    expect(AR["features.semanticSearch.hint"]).toContain("⚠️");
    expect(AR["features.semanticSearch.hint"]).toContain("🔧");
    expect(ECONOMY_FORCED_OFF as readonly string[]).not.toContain("semanticSearch");
    for (const key of ["semantic.close", "semantic.not_ready", "semantic.not_ready_hint"]) expect(AR[key], key).toBeTruthy();
    expect(AR["semantic.not_ready"]).toBe("الخدمة مش جاهزة");
  });

  it("the settings card tells the owner when the service is not ready, and the palette marks a hit found by meaning", () => {
    expect(read("src/app/(app)/settings/page.tsx")).toContain('notReady={embedServer() ? [] : ["semanticSearch"]}');
    expect(read("src/components/feature-switches.tsx")).toContain('t("semantic.not_ready")');
    expect(read("src/components/command-palette.tsx")).toContain('t("semantic.close")');
  });

  it("the vector never leaves: no route or DTO file mentions the vector column", () => {
    for (const file of ["src/app/api/search/route.ts", "src/server/chat/dto.ts"]) expect(read(file)).not.toMatch(/\bvector\b/);
  });

  it("the hooks are in place: a send, an edit, a delete, a task created and a task edited all queue a sync", () => {
    expect(read("src/server/chat/messages.ts").match(/queueSync\(ctx\.orgId, "message"/g)).toHaveLength(3);
    expect(read("src/server/services/tasks.ts").match(/queueSync\(actor\.orgId, "task"/g)).toHaveLength(2);
    expect(read("src/server/jobs/run.ts")).toContain("runSearchEmbed(now)");
  });

  it("no pgvector: nothing in the migration creates an extension", () => {
    const sql = read("prisma/migrations/20261111090000_search_embedding/migration.sql");
    expect(sql).not.toMatch(/CREATE\s+EXTENSION/i);
    expect(sql).not.toMatch(/\bvector\(/i);
    expect(sql).toContain("DOUBLE PRECISION[]");
  });
});
