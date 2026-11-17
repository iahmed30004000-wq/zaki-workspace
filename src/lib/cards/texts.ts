/**
 * The sentences of a card's page that are made from data (a field's value, a line of the log). Pure: they take the
 * translator as an argument, so the server-rendered test and the screen say the same thing.
 */

import { isCardColor, type CardItem } from "./shared";
import type { LogEntry } from "./page";
import type { CardSnapshot, SnapshotField } from "./versions";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** The snapshot a card on screen has right now. */
export function snapshotOfItem(card: Pick<CardItem, "title" | "body" | "data" | "color" | "category" | "tags" | "fileId">): CardSnapshot {
  return { title: card.title, body: card.body, data: card.data, color: card.color, category: card.category, tags: card.tags, fileId: card.fileId };
}

function dataText(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const v = value as Record<string, unknown>;
  if (Array.isArray(v["items"])) {
    return (v["items"] as Array<{ text?: unknown; done?: unknown }>).map((it) => `${it.done === true ? "☑" : "☐"} ${String(it.text ?? "")}`).join("\n");
  }
  if (typeof v["url"] === "string") return v["url"];
  if (Array.isArray(v["columns"]) && Array.isArray(v["rows"])) {
    return [(v["columns"] as unknown[]).join(" | "), ...(v["rows"] as unknown[][]).map((r) => r.join(" | "))].join("\n");
  }
  return "";
}

/** A field's value as the words the page shows (empty is «(فارغ)», a colour is its name, a table is its rows). */
export function fieldText(field: SnapshotField, value: unknown, t: Translate): string {
  const empty = t("cards.p.empty_value");
  if (value === null || value === undefined || value === "") return empty;
  switch (field) {
    case "tags":
      return Array.isArray(value) && value.length ? value.join("، ") : empty;
    case "color":
      return typeof value === "string" && isCardColor(value) ? t(`cards.color.${value}`) : empty;
    case "data":
      return dataText(value) || empty;
    case "fileId":
      return t("cards.field.fileId");
    default:
      return typeof value === "string" ? value : empty;
  }
}

const STATUS = new Set(["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]);
const statusWord = (v: unknown, t: Translate): string => (typeof v === "string" && STATUS.has(v) ? t(`cards.status.${v}`) : "");

/** What a line of the log says (without the name of who did it). */
export function logText(entry: Pick<LogEntry, "action" | "actorName" | "detail">, t: Translate): string {
  const d = entry.detail;
  const num = (v: unknown): number | string => (typeof v === "number" ? v : "");
  switch (entry.action) {
    case "edited": {
      const fields = typeof d["fields"] === "string" && d["fields"] ? d["fields"].split(",").map((f) => t(`cards.field.${f}`)).join("، ") : "";
      return fields ? t("cards.log.edited", { fields, version: num(d["version"]) }) : t("cards.log.edited_plain", { version: num(d["version"]) });
    }
    case "restored":
      return t("cards.log.restored", { fromVersion: num(d["fromVersion"]), version: num(d["version"]) });
    case "status":
      return t("cards.log.status", { from: statusWord(d["from"], t), to: statusWord(d["to"], t) });
    case "pinned":
      return t(d["pinned"] === true ? "cards.log.pinned_on" : "cards.log.pinned_off");
    case "rated":
      return t(entry.actorName ? "cards.log.rated" : "cards.log.rated_anon");
    case "image_added":
    case "image_removed":
      return t(`cards.log.${entry.action}`, { name: typeof d["name"] === "string" ? d["name"] : "" });
    case "copied":
      return t("cards.log.copied", { what: typeof d["what"] === "string" ? d["what"] : "" });
    case "cover":
      return d["removed"] === true ? t("cards.log.cover_removed") : t("cards.log.cover", { name: typeof d["name"] === "string" ? d["name"] : "" });
    default:
      return t(`cards.log.${entry.action}`);
  }
}
