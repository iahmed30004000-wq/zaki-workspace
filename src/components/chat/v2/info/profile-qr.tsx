"use client";

import React, { useMemo, useState } from "react";
import { QrCode } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ct } from "@/lib/chat/text";
import { profileQrUrl, qrModel } from "@/lib/chat/v2/qr";

/**
 * «رمز QR» of a person's page (the profile screen of «شكل تيليجرام»): a row that opens a sheet with the code and the address under it. The code is drawn in black on white whatever the
 * theme is, because a scanner needs that contrast. It is made on the device from the page's own address; nothing leaves it.
 */
export function ProfileQrRow({ userId, name, className }: { userId: string; name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-info-qr-open="" onClick={() => setOpen(true)} className={className}>
        <QrCode className="size-4 shrink-0" aria-hidden="true" />
        <span>{ct("chatui.info.qr_open")}</span>
      </button>
      {open ? <ProfileQrSheet userId={userId} name={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ProfileQrSheet({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const url = useMemo(() => profileQrUrl(window.location.origin, userId), [userId]);
  const model = useMemo(() => qrModel(url), [url]);
  const pad = 2;
  const side = model.size + pad * 2;
  return (
    <Modal open title={ct("chatui.info.qr_title")} onClose={onClose}>
      <div data-info-qr="" className="flex flex-col items-center gap-3">
        <p className="text-base font-semibold text-fg">
          <bdi>{name}</bdi>
        </p>
        <svg role="img" aria-label={ct("chatui.info.qr_alt")} viewBox={`0 0 ${side} ${side}`} shapeRendering="crispEdges" className="size-56 rounded-xl">
          <rect width={side} height={side} fill="white" />
          <path transform={`translate(${pad} ${pad})`} d={model.path} fill="black" />
        </svg>
        <p className="text-center text-xs text-fg-muted">{ct("chatui.info.qr_hint")}</p>
        <bdi dir="ltr" className="max-w-full break-all text-center text-xs text-fg-muted">
          {url}
        </bdi>
      </div>
    </Modal>
  );
}
