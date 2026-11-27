"use client";

import { useEffect, useState } from "react";
import type { ChatListSearchDto } from "@/server/chat/search";
import { listSearchUrl, listSearchWords } from "@/lib/chat/v2/info/list-search";

/**
 * C3d — the list's search as the person types: a short pause, then ONE request (`GET /api/search?scope=chat&q=`), the last one wins and an older one is aborted.
 * Plain state, no query cache: a search result is never kept (it could name a conversation the person later loses), and the list header that uses it renders
 * without a provider in the tests of the old screens. `null` data while nothing was asked.
 */
export const LIST_SEARCH_PAUSE_MS = 300;

export interface ListSearchState {
  data: ChatListSearchDto | null;
  failed: boolean;
  /** the words the data was asked for (a result older than the typed words is never shown as the new one) */
  words: string | null;
  /** the typed words are being asked about and nothing for them is here yet */
  pending?: boolean;
}

const IDLE: ListSearchState = { data: null, failed: false, words: null };

const WAITING: ListSearchState = { data: null, failed: false, words: null, pending: true };

export function useListSearch(typed: string): ListSearchState {
  const words = listSearchWords(typed);
  const [state, setState] = useState<ListSearchState>(IDLE);
  useEffect(() => {
    if (!words) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(listSearchUrl(words), { cache: "no-store", signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error("search");
          return res.json() as Promise<ChatListSearchDto>;
        })
        .then((data) => setState({ data, failed: false, words }))
        .catch(() => {
          if (!controller.signal.aborted) setState({ data: null, failed: true, words });
        });
    }, LIST_SEARCH_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [words]);
  // the typed words moved on: what is held belongs to the old ones
  if (words && state.words === words) return state;
  return words ? WAITING : IDLE;
}
