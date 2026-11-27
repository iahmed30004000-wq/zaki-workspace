"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { pollMs } from "@/lib/economy";
import { ringsOf, startIndexOf, type ViewerPlace } from "@/lib/chat/v2/stories/model";
import type { StoriesFeedDto, StoryPersonDto } from "@/lib/chat/v2/stories/types";
import { StoriesRow } from "./stories-row";
import { StoryCameraFab, StoryPickItems, type StoryPick } from "./story-camera-fab";
import { StoryCompose } from "./story-compose";
import { StoryViewer } from "./story-viewer";
import "./stories.css";

export const STORIES_KEY = ["stories"] as const;
/** how often the row asks again while the page is looked at (the economy mode waits longer: `pollMs`) */
const REFRESH_MS = 60_000;

export interface StoriesUi {
  /** the row of rings (null: nothing to draw) */
  row: React.ReactNode;
  /** the phone's round camera button (null on a computer, and with its switch off) */
  camera: React.ReactNode;
  /** the viewer, the new-story step and the hidden file pickers */
  overlays: React.ReactNode;
}

const NOTHING: StoriesUi = { row: null, camera: null, overlays: null };

/**
 * Everything the chat list draws for «القصص». `enabled` is the server's word (the switch is on and the person is not an external
 * partner): off, nothing is asked and nothing is drawn. `phone`: the list is the whole screen — the row appears when somebody has a
 * story up (or when there is no camera button to post with); on a computer the row is always there, for its «+» is the way to post.
 */
export function useStories({ enabled, phone, camera }: { enabled: boolean; phone: boolean; camera: boolean }): StoriesUi {
  const queries = useQueryClient();
  const feed = useQuery({
    queryKey: STORIES_KEY,
    queryFn: () => apiGet<StoriesFeedDto>("/api/stories"),
    enabled,
    staleTime: 15_000,
    refetchInterval: () => pollMs(REFRESH_MS),
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const [viewing, setViewing] = useState<{ people: StoryPersonDto[]; start: ViewerPlace } | null>(null);
  const [picked, setPicked] = useState<{ file: File; n: number } | null>(null);
  const inputs = { photo: useRef<HTMLInputElement>(null), video: useRef<HTMLInputElement>(null), gallery: useRef<HTMLInputElement>(null) };
  const picks = useRef(0);

  const pick = useCallback(
    (from: StoryPick) => inputs[from].current?.click(),
    // the refs never change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const refresh = useCallback(() => void queries.invalidateQueries({ queryKey: STORIES_KEY }), [queries]);
  // `dataUpdatedAt`: an answer that arrives judges «expired» again
  const rings = useMemo(() => ringsOf(feed.data, Date.now(), seen), [feed.data, seen, feed.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (person: StoryPersonDto) => {
    // my own ring opens only mine; anybody else's walks on through the others, in the row's order
    const people = person.mine ? [person] : rings.others;
    const at = Math.max(0, people.findIndex((p) => p.userId === person.userId));
    setViewing({ people, start: { person: at, story: startIndexOf(people[at]!, seen) } });
  };
  const onSeen = useCallback((storyId: string) => {
    setSeen((was) => (was.has(storyId) ? was : new Set(was).add(storyId)));
    void fetch(`/api/stories/${encodeURIComponent(storyId)}/view`, { method: "POST" }).catch(() => undefined);
  }, []);
  const onDelete = useCallback(
    async (storyId: string) => {
      try {
        const response = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, { method: "DELETE" });
        refresh();
        return response.ok;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  if (!enabled || !feed.data) return NOTHING;
  const withCamera = phone && camera;
  const showRow = !withCamera || rings.mine !== null || rings.others.length > 0;
  const input = (from: StoryPick, accept: string, capture: boolean) => (
    <input
      ref={inputs[from]}
      data-story-input={from}
      type="file"
      accept={accept}
      {...(capture ? { capture: "environment" as const } : {})}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) setPicked({ file, n: (picks.current += 1) });
      }}
    />
  );
  return {
    row: showRow ? <StoriesRow me={feed.data.me} rings={rings} seen={seen} onOpen={open} onAdd={() => pick("gallery")} {...(phone ? { addMenu: <StoryPickItems onPick={pick} /> } : {})} /> : null,
    camera: withCamera ? <StoryCameraFab onPick={pick} /> : null,
    overlays: (
      <>
        {input("photo", "image/*", true)}
        {input("video", "video/*", true)}
        {input("gallery", "image/*,video/mp4,video/webm,video/quicktime", false)}
        {picked ? (
          <StoryCompose
            key={picked.n}
            file={picked.file}
            onClose={() => setPicked(null)}
            onPosted={() => {
              setPicked(null);
              refresh();
            }}
          />
        ) : null}
        {viewing ? (
          <StoryViewer
            people={viewing.people}
            start={viewing.start}
            seen={seen}
            onSeen={onSeen}
            onDelete={onDelete}
            onClose={() => {
              setViewing(null);
              refresh();
            }}
          />
        ) : null}
      </>
    ),
  };
}
