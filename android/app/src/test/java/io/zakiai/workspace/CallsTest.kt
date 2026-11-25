package io.zakiai.workspace

import io.zakiai.workspace.core.net.CallDetail
import io.zakiai.workspace.feature.calls.CallBridge
import io.zakiai.workspace.feature.calls.CallRules
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone's call follows the site's rules (src/lib/calls/session.ts). */
class CallRulesTest {
    @Test fun `a final reason ends the call, anything else is a drop the call rejoins after`() {
        for (r in listOf("CLIENT_INITIATED", "DUPLICATE_IDENTITY", "PARTICIPANT_REMOVED", "ROOM_DELETED", "ROOM_CLOSED")) assertFalse(r, CallRules.isDrop(r))
        assertTrue(CallRules.isDrop(null))
        assertTrue(CallRules.isDrop("SIGNAL_CLOSE"))
        assertTrue(CallRules.isDrop("CONNECTION_TIMEOUT"))
    }

    @Test fun `the rejoin waits as the site does - 1 s, doubling, at most 15 s`() {
        assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 15000L, 15000L), (1..6).map { CallRules.rejoinDelayMs(it) })
    }

    @Test fun `the end line is the site's endKeyOf`() {
        assertEquals("طلّعوك من هالمكالمة.", CallRules.endText(CallDetail(endedHow = "answered"), removed = true))
        assertEquals("رفض المكالمة", CallRules.endText(CallDetail(endedHow = "declined"), removed = false))
        assertEquals("ما حدا ردّ", CallRules.endText(CallDetail(endedHow = "missed"), removed = false))
        assertEquals("خلصت المكالمة.", CallRules.endText(null, removed = false))
    }

    @Test fun `the microphone opens at once only in a DM or for the starter`() {
        assertTrue(CallRules.micOnAtJoin(CallDetail(kind = "DM")))
        assertTrue(CallRules.micOnAtJoin(CallDetail(kind = "TOPIC", startedByMe = true)))
        assertFalse(CallRules.micOnAtJoin(CallDetail(kind = "TOPIC")))
        assertFalse(CallRules.micOnAtJoin(CallDetail(kind = "MEETING")))
    }

    @Test fun `a ring's address gives its call, and a call link opens natively`() {
        assertEquals("c1", CallBridge.callIdOf("https://workspace.zakiai.io/calls/c1"))
        assertEquals("c_2", CallBridge.callIdOf("/calls/c_2?x=1"))
        assertNull(CallBridge.callIdOf("https://workspace.zakiai.io/calls/c1/minutes"))
        assertNull(CallBridge.callIdOf(null))
        assertEquals(Destination.Call("c1"), Links.destinationOf("/calls/c1", "https://workspace.zakiai.io"))
        assertEquals(Destination.Site("/calls/c1/minutes"), Links.destinationOf("/calls/c1/minutes", "https://workspace.zakiai.io"))
    }
}
