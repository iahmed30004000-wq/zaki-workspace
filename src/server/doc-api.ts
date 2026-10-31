import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { DocConflictError } from "@/server/services/documents";

/**
 * `withApi` for the document routes that save words: a document that moved on since the editor started answers 409 with the
 * document as it is now (`current`), so the screen can say «غيرك حفظ قبلك» and let the person decide. Never a silent overwrite.
 */
export function withDocApi(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return withApi(async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DocConflictError) {
        return NextResponse.json({ error: "conflict", message: "docs.conflict", current: err.current }, { status: 409 });
      }
      throw err;
    }
  });
}
