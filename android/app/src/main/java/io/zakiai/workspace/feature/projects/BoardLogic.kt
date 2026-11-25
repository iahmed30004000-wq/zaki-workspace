package io.zakiai.workspace.feature.projects

import io.zakiai.workspace.core.net.BoardCard

/**
 * The board's own rules, pure (unit-tested) — the same answers the site's board gives (src/components/board-view.tsx, `moveTask`):
 * a card's place in a column is its index among the OTHER cards of that column, and dropping on a column without a card means its end.
 */
object BoardLogic {
    /** The cards of one column, in the board's order. */
    fun column(cards: List<BoardCard>, columnId: String): List<BoardCard> = cards.filter { it.columnId == columnId }

    /**
     * The board after a card moved into [toColumn] at [index] among that column's other cards (clamped; null = the end). The order of the
     * list IS the order on screen, so the move is drawn at once and a refused move is undone by putting the old list back.
     * [done]: whether [toColumn] is the board's «منتهي» (a card entering it is drawn finished; leaving it, open — as the server writes).
     */
    fun moved(cards: List<BoardCard>, cardId: String, toColumn: String, index: Int?, done: Boolean): List<BoardCard> {
        val card = cards.firstOrNull { it.id == cardId } ?: return cards
        val rest = cards.filter { it.id != cardId }
        val others = rest.filter { it.columnId == toColumn }
        val at = (index ?: others.size).coerceIn(0, others.size)
        val placed = card.copy(columnId = toColumn, completed = if (done) true else if (card.columnId != toColumn) false else card.completed)
        // insert before the [at]-th card of the target column, or right after its last card (or at the end of the list for an empty column)
        val anchor = others.getOrNull(at)
        val out = rest.toMutableList()
        if (anchor != null) {
            out.add(out.indexOf(anchor), placed)
        } else {
            val last = others.lastOrNull()
            if (last != null) out.add(out.indexOf(last) + 1, placed) else out.add(placed)
        }
        return out
    }

    /** The index to send the server for a card dropped on the [overIndex]-th visible card of a column (its index among the others). */
    fun dropIndex(cards: List<BoardCard>, cardId: String, toColumn: String, overIndex: Int?): Int? {
        if (overIndex == null) return null
        val others = column(cards, toColumn).filter { it.id != cardId }
        return overIndex.coerceIn(0, others.size)
    }
}
