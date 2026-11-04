import { runSearchEmbedBackfill, type BackfillRun } from "@/server/services/search-embed-index";

/**
 * «بحث بالمعنى»: the gradual backfill. Each tick gives every company that turned the switch on one small batch of its newest messages and
 * tasks without a vector (the newest 2000 in all), through the embeddings service. Without a service (env EMBED_URL and EMBED_MODEL) it does
 * nothing at all, not even a query. Idempotent: what already has its vector is not sent again.
 */
export type { BackfillRun as SearchEmbedRun };

export async function runSearchEmbed(now: Date): Promise<BackfillRun | null> {
  return runSearchEmbedBackfill(now);
}
