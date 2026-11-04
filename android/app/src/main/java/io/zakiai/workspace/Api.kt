package io.zakiai.workspace

import android.content.Context
import android.os.Build
import android.webkit.CookieManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** A refusal of the server: its HTTP status and its message key (`invalid_credentials`, `auth.account_suspended`, `features.off`…). */
class ApiException(val status: Int, val key: String) : Exception("$status $key")

/**
 * The app's one line to the site: the same API the website uses, signed in with the same session cookie. The cookie is kept on the phone
 * (so the person stays signed in) and handed to the in-app web view, so the pages that are not native yet open already signed in.
 */
object Api {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; isLenient = true; encodeDefaults = true }
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private lateinit var jar: PrefsCookieJar
    private lateinit var client: OkHttpClient

    fun init(context: Context) {
        if (::client.isInitialized) return
        jar = PrefsCookieJar(context.applicationContext)
        client = OkHttpClient.Builder()
            .cookieJar(jar)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                // the site's guard only lets a write through when it comes from the site itself: the app says so, like the website's own pages do
                val req = chain.request().newBuilder()
                    .header("Origin", Config.BASE)
                    .header("Accept-Language", "ar")
                    .header("User-Agent", "ZakiApp/3.0 (Android ${Build.VERSION.RELEASE}; ${Build.MODEL})")
                    .build()
                chain.proceed(req)
            }
            .build()
    }

    /** Whether a session cookie is on the phone (the person signed in before). */
    fun hasSession(): Boolean = jar.hasSession()

    fun forgetSession() {
        jar.clear()
        val cm = CookieManager.getInstance()
        cm.removeAllCookies(null)
        cm.flush()
    }

    /** Gives the web view the cookies of the session, so a page of the site opens already signed in. */
    fun syncToWebView() {
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        for (c in jar.cookiesFor(Config.BASE.toHttpUrl())) cm.setCookie(Config.BASE, c.toString())
        cm.flush()
    }

    private fun errorKey(body: String): String =
        try {
            val o: JsonObject = json.parseToJsonElement(body).jsonObject
            o["message"]?.jsonPrimitive?.content ?: o["error"]?.jsonPrimitive?.content ?: "error"
        } catch (e: Exception) {
            "error"
        }

    private suspend fun run(req: Request): String = withContext(Dispatchers.IO) {
        client.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw ApiException(res.code, errorKey(text))
            text
        }
    }

    private fun url(path: String) = Config.BASE + path

    /** Reads the answer into its type OFF the screen's thread: a big answer (a conversation) parsed on it makes the screen stutter. */
    private suspend inline fun <reified T> parse(text: String): T = withContext(Dispatchers.Default) { json.decodeFromString<T>(text) }

    private suspend fun get(path: String): String = run(Request.Builder().url(url(path)).header("Cache-Control", "no-cache").get().build())

    private suspend fun post(path: String, body: String = "{}"): String = run(Request.Builder().url(url(path)).post(body.toRequestBody(jsonType)).build())

    private suspend fun delete(path: String): String = run(Request.Builder().url(url(path)).delete().build())

    suspend fun login(identifier: String, password: String): LoginResult {
        return parse(post("/api/auth/login", json.encodeToString(LoginBody(identifier.trim(), password))))
    }

    /** Signs the phone in as a device of the person: the key the live line (StreamService) uses. */
    suspend fun registerDevice(): DeviceKey = parse(post("/api/me/app-devices", json.encodeToString(DeviceBody(Build.MODEL ?: "Android"))))

    suspend fun removeDevice(id: String) {
        if (id.isNotEmpty()) runCatching { delete("/api/me/app-devices/$id") }
    }

    suspend fun logout() {
        runCatching { post("/api/auth/logout") }
    }

    /** Throws ApiException(401) when the session is gone. */
    suspend fun checkSession() {
        get("/api/me")
    }

    suspend fun home(): Home = parse(get("/api/chat/home"))

    suspend fun conversation(id: String): Conversation = parse(get("/api/chat/conversations/$id?limit=30"))

    suspend fun send(id: String, body: String, clientId: String) {
        post("/api/chat/conversations/$id/messages", json.encodeToString(SendBody(body, clientId)))
    }

    suspend fun markRead(id: String) {
        runCatching { post("/api/chat/conversations/$id/read") }
    }

    suspend fun startCall(id: String): CallStarted = parse(post("/api/chat/conversations/$id/call", json.encodeToString(StartCallBody())))

    suspend fun notifications(): Notifications = parse(get("/api/notifications"))

    suspend fun readAllNotifications() {
        runCatching { post("/api/notifications/read", json.encodeToString(ReadAll())) }
    }

    suspend fun readNotification(id: String) {
        runCatching { post("/api/notifications/read", json.encodeToString(ReadOne(id))) }
    }

    suspend fun chatUnread(): Int = runCatching { parse<UnreadTotal>(get("/api/chat/unread")).total }.getOrDefault(0)
}

/** The session cookies, kept on the phone between launches. */
class PrefsCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("zaki-cookies", Context.MODE_PRIVATE)
    private val cookies = linkedMapOf<String, Cookie>()

    init {
        for ((key, value) in prefs.all) {
            val raw = value as? String ?: continue
            val parts = raw.split("\u0001")
            if (parts.size < 8) continue
            val b = Cookie.Builder().name(parts[0]).value(parts[1]).path(parts[3]).expiresAt(parts[4].toLongOrNull() ?: Long.MAX_VALUE)
            if (parts[6] == "1") b.hostOnlyDomain(parts[2]) else b.domain(parts[2])
            if (parts[5] == "1") b.secure()
            if (parts[7] == "1") b.httpOnly()
            cookies[key] = b.build()
        }
    }

    private fun keyOf(c: Cookie) = "${c.name}|${c.domain}|${c.path}"

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val editor = prefs.edit()
        for (c in cookies) {
            val key = keyOf(c)
            if (c.expiresAt < System.currentTimeMillis()) {
                this.cookies.remove(key)
                editor.remove(key)
            } else {
                this.cookies[key] = c
                editor.putString(key, listOf(c.name, c.value, c.domain, c.path, c.expiresAt, if (c.secure) "1" else "0", if (c.hostOnly) "1" else "0", if (c.httpOnly) "1" else "0").joinToString("\u0001"))
            }
        }
        editor.apply()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> = cookiesFor(url)

    @Synchronized
    fun cookiesFor(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        return cookies.values.filter { it.expiresAt > now && it.matches(url) }
    }

    @Synchronized
    fun hasSession(): Boolean = cookies.values.any { it.expiresAt > System.currentTimeMillis() && it.httpOnly }

    @Synchronized
    fun clear() {
        cookies.clear()
        prefs.edit().clear().apply()
    }
}
