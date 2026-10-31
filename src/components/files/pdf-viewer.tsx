"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { arabicPlural, fmtNumber, fmtSize } from "@/lib/format";
import { interpolate } from "@/lib/i18n/interpolate";
import { AR } from "@/lib/i18n/dict";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/** «12 صفحة» / «صفحتين» / «صفحة واحدة»: the Arabic number forms live in the dictionary. */
export function pagesText(n: number): string {
  const form = arabicPlural(n);
  return interpolate(AR[`files.pdf.pages.${form}`] ?? "", { n: fmtNumber(n) });
}

/**
 * The library's PDF viewer: the file opens inside the page, from the SAME authorised route the download uses
 * (`/api/files/<id>/raw`, inline, with the type the bytes proved), so a person who may not read the file gets nothing here
 * either: the frame would show the refusal, and the page count answers 404.
 *
 * ⚠️ Some phones and older browsers do not draw a PDF inside a page. 🔧 The two buttons next to the name (open in a new tab,
 * download) are always there, and the frame carries a sentence saying so where it stays blank.
 */
export function PdfViewer({ file, onClose }: { file: { id: string; name: string; size?: number }; onClose: () => void }) {
  const { t } = useI18n();
  const src = `/api/files/${file.id}/raw`;
  const pages = useQuery({
    queryKey: ["files", "pdf-pages", file.id],
    queryFn: () => apiGet<{ pages: number | null }>(`/api/files/${file.id}/pages`),
    staleTime: Infinity,
    retry: false,
  });
  const count = pages.data?.pages ?? null;
  return (
    <Modal open onClose={onClose} title={file.name}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          {count !== null && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-fg">{pagesText(count)}</span>}
          {file.size !== undefined && <span>{fmtSize(file.size)}</span>}
          <a href={src} target="_blank" rel="noreferrer" className="ms-auto">
            <Button size="sm" variant="secondary" type="button">
              <ExternalLink className="size-4" />
              {t("files.pdf.open_tab")}
            </Button>
          </a>
          <a href={`${src}?download=1`} download>
            <Button size="sm" variant="ghost" type="button">
              <Download className="size-4" />
              {t("files.pdf.download")}
            </Button>
          </a>
        </div>
        <iframe src={src} title={`${t("files.pdf.title")}: ${file.name}`} className="h-[68vh] w-full rounded-lg border border-border bg-surface-2" />
        <p className="text-xs text-fg-muted">{t("files.pdf.fallback")}</p>
      </div>
    </Modal>
  );
}
