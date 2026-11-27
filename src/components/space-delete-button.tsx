"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Contents = {
  name: string;
  projects: number;
  tasks: number;
  conversations: number;
  messages: number;
  files: number;
  ideas: number;
  goals: number;
  routines: number;
  customers: number;
  members?: number;
  /** a department's space: its department goes too, with these */
  department?: { tickets: number; campaigns: number; people: number } | null;
};
const COUNTS = ["projects", "tasks", "conversations", "messages", "files", "ideas", "goals", "routines", "customers", "members"] as const;
const DEPARTMENT_COUNTS = ["tickets", "campaigns", "people"] as const;

/**
 * «احذف المساحة» on a card of «كل المساحات» (the OWNER only; never «الشركة»; a department's space goes with its department, and the list says so): shows what goes
 * with it, asks for its name typed, then deletes it with all its work (src/server/services/space-delete.ts decides
 * again). A2.2: on the space's own settings page («خطر») the page would be gone, so `onDeleted` replaces the refresh (the page leaves), and `labelled`
 * draws the button with its words instead of the card's trash icon.
 */
export function SpaceDeleteButton({ id, name, onDeleted, labelled = false }: { id: string; name: string; onDeleted?: () => void; labelled?: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [contents, setContents] = useState<Contents | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setContents(null);
    setTyped("");
    setError("");
    let alive = true;
    fetch(`/api/workspaces/${encodeURIComponent(id)}/delete-all`, { cache: "no-store" })
      .then(async (r) => {
        const data = (await r.json()) as Contents & { message?: string };
        if (!alive) return;
        if (!r.ok) setError(t(data.message ?? "spaces.delete.failed"));
        else setContents(data);
      })
      .catch(() => alive && setError(t("spaces.delete.failed")));
    return () => {
      alive = false;
    };
  }, [open, id, t]);

  async function confirm() {
    if (busy || typed.trim() !== name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/workspaces/${encodeURIComponent(id)}/delete-all`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: typed }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { message?: string };
        setError(t(data.message ?? "spaces.delete.failed"));
        return;
      }
      setOpen(false);
      toast(t("spaces.delete.done"), "success");
      if (onDeleted) onDeleted();
      else router.refresh();
    } catch {
      setError(t("spaces.delete.failed"));
    } finally {
      setBusy(false);
    }
  }

  const items = contents ? COUNTS.filter((k) => (contents[k] ?? 0) > 0) : [];
  const department = contents?.department ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${t("spaces.delete.open")}: ${name}`}
        className={
          labelled
            ? "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-danger/40 px-3 text-sm font-medium text-danger hover:bg-danger/10"
            : "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-fg-muted hover:bg-danger/10 hover:text-danger"
        }
      >
        <Trash2 aria-hidden="true" className="size-4" />
        {labelled ? t("spaces.delete.open") : null}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("spaces.delete.title", { name })}>
        <div className="space-y-3 text-sm">
          {!contents && !error && <p role="status" className="text-fg-muted">{t("spaces.delete.loading")}</p>}
          {contents && (
            <>
              {items.length ? (
                <>
                  <p className="font-medium">{t("spaces.delete.what")}</p>
                  <ul className="grid grid-cols-2 gap-1">
                    {items.map((k) => (
                      <li key={k} className="rounded-lg bg-surface-2 px-2 py-1">{t(`spaces.delete.count.${k}`, { n: contents[k] ?? 0 })}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>{t("spaces.delete.empty")}</p>
              )}
              {department ? (
                <div data-delete-department="" className="space-y-1 rounded-lg border border-danger/40 p-2">
                  <p className="font-medium text-danger">{t("spaces.delete.dept")}</p>
                  <ul className="grid grid-cols-2 gap-1">
                    {DEPARTMENT_COUNTS.map((k) => (
                      <li key={k} className="rounded-lg bg-surface-2 px-2 py-1">{t(`spaces.delete.dept.${k}`, { n: department[k] })}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-danger">{t("spaces.delete.warn")}</p>
              <label className="block">
                <span className="mb-1 block font-medium">{t("spaces.delete.type", { name })}</span>
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
            </>
          )}
          {error && <p role="alert" className="text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="danger" disabled={!contents || busy || typed.trim() !== name.trim()} onClick={() => void confirm()}>
              {t("spaces.delete.confirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
