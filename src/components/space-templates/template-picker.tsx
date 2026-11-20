"use client";

import { SPACE_TEMPLATES, type SpaceTemplate, type SpaceTemplateKey } from "@/lib/spaces/templates";
import { useI18n } from "@/lib/i18n";

/**
 * «اختار القالب» (I1.2): the five templates of a new space as one list of radio rows (a list, not cards: D1). Each row shows the template's name, one line of what it is
 * for, its topics (the ones that open «خاص» are marked) and, for «إنتاج المحتوى», the project it comes with. Pure display: the choice goes up through `onChange`, the dialog
 * sends only the key, and the server applies the data of `src/lib/spaces/templates.ts`.
 */
export function TemplatePicker({ value, onChange, name = "template" }: { value: SpaceTemplateKey; onChange: (key: SpaceTemplateKey) => void; name?: string }) {
  const { t } = useI18n();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-fg">{t("spaceTemplates.pick")}</legend>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {SPACE_TEMPLATES.map((tpl) => (
          <li key={tpl.key}>
            <TemplateRow tpl={tpl} name={name} selected={tpl.key === value} onPick={() => onChange(tpl.key)} />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function TemplateRow({ tpl, name, selected, onPick }: { tpl: SpaceTemplate; name: string; selected: boolean; onPick: () => void }) {
  const { t } = useI18n();
  return (
    <label className={selected ? "flex min-h-11 cursor-pointer items-start gap-3 bg-accent/10 p-3" : "flex min-h-11 cursor-pointer items-start gap-3 p-3 hover:bg-surface-2"}>
      <input type="radio" name={name} value={tpl.key} checked={selected} onChange={onPick} className="mt-1 size-4 shrink-0 accent-accent" />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          {tpl.emoji ? <span aria-hidden="true">{tpl.emoji}</span> : null}
          <bdi>{tpl.name}</bdi>
        </span>
        <span className="block text-xs text-fg-muted">{t(`spaceTemplates.hint.${tpl.key}`)}</span>
        {tpl.topics.length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            <span className="font-semibold">{t("spaceTemplates.topics")}:</span>
            {tpl.topics.map((topic) => (
              <span key={topic.key} className="inline-flex items-center gap-1">
                <bdi>{topic.title}</bdi>
                {topic.privateByDefault ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">{t("spaceTemplates.private")}</span> : null}
              </span>
            ))}
          </span>
        ) : null}
        {tpl.projects.map((project) => (
          <span key={project.key} className="block text-xs text-fg-muted">
            {t("spaceTemplates.project", { name: project.name })}
          </span>
        ))}
      </span>
    </label>
  );
}
