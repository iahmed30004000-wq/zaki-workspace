/**
 * W1.5 - the pure changes the board makes to what it holds the moment a person acts. The board used to reload the whole page after adding a column, adding a
 * card and deleting a column; now it changes what it shows at once (these functions), asks the server for the page's own answer (`router.refresh()`), and the
 * server's answer replaces what the board holds. Pure: a test runs them without a page.
 */
import type { ColumnData, TaskCardData } from "@/components/board-view";

/** A card in another column (the optimistic move). Other cards are untouched; an unknown id changes nothing; the input is never changed. */
export function withTaskMoved(tasks: readonly TaskCardData[], taskId: string, columnId: string): TaskCardData[] {
  return tasks.map((t) => (t.id === taskId ? { ...t, columnId } : t));
}

/** A column added at the end (the server answered with its row). Added once: the same id twice would draw the column twice. */
export function withColumnAdded(columns: readonly ColumnData[], column: ColumnData): ColumnData[] {
  return columns.some((c) => c.id === column.id) ? [...columns] : [...columns, column];
}

/** A column deleted (the server only deletes an empty one, so no card goes with it). */
export function withColumnRemoved(columns: readonly ColumnData[], columnId: string): ColumnData[] {
  return columns.filter((c) => c.id !== columnId);
}

/** The address with `?task=<id>` set (or removed): the other parameters (the project page's tab and board) stay. */
export function withTaskParam(href: string, taskId: string | null): string {
  const url = new URL(href, "http://zaki.local");
  if (taskId) url.searchParams.set("task", taskId);
  else url.searchParams.delete("task");
  return `${url.pathname}${url.search}${url.hash}`;
}
