"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { goHref } from "@/lib/space-link";
import { spaceTemplateOf, type SpaceTemplateKey } from "@/lib/spaces/templates";
import { TemplatePicker } from "@/components/space-templates/template-picker";

interface OrgChoice {
  id: string;
  name: string;
}

/** The name a space starts with once a template is picked: the template's own, and none for «فاضية» (a name nobody chose would stay). */
const startName = (key: SpaceTemplateKey): string => (key === "blank" ? "" : (spaceTemplateOf(key)?.name ?? ""));

/**
 * «مساحة من قالب» (I1.2, switch `spaceTemplates`): the button on «كل المساحات» and its dialog. It is drawn only for a person who may open a space in at least one
 * company (`canCreateSpaces` of `GET /api/workspaces`) and only while the company's switch is on (`GET /api/settings/features`); nothing is drawn until both answers are in,
 * so the page never flashes a button that then disappears. The dialog sends the company, the name and the template KEY: never a person (nobody is added by a template,
 * the people are added from «أعضاء المساحة») and never a topic: the server applies the data. The server decides again (capability, switch, company).
 */
export function NewSpaceFromTemplate() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [on, setOn] = useState(false);
  const [orgs, setOrgs] = useState<OrgChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [template, setTemplate] = useState<SpaceTemplateKey>("orders");
  const [name, setName] = useState(startName("orders"));
  const [named, setNamed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [spaces, features] = await Promise.all([
        fetch("/api/workspaces", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ organizations?: { id: string; name: string; canCreateSpaces?: boolean }[] } | null>,
        fetch("/api/settings/features", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ features?: { key: string; on: boolean }[] } | null>,
      ]);
      if (!alive) return;
      const allowed = (spaces?.organizations ?? []).filter((o) => o.canCreateSpaces).map((o) => ({ id: o.id, name: o.name }));
      setOrgs(allowed);
      setOrgId((was) => was || allowed[0]?.id || "");
      setOn(Boolean(features?.features?.some((f) => f.key === "spaceTemplates" && f.on)));
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!on || orgs.length === 0) return null;

  function pick(key: SpaceTemplateKey) {
    setTemplate(key);
    // a name the person typed is theirs; the template's own name is only a start
    if (!named) setName(startName(key));
  }

  async function submit() {
    if (busy || !name.trim() || !orgId) return;
    setBusy(true);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, name: name.trim(), template }),
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
          {orgs.length > 1 ? (
            <div>
              <Label>{t("spaceTemplates.org")}</Label>
              <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
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
