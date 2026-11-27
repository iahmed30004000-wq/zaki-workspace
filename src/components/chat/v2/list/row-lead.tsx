"use client";

import React, { createContext, useContext } from "react";
import type { ChatRowDto } from "@/lib/chat/cache/types";

/**
 * One seam of the shared row: a list may draw a row's picture its own way (the forum's coloured topic icons) without the row knowing why. Without a provider
 * the row draws its own picture, as ever. `usual` is that picture, so a list can keep it for a computer's width.
 */
export type RowLead = (row: ChatRowDto, tall: boolean, usual: React.ReactElement) => React.ReactElement;

const RowLeadContext = createContext<RowLead | null>(null);

export const RowLeadProvider = RowLeadContext.Provider;
export const useRowLead = (): RowLead | null => useContext(RowLeadContext);
