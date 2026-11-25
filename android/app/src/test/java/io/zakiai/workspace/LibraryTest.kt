package io.zakiai.workspace

import io.zakiai.workspace.feature.library.DocMarkup
import io.zakiai.workspace.feature.library.DocMarkup.Block
import io.zakiai.workspace.feature.library.DocMarkup.Inline
import io.zakiai.workspace.feature.library.priceOf
import io.zakiai.workspace.feature.library.stockWord
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import io.zakiai.workspace.ui.components.Ago
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

/** A document reads on the phone as on the site (src/lib/docs/markup.ts `parseDoc`). */
class DocMarkupTest {
    @Test fun `headings, paragraphs, bullets and numbers become their blocks`() {
        val blocks = DocMarkup.parse("# عنوان\n\nسطر أول\nسطر ثاني\n\n- بند\n* بند ثاني\n1. أول\n2) ثاني")
        assertEquals(Block.Heading(1, listOf(Inline.Text("عنوان"))), blocks[0])
        assertEquals(Block.Para(listOf(Inline.Text("سطر أول\nسطر ثاني"))), blocks[1])
        assertEquals(Block.Bullets(listOf(listOf(Inline.Text("بند")), listOf(Inline.Text("بند ثاني")))), blocks[2])
        assertEquals(Block.Numbered(listOf(listOf(Inline.Text("أول")), listOf(Inline.Text("ثاني")))), blocks[3])
    }

    @Test fun `bold and a safe link are marked, an unsafe address stays the words it was written with`() {
        assertEquals(
            listOf(Inline.Text("هذا "), Inline.Bold(listOf(Inline.Text("مهم"))), Inline.Text(" و "), Inline.Link("https://zakiai.io", "الموقع")),
            DocMarkup.parseInline("هذا **مهم** و [الموقع](https://zakiai.io)", emptyList()),
        )
        assertEquals(listOf(Inline.Text("[اضغط](javascript:alert(1))")), DocMarkup.parseInline("[اضغط](javascript:alert(1))", emptyList()))
        assertNull(DocMarkup.safeHref("data:text/html,x"))
        assertEquals("mailto:a@b.co", DocMarkup.safeHref("mailto:a@b.co"))
    }

    @Test fun `only the space's people are mentions, the longest name first`() {
        assertEquals(
            listOf(Inline.Mention("@سارة أحمد"), Inline.Text(" شوفي و @غريب")),
            DocMarkup.parseInline("@سارة أحمد شوفي و @غريب", listOf("سارة", "سارة أحمد")),
        )
    }
}

/** The site's «قبل …» and sizes (src/lib/format.ts `fmtAgo`, `fmtSize`). */
class AgoTest {
    private val now = Instant.parse("2026-11-25T12:00:00Z")

    @Test fun `relative times use the site's Arabic plural forms`() {
        assertEquals("الآن", Ago.of("2026-11-25T11:59:30Z", now))
        assertEquals("قبل دقيقة", Ago.of("2026-11-25T11:59:00Z", now))
        assertEquals("قبل دقيقتين", Ago.of("2026-11-25T11:58:00Z", now))
        assertEquals("قبل 5 دقائق", Ago.of("2026-11-25T11:55:00Z", now))
        assertEquals("قبل 15 دقيقة", Ago.of("2026-11-25T11:45:00Z", now))
        assertEquals("قبل ساعتين", Ago.of("2026-11-25T10:00:00Z", now))
        assertEquals("قبل 3 أيام", Ago.of("2026-11-22T12:00:00Z", now))
        assertEquals("قبل شهر", Ago.of("2026-10-25T12:00:00Z", now))
        assertEquals("", Ago.of(null, now))
    }

    @Test fun `sizes are bytes, kilobytes, then megabytes with one decimal`() {
        assertEquals("512 بايت", Ago.size(512))
        assertEquals("2 كيلوبايت", Ago.size(2048))
        assertEquals("1.5 ميغابايت", Ago.size(1572864))
    }
}

class ProductTextTest {
    @Test fun `a price is written as the site writes it`() {
        assertEquals("20 دينار", priceOf(20.0, "JOD"))
        assertEquals("12.5$", priceOf(12.5, "USD"))
        assertEquals("12.99 ريال", priceOf(12.99, "SAR"))
        assertEquals("7 XYZ", priceOf(7.0, "XYZ"))
    }

    @Test fun `stock reads in or out by the site's words`() {
        assertEquals("out", stockWord("OUT_OF_STOCK"))
        assertEquals("out", stockWord("نفد"))
        assertEquals("in", stockWord("in_stock"))
        assertNull(stockWord("unknown"))
        assertNull(stockWord(null))
    }

    @Test fun `the library, a document and a product sheet open natively (N4)`() {
        val base = "https://workspace.zakiai.io"
        assertEquals(Destination.Library, Links.destinationOf("/files", base))
        assertEquals(Destination.Library, Links.destinationOf("/documents", base))
        assertEquals(Destination.Library, Links.destinationOf("/knowledge", base))
        assertEquals(Destination.Document("d1"), Links.destinationOf("$base/documents/d1", base))
        assertEquals(Destination.Sheet("c9"), Links.destinationOf("/knowledge/c9", base))
        assertEquals(Destination.Document("d2"), Links.destinationOf("/go?space=s&next=%2Fdocuments%2Fd2", base))
    }
}
