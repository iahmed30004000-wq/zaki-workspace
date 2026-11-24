"use client";

import React, { useMemo, useState } from "react";
import { Download, QrCode, Share2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ct } from "@/lib/chat/text";
import { profileQrUrl, qrFileName, qrLogoBox, qrModel } from "@/lib/chat/v2/qr";

const PAD = 2;
/** the strip under the code that carries the name, in modules */
const LABEL = 3;
const LOGO_SRC = "/icon.svg";

/**
 * «رمز QR» of a person's page (the profile screen of «شكل تيليجرام»): a row that opens Telegram's QR screen, a sheet that fills a phone: the code in a white card with the app's mark in
 * the middle and the person's name under it, and two round buttons, «شارك» and «نزّل الصورة». The code is drawn in black on white whatever the theme is, because a scanner needs that
 * contrast; level H keeps it readable under the mark. It is made on the device from the page's own address, and the picture too; nothing leaves it.
 */
export function ProfileQrRow({ userId, name, className }: { userId: string; name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-info-qr-open="" onClick={() => setOpen(true)} className={className}>
        <QrCode className="size-4 shrink-0" aria-hidden="true" />
        <span>{ct("chatui.info.qr_open")}</span>
      </button>
      {open ? <ProfileQrScreen userId={userId} name={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The card as a PNG, drawn by hand on a canvas (an SVG that points at another file cannot be turned into a picture), and handed to the browser as a download. */
async function savePng(model: { size: number; path: string }, name: string): Promise<void> {
  const scale = 12;
  const side = model.size + PAD * 2;
  const canvas = document.createElement("canvas");
  canvas.width = side * scale;
  canvas.height = (side + LABEL) * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(PAD, PAD);
  ctx.fillStyle = "black";
  ctx.fill(new Path2D(model.path));
  ctx.restore();
  const box = qrLogoBox(model.size);
  const logo = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = LOGO_SRC;
  });
  const at = (v: number) => (v + PAD) * scale;
  ctx.fillStyle = "white";
  ctx.fillRect(at(box.x) - scale / 2, at(box.y) - scale / 2, (box.side + 1) * scale, (box.side + 1) * scale);
  if (logo) ctx.drawImage(logo, at(box.x), at(box.y), box.side * scale, box.side * scale);
  ctx.fillStyle = "black";
  ctx.font = `bold ${scale * 1.7}px sans-serif`;
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.fillText(name, canvas.width / 2, (side + LABEL / 2) * scale + scale * 0.5, canvas.width - scale * 2);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("no picture");
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = qrFileName(name);
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

function ProfileQrScreen({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const url = useMemo(() => profileQrUrl(window.location.origin, userId), [userId]);
  const model = useMemo(() => qrModel(url, "H"), [url]);
  const [note, setNote] = useState<"copied" | "failed" | null>(null);
  const side = model.size + PAD * 2;
  const box = qrLogoBox(model.size);
  const share = async () => {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote("copied");
    } catch (error) {
      // the person closed the share sheet: not a failure
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNote("failed");
    }
  };
  const download = () => {
    savePng(model, name).catch(() => setNote("failed"));
  };
  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="min-h-[100dvh] items-center justify-center gap-5 rounded-none bg-surface px-6 py-10 md:min-h-0">
        <SheetTitle className="text-lg font-semibold text-fg">{ct("chatui.info.qr_title")}</SheetTitle>
        <div data-info-qr-screen className="flex w-full max-w-xs flex-col items-center gap-5">
          <svg role="img" aria-label={ct("chatui.info.qr_alt")} viewBox={`0 0 ${side} ${side + LABEL}`} shapeRendering="crispEdges" className="w-full rounded-3xl shadow-card">
            <rect width={side} height={side + LABEL} fill="white" />
            <path transform={`translate(${PAD} ${PAD})`} d={model.path} fill="black" />
            <rect x={PAD + box.x - 0.5} y={PAD + box.y - 0.5} width={box.side + 1} height={box.side + 1} rx={1} fill="white" />
            <image href={LOGO_SRC} x={PAD + box.x} y={PAD + box.y} width={box.side} height={box.side} />
            <text x={side / 2} y={side + LABEL / 2 + 0.6} textAnchor="middle" fontSize="1.7" fontWeight="bold" fill="black" direction="rtl" shapeRendering="auto">
              {name}
            </text>
          </svg>
          <SheetDescription className="text-center text-sm text-fg-muted">{ct("chatui.info.qr_hint")}</SheetDescription>
          <div className="flex items-center justify-center gap-6">
            <button type="button" data-info-qr-share onClick={() => void share()} aria-label={ct("chatui.info.qr_share")} title={ct("chatui.info.qr_share")} className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-fg shadow-card hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <Share2 aria-hidden="true" className="size-6" />
            </button>
            <button type="button" data-info-qr-download onClick={download} aria-label={ct("chatui.info.qr_download")} title={ct("chatui.info.qr_download")} className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-fg shadow-card hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <Download aria-hidden="true" className="size-6" />
            </button>
          </div>
          {note ? (
            <p role="status" data-info-qr-note={note} className="text-xs text-fg-muted">
              {note === "copied" ? ct("chatui.info.qr_copied") : ct("chatui.info.qr_failed")}
            </p>
          ) : null}
          <bdi dir="ltr" className="max-w-full break-all text-center text-xs text-fg-muted">
            {url}
          </bdi>
        </div>
      </SheetContent>
    </Sheet>
  );
}
