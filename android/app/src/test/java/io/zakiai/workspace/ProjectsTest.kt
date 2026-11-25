package io.zakiai.workspace

import androidx.compose.ui.graphics.toArgb
import io.zakiai.workspace.core.net.BoardCard
import io.zakiai.workspace.feature.projects.BoardLogic
import io.zakiai.workspace.feature.projects.P
import io.zakiai.workspace.feature.projects.hexColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

/** The board's own rules on the phone — the answers the site's board gives (src/components/board-view.tsx, `moveTask`). */
class BoardLogicTest {
    private fun card(id: String, col: String, done: Boolean = false) = BoardCard(id = id, columnId = col, completed = done)

    // a board: todo [a, b, c], doing [d], done []
    private val board = listOf(card("a", "todo"), card("b", "todo"), card("c", "todo"), card("d", "doing"))

    private fun order(cards: List<BoardCard>, col: String) = BoardLogic.column(cards, col).map { it.id }

    @Test fun `a card dropped at the end of another column lands after its last card`() {
        val out = BoardLogic.moved(board, "a", "doing", null, done = false)
        assertEquals(listOf("b", "c"), order(out, "todo"))
        assertEquals(listOf("d", "a"), order(out, "doing"))
    }

    @Test fun `a card dropped on the first place of a column lands before its first card`() {
        val out = BoardLogic.moved(board, "c", "doing", 0, done = false)
        assertEquals(listOf("c", "d"), order(out, "doing"))
    }

    @Test fun `a card reordered inside its own column counts its place among the others`() {
        // c to the top of «todo»: index 0 among [a, b]
        assertEquals(listOf("c", "a", "b"), order(BoardLogic.moved(board, "c", "todo", 0, done = false), "todo"))
        // a between b and c: index 1 among [b, c]
        assertEquals(listOf("b", "a", "c"), order(BoardLogic.moved(board, "a", "todo", 1, done = false), "todo"))
    }

    @Test fun `an empty column takes the card, and an index past the end is the end`() {
        assertEquals(listOf("b"), order(BoardLogic.moved(board, "b", "done", 7, done = true), "done"))
        assertEquals(listOf("d", "a"), order(BoardLogic.moved(board, "a", "doing", 99, done = false), "doing"))
    }

    @Test fun `entering the done column draws the card finished, leaving it draws it open`() {
        val finished = BoardLogic.moved(board, "a", "done", null, done = true)
        assertTrue(finished.first { it.id == "a" }.completed)
        val reopened = BoardLogic.moved(finished, "a", "todo", null, done = false)
        assertFalse(reopened.first { it.id == "a" }.completed)
    }

    @Test fun `no card is lost or doubled by a move, and an unknown card changes nothing`() {
        val out = BoardLogic.moved(board, "b", "doing", 1, done = false)
        assertEquals(board.map { it.id }.sorted(), out.map { it.id }.sorted())
        assertEquals(board, BoardLogic.moved(board, "zzz", "doing", 0, done = false))
    }

    @Test fun `the index sent to the server is the place among the other cards, null for the end`() {
        assertNull(BoardLogic.dropIndex(board, "a", "doing", null))
        assertEquals(1, BoardLogic.dropIndex(board, "a", "doing", 5))
        assertEquals(0, BoardLogic.dropIndex(board, "c", "todo", 0))
    }
}

class ProjectTextTest {
    @Test fun `a date reads as the site's day month year`() {
        assertEquals("25 تشرين الثاني 2026", P.dmy("2026-11-25T09:00:00Z", ZoneId.of("UTC")))
        assertEquals("1 كانون الثاني 2027", P.dmy("2027-01-01T00:00:00Z", ZoneId.of("UTC")))
        assertNull(P.dmy(null))
        assertNull(P.dmy("not a date"))
    }

    @Test fun `a project status reads as the site's word`() {
        assertEquals("نشط", P.status("ACTIVE"))
        assertEquals("في خطر", P.status("AT_RISK"))
        assertEquals("قيد التخطيط", P.status("SOMETHING_NEW"))
    }

    @Test fun `a colour of the site's hex reads, anything else is the grey`() {
        assertEquals(0xFF3B82F6.toInt(), hexColor("#3b82f6").toArgb())
        assertEquals(hexColor(null), hexColor("nope"))
    }
}
