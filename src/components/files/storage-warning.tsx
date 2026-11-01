"use client";

import { useI18n } from "@/lib/i18n";

/** Where a new file goes right now (`GET /api/files`, `GET /api/storage`): Drive, or the server and why. */
export interface StorageState {
  target: "drive" | "server";
  reason: "not_configured" | "not_connected" | "needs_reconnect" | "feature_off" | "unavailable" | null;
}

/**
 * ⚠️ The server's disk is only a fallback and can fill up; 🔧 the way out is shown right under it, together (the owner's
 * rule). Nothing is drawn while new files go to Drive.
 */
export function StorageWarning({ state }: { state: StorageState }) {
  const { t } = useI18n();
  if (state.target === "drive" || !state.reason) return null;
  return (
    <div className="space-y-0.5 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6" role="status">
      <p className="text-warn">{t(`spacelib.warn.${state.reason}`)}</p>
      <p>{t(`spacelib.fix.${state.reason}`)}</p>
    </div>
  );
}
