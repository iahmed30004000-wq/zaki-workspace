/**
 * «نقل أو فكّ المهام المفتوحة»: the whole list of holders of a card after one person is replaced by another (`to`), or taken off (`to` null). The first holder stays first,
 * the person who comes in takes the place of the one who goes, and nobody is listed twice. Pure: pinned by tests/bulk-assign-ui.test.ts.
 */
export function holdersAfter(row: { assigneeId: string | null; coAssignees: readonly { userId: string }[] }, from: string, to: string | null): string[] {
  const now = [...(row.assigneeId ? [row.assigneeId] : []), ...row.coAssignees.map((c) => c.userId)];
  return [...new Set(to === null ? now.filter((id) => id !== from) : now.map((id) => (id === from ? to : id)))];
}
