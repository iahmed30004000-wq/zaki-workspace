"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { goHref } from "@/lib/space-link";
import { spaceTemplateOf, type SpaceTemplateKey } from "@/lib/spaces/templates";
import { TemplatePicker } from "@/components/space-templates/template-picker";

/** The name a space starts with once a template is picked: the template's own, and none for «فاضية» (a name nobody chose would stay). */
const startName = (key: SpaceTemplateKey): string => (key === "blank" ? "" : (spaceTemplateOf(key)?.name ?? ""));

/**
 * «مساحة من قالب» (I1.2, switch `spaceTemplates`): the button on «كل المساحات» and its dialog. It is for the company the person works in (the first of
 * `GET /api/workspaces`, the same one `GET /api/settings/features` and `POST /api/workspaces` answer for: the switch is read for THAT company, so the button never
 * promises what the server would refuse). Drawn only for a person who may open a space there (`canCreateSpaces`) and only while the switch is on; nothing is drawn until both
 * answers are in, so the page never flashes a button that then disappears. The dialog sends the name and the template KEY: never a person (nobody is added by a template,
 * the people are added from «أعضاء المساحة») and never a topic: the server applies the data. The server decides again (capability, switch, company).
 */
export function NewSpaceFromTemplate() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<SpaceTemplateKey>("orders");
  const [name, setName] = useState(startName("orders"));
  const [named, setNamed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [spaces, features] = await Promise.all([
        fetch("/api/workspaces", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ organizations?: { canCreateSpaces?: boolean }[] } | null>,
        fetch("/api/settings/features", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ features?: { key: string; on: boolean }[] } | null>,
      ]);
      if (!alive) return;
      const mayOpen = Boolean(spaces?.organizations?.[0]?.canCreateSpaces);
      setOn(mayOpen && Boolean(features?.features?.some((f) => f.key === "spaceTemplates" && f.on)));
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!on) return null;

  function pick(key: SpaceTemplateKey) {
    setTemplate(key);
    // a name the person typed is theirs; the template's own name is only a start
    if (!named) setName(startName(key));
  }

  async function submit() {
    if (busy || !name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), template }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { workspace?: { id: string } } | null;
    setBusy(false);
    const id = body?.workspace?.id;
    if (!res?.ok || !id) return toast(t("spaceTemplates.failed"), "error");
    setOpen(false);
    // the new space is entered at once, like any space just opened
    window.location.assign(goHref(id));
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("spaceTemplates.open")}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("spaceTemplates.title")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TemplatePicker value={template} onChange={pick} />
          <div>
            <Label>{t("spaceTemplates.name")}</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNamed(true);
              }}
              maxLength={120}
              required
            />
          </div>
          <p className="text-xs text-fg-muted">{t("spaceTemplates.privacy_note")}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href="/guide/telegram-to-zaki" className="text-sm font-semibold text-accent">
              {t("spaceTemplates.guide")}
            </Link>
            <Button type="submit" disabled={busy || !name.trim()}>
              {t("spaceTemplates.create")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
