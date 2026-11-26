package io.zakiai.workspace

import io.zakiai.workspace.core.AppLock
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.AppHeaders
import io.zakiai.workspace.core.net.EncryptedCookieJar
import io.zakiai.workspace.core.net.failureOf
import io.zakiai.workspace.core.sync.OutboxRules
import io.zakiai.workspace.core.sync.OutboxStep
import io.zakiai.workspace.feature.auth.PasswordRule
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import io.zakiai.workspace.feature.web.FilePick
import io.zakiai.workspace.ui.T
import okhttp3.Cookie
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val BASE = "https://workspace.zakiai.io"

class FilePickTest {
    @Test fun `every kind the page accepts is asked for, not only the first`() {
        assertEquals(listOf("image/*", "video/*"), FilePick.mimeTypes(arrayOf("image/*,video/*")))
        assertEquals(listOf("image/*", "video/*"), FilePick.mimeTypes(arrayOf(" image/* ", "video/*")))
    }

    @Test fun `no kind, or a kind given by its ending only, means any file`() {
        assertEquals(listOf("*/*"), FilePick.mimeTypes(null))
        assertEquals(listOf("*/*"), FilePick.mimeTypes(arrayOf("")))
        assertEquals(listOf("*/*"), FilePick.mimeTypes(arrayOf(".pdf,image/*")))
    }

    @Test fun `several picked files all come back, once each`() {
        assertEquals(listOf("a", "b"), FilePick.picked(listOf("a", "b", "a"), "a"))
    }

    @Test fun `one picked file comes back when there is no list, and nothing picked is nothing`() {
        assertEquals(listOf("a"), FilePick.picked(emptyList(), "a"))
        assertEquals(emptyList<String>(), FilePick.picked(emptyList<String>(), null))
    }
}

class LinksTest {
    @Test fun `a chat address opens the conversation natively`() {
        assertEquals(Destination.Conversation("abc_1-x"), Links.destinationOf("/chat/abc_1-x", BASE))
        assertEquals(Destination.Conversation("abc"), Links.destinationOf("$BASE/chat/abc/", BASE))
    }

    @Test fun `a link to one message opens the conversation on that message`() {
        assertEquals(Destination.Conversation("c1", "m9"), Links.destinationOf("/chat/c1?m=m9", BASE))
        assertEquals(Destination.Conversation("c1", "m9"), Links.destinationOf("/go?space=s1&next=%2Fchat%2Fc1%3Fm%3Dm9", BASE))
        // a message id that is not an id is ignored, the conversation still opens
        assertEquals(Destination.Conversation("c1", null), Links.destinationOf("/chat/c1?m=..%2Fx", BASE))
    }

    @Test fun `a space switch that leads to a chat opens the chat`() {
        assertEquals(Destination.Conversation("c9"), Links.destinationOf("/go?space=s1&next=%2Fchat%2Fc9", BASE))
    }

    @Test fun `the native tabs open as tabs`() {
        assertEquals(Destination.Chats, Links.destinationOf("/chat", BASE))
        assertEquals(Destination.Notifications, Links.destinationOf("/notifications?x=1", BASE))
    }

    @Test fun `the company's settings stay the site's page, the person's own open the native tab that now holds them (N6 batch 5)`() {
        assertEquals(Destination.Settings, Links.destinationOf("/settings/me", BASE))
        assertEquals(Destination.Site("/settings"), Links.destinationOf("$BASE/settings", BASE))
    }

    @Test fun `a section not native yet opens the site's page, with its query`() {
        assertEquals(Destination.Site("/crm?view=board"), Links.destinationOf("$BASE/crm?view=board", BASE))
        assertEquals(Destination.Site("/watch/k2"), Links.destinationOf("/watch/k2", BASE))
    }

    @Test fun `projects, a project, its timeline, a board and the goals open natively (N3)`() {
        assertEquals(Destination.Projects, Links.destinationOf("/projects", BASE))
        assertEquals(Destination.Project("p1"), Links.destinationOf("$BASE/projects/p1?tab=board", BASE))
        assertEquals(Destination.Project("p1"), Links.destinationOf("/projects/p1/timeline", BASE))
        assertEquals(Destination.Board("b_2"), Links.destinationOf("/boards/b_2", BASE))
        assertEquals(Destination.Board("b2"), Links.destinationOf("/go?space=s1&next=%2Fboards%2Fb2", BASE))
        assertEquals(Destination.Goals, Links.destinationOf("/goals", BASE))
        // a deeper page of a project is not the project
        assertEquals(Destination.Site("/projects/p1/fields"), Links.destinationOf("/projects/p1/fields", BASE))
    }

    @Test fun `the day, my work and a task open natively, a task from any space`() {
        assertEquals(Destination.Today, Links.destinationOf("/", BASE))
        assertEquals(Destination.Today, Links.destinationOf("$BASE/?view=today", BASE))
        assertEquals(Destination.MyWork, Links.destinationOf("/my-work?tab=overdue", BASE))
        assertEquals(Destination.Task("t1"), Links.destinationOf("$BASE/tasks/t1?tab=steps", BASE))
        assertEquals(Destination.Task("t9"), Links.destinationOf("/go?space=s2&next=%2Ftasks%2Ft9", BASE))
        // a deeper page of a task is the site's
        assertEquals(Destination.Site("/tasks/t1/history"), Links.destinationOf("/tasks/t1/history", BASE))
    }

    @Test fun `another site, a protocol-relative address and nothing are never opened inside the app`() {
        assertNull(Links.destinationOf("https://evil.example/chat/abc", BASE))
        assertNull(Links.destinationOf("https://workspace.zakiai.io.evil.example/chat/abc", BASE))
        assertNull(Links.destinationOf("//evil.example/x", BASE))
        assertNull(Links.destinationOf("", BASE))
        assertNull(Links.destinationOf(null, BASE))
    }
}

class OutboxRulesTest {
    private fun err(status: Int?, offline: Boolean = false) = ApiResult.Err(ApiFailure("x", status = status, offline = offline))

    @Test fun `sent is done, and a refusal of the server stops the row`() {
        assertEquals(OutboxStep.DONE, OutboxRules.stepOf(ApiResult.Ok(Unit)))
        for (s in listOf(400, 403, 404, 409, 422)) assertEquals("$s", OutboxStep.REFUSED, OutboxRules.stepOf(err(s)))
    }

    @Test fun `no network, a busy or failing server and an ended session wait for the next run`() {
        assertEquals(OutboxStep.RETRY_LATER, OutboxRules.stepOf(err(null, offline = true)))
        for (s in listOf(401, 408, 429, 500, 502, 503)) assertEquals("$s", OutboxStep.RETRY_LATER, OutboxRules.stepOf(err(s)))
    }

    @Test fun `an answer the app could not read is not retried for ever`() {
        assertEquals(OutboxStep.REFUSED, OutboxRules.stepOf(err(null)))
    }
}

class FailureTest {
    @Test fun `the precise key of the server wins and is said in Arabic`() {
        val f = failureOf(401, """{"error":"auth.required","message":"invalid_credentials"}""")
        assertEquals("invalid_credentials", f.key)
        assertEquals("اسم المستخدم أو كلمة المرور غير صحيحة.", f.message)
        assertTrue(f.signedOut)
    }

    @Test fun `the onboarding owed is recognised`() {
        assertTrue(failureOf(403, """{"error":"forbidden","message":"auth.onboarding_required"}""").onboardingOwed)
    }

    @Test fun `an unknown body falls back to the status's sentence, never to English`() {
        val f = failureOf(500, "<html>oops</html>")
        assertTrue(f.message.any { it in '؀'..'ۿ' })
        assertFalse(f.message.contains("oops"))
    }
}

class PasswordRuleTest {
    @Test fun `the server's rule, checked before sending`() {
        assertEquals(T.errMin8, PasswordRule.problem("old", "a1", "a1"))
        assertEquals(T.errLetter, PasswordRule.problem("old", "12345678", "12345678"))
        assertEquals(T.errDigit, PasswordRule.problem("old", "abcdefgh", "abcdefgh"))
        assertEquals(T.errSame, PasswordRule.problem("abcd1234", "abcd1234", "abcd1234"))
        assertEquals(T.errMismatch, PasswordRule.problem("old", "abcd1234", "abcd1235"))
        assertNull(PasswordRule.problem("old", "abcd1234", "abcd1234"))
    }
}

class LockTest {
    @Test fun `locks again only when on and away more than five minutes`() {
        assertFalse(AppLock.shouldLock(false, 1, 1 + 10 * 60_000))
        assertFalse(AppLock.shouldLock(true, 0, 10 * 60_000))
        assertFalse(AppLock.shouldLock(true, 1_000, 1_000 + 4 * 60_000))
        assertTrue(AppLock.shouldLock(true, 1_000, 1_000 + 6 * 60_000))
    }
}

class CookieTest {
    @Test fun `a session cookie survives the round trip through the phone's store`() {
        val c = Cookie.Builder().name("zaki_session").value("v.1.2").hostOnlyDomain("workspace.zakiai.io").path("/")
            .expiresAt(4_102_444_800_000).secure().httpOnly().build()
        val back = EncryptedCookieJar.decode(EncryptedCookieJar.encode(c))!!
        assertEquals(c.name, back.name)
        assertEquals(c.value, back.value)
        assertEquals(c.domain, back.domain)
        assertTrue(back.hostOnly && back.secure && back.httpOnly)
        assertNull(EncryptedCookieJar.decode("broken"))
    }
}

class HandleTest {
    @Test fun `a username keeps its at sign in front inside the right-to-left screen`() {
        val h = io.zakiai.workspace.ui.components.handleOf("owner")
        assertTrue(h.startsWith("⁦@owner"))
        assertTrue(h.endsWith("⁩"))
    }
}

class HeadersTest {
    @Test fun `the app says who it is`() {
        assertEquals("ZakiApp/4.0.0 (Android 14; Pixel 6)", AppHeaders.userAgent("4.0.0", "14", "Pixel 6"))
        assertEquals("ZakiApp/4.0.0 (Android ?; ?)", AppHeaders.userAgent("4.0.0", null, null))
    }
}

class ChatLinesTest {
    private fun msg(id: String, clientId: String?) = io.zakiai.workspace.core.net.Message(id = id, body = "b-$id", mine = true, clientId = clientId)
    private fun row(clientId: String, sentAt: Long? = null, refused: String? = null) =
        io.zakiai.workspace.core.db.OutboxItem(clientId, "chat.send", "c1", "p-$clientId", 1_000, refusedKey = refused, sentAt = sentAt)
    private val messages = listOf(msg("m1", "k1"))
    private val draft: (String) -> io.zakiai.workspace.core.net.ChatSend? = { io.zakiai.workspace.core.net.ChatSend(body = it, clientId = "x") }

    @Test fun `a message the server already shows is drawn once, never with its outbox copy`() {
        val lines = io.zakiai.workspace.feature.chat.ChatLines.of(messages, listOf(row("k1", sentAt = 5)), "me", draft)
        assertEquals(listOf("m1"), lines.map { it.id })
    }

    @Test fun `a sent message the server does not show yet stays on screen as a plain message`() {
        val lines = io.zakiai.workspace.feature.chat.ChatLines.of(messages, listOf(row("k2", sentAt = 5)), "me", draft)
        assertEquals(listOf("m1", "outbox-k2"), lines.map { it.id })
        assertNull(lines.last().outbox)
        assertEquals("p-k2", lines.last().message.body)
    }

    @Test fun `a waiting voice note or file says what it carries, never an empty bubble`() {
        val voice: (String) -> io.zakiai.workspace.core.net.ChatSend? = { io.zakiai.workspace.core.net.ChatSend(clientId = "x", attachmentIds = listOf("f1"), voice = true) }
        val line = io.zakiai.workspace.feature.chat.ChatLines.of(emptyList(), listOf(row("k5")), "me", voice).single()
        assertTrue(line.message.body!!.contains(io.zakiai.workspace.feature.chat.C.voiceNote))
    }

    @Test fun `waiting and refused rows say so`() {
        val lines = io.zakiai.workspace.feature.chat.ChatLines.of(messages, listOf(row("k3"), row("k4", refused = "forbidden")), "me", draft)
        assertEquals(listOf("waiting", "refused"), lines.drop(1).map { it.outbox })
    }
}

class SafeTraceTest {
    @Test fun `a crash report carries the classes and frames, never what the message said`() {
        val secret = "For input string: \"0790000000 Ahmad\""
        val e = RuntimeException("wrapper with secret", NumberFormatException(secret))
        val stack = io.zakiai.workspace.core.crash.SafeTrace.stack(e)
        val head = io.zakiai.workspace.core.crash.SafeTrace.headline(e, "main")
        assertTrue(stack.contains("java.lang.RuntimeException"))
        assertTrue(stack.contains("Caused by: java.lang.NumberFormatException"))
        assertTrue(stack.contains("\tat "))
        assertFalse(stack.contains("0790000000") || stack.contains("secret"))
        assertEquals("java.lang.RuntimeException [main]", head)
    }
}

class LockAuthenticatorsTest {
    @Test fun `the lock can be switched on from Android 8 up`() {
        val weak = androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
        val strong = androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
        val pin = androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
        assertEquals(weak or pin, AppLock.authenticators(28))
        assertEquals(weak or pin, AppLock.authenticators(29))
        assertEquals(strong or pin, AppLock.authenticators(30))
    }
}
