import { ApiError, apiPost } from "@/lib/api-client";
import { ct } from "@/lib/chat/text";

export interface DigestAnswer {
  text: string;
  empty: boolean;
  cached: boolean;
  generatedAt: string | null;
}

/** The sentence of a refusal: a `digest.err.*` key when the server sent one the dictionary knows, else the plain «failed». */
export function digestErrorText(err: unknown): string {
  const key = err instanceof ApiError ? err.messageKey : undefined;
  if (key && key.startsWith("digest.err.")) {
    const known = ct(key);
    if (known !== key) return known;
  }
  return ct("digest.err.failed");
}

/** «شو فاتني؟» of the signed-in person (`refresh`: ignore the 3-hour cache). */
export const fetchDigest = (refresh: boolean): Promise<DigestAnswer> => apiPost<DigestAnswer>("/api/digest", refresh ? { refresh: true } : {});

/** «لخّصلي»: one topic, for the person only. */
export const fetchTopicSummary = (conversationId: string): Promise<DigestAnswer> => apiPost<DigestAnswer>(`/api/chat/conversations/${encodeURIComponent(conversationId)}/summarize`, {});
