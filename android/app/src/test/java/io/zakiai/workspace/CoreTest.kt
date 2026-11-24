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
import io.zakiai.workspace.ui.T
import okhttp3.Cookie
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val BASE = "https://workspace.zakiai.io"

class LinksTest {
    @Test fun `a chat address opens the conversation natively`() {
        assertEquals(Destination.Conversation("abc_1-x"), Links.destinationOf("/chat/abc_1-x", BASE))
        assertEquals(Destination.Conversation("abc"), Links.destinationOf("$BASE/chat/abc/", BASE))
    }

    @Test fun `a space switch that leads to a chat opens the chat`() {
        assertEquals(Destination.Conversation("c9"), Links.destinationOf("/go?space=s1&next=%2Fchat%2Fc9", BASE))
    }

    @Test fun `the native tabs open as tabs`() {
        assertEquals(Destination.Chats, Links.destinationOf("/chat", BASE))
        assertEquals(Destination.Notifications, Links.destinationOf("/notifications?x=1", BASE))
        assertEquals(Destination.Settings, Links.destinationOf("/settings/me", BASE))
    }

    @Test fun `a section not native yet opens the site's page, with its query`() {
        assertEquals(Destination.Site("/tasks/t1?tab=steps"), Links.destinationOf("$BASE/tasks/t1?tab=steps", BASE))
        assertEquals(Destination.Site("/calls/k2"), Links.destinationOf("/calls/k2", BASE))
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
    @Test fun `writes carry the site's own origin and the app says who it is`() {
        assertEquals(Config.BASE, AppHeaders.origin())
        assertEquals("ZakiApp/4.0.0 (Android 14; Pixel 6)", AppHeaders.userAgent("4.0.0", "14", "Pixel 6"))
    }
}
