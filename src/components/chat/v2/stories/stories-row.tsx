"use client";

import React from "react";
import { Plus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ct } from "@/lib/chat/text";
import { hasUnseen, type Rings } from "@/lib/chat/v2/stories/model";
import type { StoriesFeedDto, StoryPersonDto } from "@/lib/chat/v2/stories/types";
import { cn } from "@/lib/utils";

/** The ring around a face: the accent while something is unseen, a quiet line once all of it was. */
function Ring({ name, src, unseen, children }: { name: string; src: string | null; unseen: boolean | null; children?: React.ReactNode }) {
  return (
    <span className="relative grid shrink-0 place-items-center">
      <span data-story-ring={unseen === null ? "none" : unseen ? "unseen" : "seen"} className={cn("grid place-items-center rounded-full border-2 p-0.5", unseen === null ? "border-transparent" : unseen ? "border-accent" : "border-border")}>
        <Avatar name={name} src={src} className="size-12 text-sm" />
      </span>
      {children}
    </span>
  );
}

const TILE = "flex w-[4.5rem] shrink-0 flex-col items-center gap-1 rounded-xl py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const NAME = "w-full truncate text-center text-xs leading-5";
const BADGE = "grid size-6 place-items-center rounded-full border-2 border-surface bg-accent text-accent-fg";

export interface StoriesRowProps {
  me: StoriesFeedDto["me"];
  rings: Rings;
  /** the stories opened on this screen since the answer came */
  seen: ReadonlySet<string>;
  onOpen: (person: StoryPersonDto) => void;
  /** a computer: «+» goes straight to the file picker. A phone: it opens the camera's menu (`addMenu`) */
  onAdd: () => void;
  addMenu?: React.ReactNode;
}

/**
 * «القصص» — the row of rings above the chat list. First «قصتك» (my ring opens my stories; its «+» adds one), then everybody else, the
 * unseen first. It scrolls sideways by itself, and its touches stay its own: the list under it turns folders with a sideways finger.
 */
export function StoriesRow({ me, rings, seen, onOpen, onAdd, addMenu }: StoriesRowProps) {
  const add = (trigger: React.ReactElement) =>
    addMenu ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[60]">
          {addMenu}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      React.cloneElement(trigger, { onClick: onAdd })
    );
  const mine = rings.mine;
  return (
    <div data-stories-row="" onPointerDown={(event) => event.stopPropagation()} className="flex shrink-0 items-start gap-1 overflow-x-auto overscroll-x-contain border-b border-border/60 px-2 py-2" role="list" aria-label={ct("tgstories.row.label")}>
      <div role="listitem" className="relative shrink-0">
        {mine ? (
          <>
            <button type="button" data-story-mine="" onClick={() => onOpen(mine)} className={TILE} aria-label={ct("tgstories.row.mine_open")}>
              <Ring name={me.name} src={me.avatarUrl} unseen={false} />
              <span className={NAME}>{ct("tgstories.row.mine")}</span>
            </button>
            {add(
              <button type="button" data-story-add="" aria-label={ct("tgstories.add")} title={ct("tgstories.add")} className="absolute end-1 top-8 grid size-8 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                <span aria-hidden="true" className={BADGE}>
                  <Plus className="size-4" />
                </span>
              </button>,
            )}
          </>
        ) : (
          add(
            <button type="button" data-story-add="" className={TILE} aria-label={ct("tgstories.add")}>
              <Ring name={me.name} src={me.avatarUrl} unseen={null}>
                <span aria-hidden="true" className={cn(BADGE, "absolute -bottom-0.5 end-0")}>
                  <Plus className="size-4" />
                </span>
              </Ring>
              <span className={NAME}>{ct("tgstories.row.mine")}</span>
            </button>,
          )
        )}
      </div>
      {rings.others.map((person) => {
        const unseen = hasUnseen(person, seen);
        return (
          <div role="listitem" key={person.userId} className="shrink-0">
            <button type="button" data-story-person={person.userId} onClick={() => onOpen(person)} className={TILE} aria-label={ct(unseen ? "tgstories.row.open_unseen" : "tgstories.row.open", { name: person.name })}>
              <Ring name={person.name} src={person.avatarUrl} unseen={unseen} />
              <bdi className={cn(NAME, unseen ? "font-semibold text-fg" : "text-fg-muted")}>{person.name}</bdi>
            </button>
          </div>
        );
      })}
    </div>
  );
}
