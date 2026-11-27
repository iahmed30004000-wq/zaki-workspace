"use client";

import React from "react";
import { ExternalLink, MapPin } from "lucide-react";
import type { CardRefDto } from "@/server/chat/dto";
import { accuracyWords, coordsText, mapsUrl } from "@/lib/chat/location";
import { ct } from "@/lib/chat/text";

/**
 * «إرسال الموقع» — the card of a shared place: the coordinates, how accurate they are, and «افتح بالخرائط». There is no map picture and no tile: drawing this card asks
 * nobody anything. The link goes to a maps page only when the READER taps it, in a new tab, with no referrer and no handle back to the app.
 */
export function LocationCard({ place }: { place: Extract<CardRefDto, { type: "location" }> }) {
  const accuracy = accuracyWords(place.accuracy);
  return (
    <div data-location-card="" className="mt-1 w-64 max-w-full overflow-hidden rounded-lg border border-border bg-surface text-fg">
      <div className="flex items-start gap-2 p-2">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
          <MapPin className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{ct("chatloc.card.title")}</p>
          <p>
            <bdi dir="ltr" className="text-xs text-fg-muted">
              {coordsText(place)}
            </bdi>
          </p>
          <p className="text-xs text-fg-muted">{ct(accuracy.key, { n: accuracy.n })}</p>
        </div>
      </div>
      <a data-location-open="" href={mapsUrl(place)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="flex min-h-11 items-center justify-center gap-2 border-t border-border px-3 text-sm font-semibold text-accent hover:bg-surface-2">
        <ExternalLink aria-hidden="true" className="size-4" />
        {ct("chatloc.card.open")}
      </a>
    </div>
  );
}
