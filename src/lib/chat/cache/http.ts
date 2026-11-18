import { ApiError } from "@/lib/api-client";

export async function fetchChatJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin", signal, headers: { accept: "application/json" } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(b.error ?? "internal", res.status, b.details, b.message, body);
  }
  return body as T;
}

/** Retry once for a network or server fault; never for an answer that said no. */
export function chatRetry(count: number, error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : 0;
  if (status >= 400 && status < 500) return false;
  return count < 1;
}
