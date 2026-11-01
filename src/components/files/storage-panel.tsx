"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, HardDrive, Trash2 } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { fmtNumber, fmtSize } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { StorageWarning, type StorageState } from "@/components/files/storage-warning";

interface Tally {
  files: number;
  bytes: number;
}

interface Meter extends StorageState {
  server: Tally;
  drive: Tally;
  movable: Tally;
  copies: Tally;
}

interface Batch {
  done: number;
  bytes: number;
  failed: number;
  missing: number;
  next: string | null;
  stopped: "drive_unavailable" | null;
  plan?: Tally;
}

type Step = "copy" | "delete";

/**
 * THE OWNER'S STORAGE PANEL (the owner's ask, 2026-11-01): how much the server's disk holds, how much Google Drive holds,
 * and the two steps that empty the server of old files. They are two separate buttons on purpose: «انقل» copies to Drive
 * and checks it (and deletes nothing); «احذف نسخ السيرفر» is its own click, behind a confirmation, and removes only the
 * copies Drive proved identical. Both work in small batches the screen repeats, and can be stopped and run again.
 */
export function StoragePanel() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const stop = useRef(false);
  const [busy, setBusy] = useState<Step | null>(null);
  const [plan, setPlan] = useState<Tally | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const meter = useQuery({ queryKey: ["storage", "meter"], queryFn: () => apiGet<Meter>("/api/storage") });
  const m = meter.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["storage", "meter"] });

  const failed = (err: unknown) => {
    const key = err instanceof ApiError ? (err.messageKey ?? err.code) : "common.error";
    const plain = t(key);
    toast(plain === key ? t("common.error") : plain, "error");
  };

  const countFirst = async () => {
    setBusy("copy");
    try {
      const r = await apiPost<Batch>("/api/storage/move", { step: "copy", dryRun: true });
      setPlan(r.plan ?? { files: 0, bytes: 0 });
    } catch (err) {
      failed(err);
    } finally {
      setBusy(null);
    }
  };

  /** One step, batch after batch, until the server says there is no more (or the owner stops it). */
  const run = async (step: Step) => {
    stop.current = false;
    setBusy(step);
    setLines([]);
    let after: string | null = null;
    const sum = { done: 0, bytes: 0, failed: 0, missing: 0 };
    let stoppedByDrive = false;
    try {
      do {
        const r: Batch = await apiPost<Batch>("/api/storage/move", { step, after });
        sum.done += r.done;
        sum.bytes += r.bytes;
        sum.failed += r.failed;
        sum.missing += r.missing;
        setLines([t("spacelib.panel.progress", { n: fmtNumber(sum.done), size: fmtSize(sum.bytes) })]);
        if (r.stopped) {
          stoppedByDrive = true;
          break;
        }
        after = r.next;
      } while (after && !stop.current);
      const out: string[] = [];
      if (step === "copy") out.push(t("spacelib.panel.finished", { n: fmtNumber(sum.done), size: fmtSize(sum.bytes) }));
      else out.push(t("spacelib.panel.deleted", { n: fmtNumber(sum.done), size: fmtSize(sum.bytes) }));
      if (sum.failed > 0) out.push(t(step === "copy" ? "spacelib.panel.some_failed" : "spacelib.panel.delete_failed", { n: fmtNumber(sum.failed) }));
      if (sum.missing > 0) out.push(t("spacelib.panel.some_missing", { n: fmtNumber(sum.missing) }));
      if (stoppedByDrive) out.push(t("spacelib.panel.stopped_drive"));
      setLines(out);
      setPlan(null);
    } catch (err) {
      failed(err);
    } finally {
      setBusy(null);
      refresh();
      qc.invalidateQueries({ queryKey: ["files", "list"] });
    }
  };

  if (!m) return null;
  const driveReady = m.target === "drive";

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface-1 p-4" aria-label={t("spacelib.panel.title")}>
      <h2 className="text-sm font-semibold">{t("spacelib.panel.title")}</h2>

      {driveReady ? <p className="text-xs text-ok">{t("spacelib.panel.drive_ok")}</p> : <StorageWarning state={m} />}

      <dl className="grid gap-2 sm:grid-cols-3">
        <Figure icon={<HardDrive className="size-4 text-warn" />} label={t("spacelib.panel.on_server")} tally={m.server} />
        <Figure icon={<Cloud className="size-4 text-ok" />} label={t("spacelib.panel.on_drive")} tally={m.drive} />
        <Figure icon={<Trash2 className="size-4 text-muted" />} label={t("spacelib.panel.copies")} tally={m.copies} />
      </dl>
      <p className="text-xs text-muted">{t("spacelib.panel.avatars_note")}</p>

      <div className="space-y-2 rounded-lg bg-surface-2 p-3">
        <h3 className="text-sm font-medium">{t("spacelib.panel.move_title")}</h3>
        <p className="text-xs leading-6 text-muted">{t("spacelib.panel.move_hint")}</p>
        {!driveReady && (
          <div className="space-y-0.5 text-xs leading-6">
            <p className="text-warn">{t("spacelib.panel.not_ready")}</p>
            <p>{t("spacelib.panel.not_ready_fix")}</p>
          </div>
        )}
        {plan && <p className="text-xs">{plan.files === 0 ? t("spacelib.panel.plan_none") : t("spacelib.panel.plan", { n: fmtNumber(plan.files), size: fmtSize(plan.bytes) })}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={countFirst} disabled={busy !== null}>
            {t("spacelib.panel.count_first")}
          </Button>
          <Button size="sm" onClick={() => run("copy")} disabled={busy !== null || !driveReady || m.movable.files === 0}>
            {busy === "copy" ? t("spacelib.panel.working") : t("spacelib.panel.start")}
          </Button>
          {busy !== null && (
            <Button size="sm" variant="ghost" onClick={() => (stop.current = true)}>
              {t("spacelib.panel.stop")}
            </Button>
          )}
        </div>
      </div>

      {m.copies.files > 0 && (
        <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6">
          <p className="text-warn">{t("spacelib.panel.copies_warn")}</p>
          <p>{t("spacelib.panel.copies_fix")}</p>
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
            <Trash2 className="size-4" />
            {busy === "delete" ? t("spacelib.panel.working") : t("spacelib.panel.delete_start")}
          </Button>
        </div>
      )}

      {lines.length > 0 && (
        <ul className="space-y-0.5 text-xs" aria-live="polite">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t("spacelib.panel.delete_confirm_title")}>
        <div className="space-y-3">
          <p className="text-sm leading-6">{t("spacelib.panel.delete_confirm", { n: fmtNumber(m.copies.files), size: fmtSize(m.copies.bytes) })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setConfirmDelete(false);
                void run("delete");
              }}
            >
              {t("spacelib.panel.delete_yes")}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function Figure({ icon, label, tally }: { icon: React.ReactNode; label: string; tally: Tally }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold">{fmtSize(tally.bytes) || "0"}</dd>
      <dd className="text-xs text-muted">{t("spacelib.panel.count", { n: fmtNumber(tally.files) })}</dd>
    </div>
  );
}
