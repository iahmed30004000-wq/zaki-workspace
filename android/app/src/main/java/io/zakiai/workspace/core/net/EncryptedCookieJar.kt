package io.zakiai.workspace.core.net

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import javax.inject.Inject
import javax.inject.Singleton

/**
 * THE SESSION: the site's own cookies, kept on the phone ENCRYPTED (EncryptedSharedPreferences: AES-256-GCM values, the key in
 * the Android Keystore), so the person stays signed in between launches and nobody reading the phone's files can take the session.
 *
 * The app before 4.0 kept them in plain prefs ("zaki-cookies"): they are moved in here once, then that file is deleted, so an
 * update never signs anybody out. Nothing here is backed up (data_extraction_rules.xml).
 */
@Singleton
class EncryptedCookieJar @Inject constructor(@ApplicationContext context: Context) : CookieJar {
    /**
     * null when the phone's Keystore cannot be used at all (a vendor bug): the session then lives in memory only — the person signs
     * in again at the next start — rather than the app crashing on every start, and it is never written in plain text.
     */
    @Volatile private var prefs: SharedPreferences? = null
    private val cookies = linkedMapOf<String, Cookie>()

    /**
     * Opening the Keystore and decrypting the file takes hundreds of milliseconds on a slow phone: it runs on a thread of its own,
     * started as soon as the jar exists, so the first frame never waits for it (the splash stays until the gate is known). Every
     * reader waits for it ([ready]) — a request is never sent without the session it should carry.
     */
    private val loaded = java.util.concurrent.CountDownLatch(1)

    init {
        Thread({ load(context) }, "zaki-cookies").start()
    }

    private fun load(context: Context) {
        try {
            val store = runCatching { open(context) }.getOrElse {
                // a Keystore that lost its key (a restored phone): start clean
                context.deleteSharedPreferences(FILE)
                runCatching { open(context) }.getOrNull()
            }
            synchronized(this) {
                prefs = store
                store?.all?.forEach { (key, value) -> decode(value as? String)?.let { cookies[key] = it } }
                migrateLegacy(context)
            }
        } finally {
            loaded.countDown()
        }
    }

    /** Waits until the session is read from the phone (at once after the first start). */
    fun ready() = loaded.await()

    private fun migrateLegacy(context: Context) {
        val store = prefs ?: return // nowhere safe to move them: the old file stays until there is
        val legacy = context.getSharedPreferences(LEGACY_FILE, Context.MODE_PRIVATE)
        if (legacy.all.isEmpty()) return
        val editor = store.edit()
        for ((key, value) in legacy.all) {
            val raw = value as? String ?: continue
            val c = decode(raw) ?: continue
            if (c.expiresAt > System.currentTimeMillis() && !cookies.containsKey(key)) {
                cookies[key] = c
                editor.putString(key, raw)
            }
        }
        // written to disk BEFORE the old file goes: a process killed in between never signs the person out
        if (editor.commit()) context.deleteSharedPreferences(LEGACY_FILE)
    }

    private fun keyOf(c: Cookie) = "${c.name}|${c.domain}|${c.path}"

    // every reader waits for the load OUTSIDE the lock (the loading thread takes the lock to fill the map)

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        ready()
        synchronized(this) { save(cookies) }
    }

    private fun save(cookies: List<Cookie>) {
        val editor = prefs?.edit()
        for (c in cookies) {
            val key = keyOf(c)
            if (c.expiresAt < System.currentTimeMillis()) {
                this.cookies.remove(key)
                editor?.remove(key)
            } else {
                this.cookies[key] = c
                editor?.putString(key, encode(c))
            }
        }
        editor?.apply()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> = cookiesFor(url)

    fun cookiesFor(url: HttpUrl): List<Cookie> {
        ready()
        val now = System.currentTimeMillis()
        return synchronized(this) { cookies.values.filter { it.expiresAt > now && it.matches(url) } }
    }

    /** Whether a session cookie is on the phone (the person signed in before). The session cookie is the http-only one. */
    fun hasSession(): Boolean {
        ready()
        return synchronized(this) { cookies.values.any { it.expiresAt > System.currentTimeMillis() && it.httpOnly } }
    }

    fun clear() {
        ready()
        synchronized(this) {
            cookies.clear()
            prefs?.edit()?.clear()?.apply()
        }
    }

    companion object {
        private const val FILE = "zaki_cookies_enc"
        /** The plain file of the app before 4.0. */
        const val LEGACY_FILE = "zaki-cookies"

        private const val SEP = "\u0001"

        fun encode(c: Cookie): String = listOf(
            c.name, c.value, c.domain, c.path, c.expiresAt,
            if (c.secure) "1" else "0", if (c.hostOnly) "1" else "0", if (c.httpOnly) "1" else "0",
        ).joinToString(SEP)

        fun decode(raw: String?): Cookie? {
            val parts = raw?.split(SEP) ?: return null
            if (parts.size < 8) return null
            return runCatching {
                val b = Cookie.Builder().name(parts[0]).value(parts[1]).path(parts[3]).expiresAt(parts[4].toLongOrNull() ?: Long.MAX_VALUE)
                if (parts[6] == "1") b.hostOnlyDomain(parts[2]) else b.domain(parts[2])
                if (parts[5] == "1") b.secure()
                if (parts[7] == "1") b.httpOnly()
                b.build()
            }.getOrNull()
        }

        private fun open(context: Context): SharedPreferences = EncryptedSharedPreferences.create(
            context,
            FILE,
            MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }
}
