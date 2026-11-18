"use client";

import React from "react";
import { avatarHue, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The person's circle: their picture when they uploaded one, their initials otherwise (with a
 * deterministic per-name hue). Only our own address is ever drawn (`/api/avatars/…`), never a
 * remote URL: a face that a colleague sees is a face this server holds.
 *
 * D1: when the picture FAILS (a 404, a broken file) the initials are drawn at once, and that address is not asked for again
 * for the rest of the page's life (one failed address is remembered, not retried by every row that shows the person).
 */
const failed = new Set<string>();

export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  /** `/api/avatars/<id>?v=<file>` — null (or absent) draws the initials */
  src?: string | null;
  className?: string;
}) {
  const [, rerender] = React.useState(0);
  const safe = src && src.startsWith("/api/avatars/") && !failed.has(src) ? src : null;
  if (safe) {
    return (
      <span
        aria-hidden="true"
        className={cn("relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2", className)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- our own small circle, already sized by CSS; next/image would need a fixed loader for a private route */}
        <img
          src={safe}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => {
            failed.add(safe);
            rerender((n) => n + 1);
          }}
        />
      </span>
    );
  }
  const hue = avatarHue(name);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-surface",
        className,
      )}
      // dark enough that the white initials keep 4.5:1 on every hue (yellow-green is the hard one)
      style={{ backgroundColor: `hsl(${hue}, 45%, 30%)` }}
    >
      {initials(name)}
    </span>
  );
}

/** The address is remembered as failed (the tests, and the `onError` above). */
export function markAvatarFailed(src: string): void {
  failed.add(src);
}

/** For the tests: forget the failed addresses. */
export function resetFailedAvatars(): void {
  failed.clear();
}
