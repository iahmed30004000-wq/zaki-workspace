package io.zakiai.workspace

import io.zakiai.workspace.ui.components.avatarHue
import org.junit.Assert.assertEquals
import org.junit.Test

/** The look follows the site: the same name gets the same picture colour on the phone and in the browser (src/lib/format.ts `avatarHue`). */
class DesignTest {
    @Test fun `a name's colour is the site's own hue`() {
        // the values the site's function gives for the same names (computed with src/lib/format.ts)
        assertEquals(269f, avatarHue("Sara Test"))
        assertEquals(254f, avatarHue("Main Workspace"))
        assertEquals(327f, avatarHue("ذكي"))
        assertEquals(0f, avatarHue(""))
        // a character outside the basic plane counts as its two UTF-16 halves, as `charCodeAt` does
        assertEquals(89f, avatarHue("😀 Ali"))
    }
}
