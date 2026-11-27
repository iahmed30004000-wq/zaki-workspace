package io.zakiai.workspace.feature.me

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path

/*
 * «إعداداتي» (M2 N6 batch 5) — the site's own routes of the person's settings (src/app/api/me/...), and the one door the phone needed,
 * `GET /api/me/settings` (the facts the site's page reads on the server). Only the fields the phone draws.
 */

@Serializable
data class SettingsFeatures(
    val avatars: Boolean = false,
    val chatAutomation: Boolean = false,
    val lastSeen: Boolean = false,
    val appConnection: Boolean = false,
    val chatFolders: Boolean = false,
)

@Serializable
data class SettingsFacts(
    val external: Boolean = false,
    val usernameManaged: Boolean = false,
    val contactOwnerId: String? = null,
    val digits: String = "latin",
    val features: SettingsFeatures = SettingsFeatures(),
)

@Serializable
data class Profile(
    val id: String = "",
    val email: String? = null,
    val username: String? = null,
    val name: String = "",
    val jobTitle: String? = null,
    val bio: String? = null,
    val avatarUrl: String? = null,
    val hue: Int? = null,
)

@Serializable
data class ProfileAnswer(val user: Profile = Profile())

@Serializable
data class ProfileBody(val name: String, val jobTitle: String, val bio: String?)

@Serializable
data class AvatarAnswer(val avatarUrl: String? = null)

@Serializable
data class WorkHours(val days: List<Int> = listOf(0, 1, 2, 3, 4), val from: String = "09:00", val to: String = "17:00", val tz: String = "")

@Serializable
data class AutoReply(val on: Boolean = false, val text: String = "")

@Serializable
data class Automation(val workHours: WorkHours? = null, val chatAutomation: AutoReply = AutoReply())

@Serializable
data class PrefsAnswer(val prefs: JsonObject = JsonObject(emptyMap()), val orgId: String? = null, val foldersOn: Boolean = false)

@Serializable
data class LastSeen(val hide: Boolean = false)

@Serializable
data class DigitsBody(val digits: String)

@Serializable
data class AppDevice(val id: String = "", val name: String = "", val createdAt: String = "", val lastSeenAt: String? = null)

@Serializable
data class AppDevices(val devices: List<AppDevice> = emptyList())

@Serializable
data class PushRow(val id: String = "", val userAgent: String? = null, val createdAt: String = "", val lastUsedAt: String? = null)

@Serializable
data class PushRows(val subscriptions: List<PushRow> = emptyList())

@Serializable
data class SessionRow(val id: String = "", val current: Boolean = false, val createdAt: String = "", val lastSeenAt: String? = null, val userAgent: String? = null)

@Serializable
data class SessionRows(val sessions: List<SessionRow> = emptyList())

@Serializable
data class DmBody(val userId: String)

@Serializable
data class DmAnswer(val id: String = "")

// ── the guide ──

@Serializable
data class GuideEntry(val slug: String = "", val title: String = "", val summary: String = "", val text: String = "", val keywords: List<String> = emptyList(), val badge: Boolean = false)

@Serializable
data class GuideList(val articles: List<GuideEntry> = emptyList())

@Serializable
data class GuideBlock(
    val type: String = "p",
    val text: String = "",
    val title: String? = null,
    val items: List<String> = emptyList(),
    val fix: String = "",
    val keys: List<String> = emptyList(),
)

@Serializable
data class GuideCta(val href: String = "", val label: String = "")

@Serializable
data class GuideArticle(val slug: String = "", val title: String = "", val summary: String = "", val audience: String = "everyone", val blocks: List<GuideBlock> = emptyList(), val cta: GuideCta? = null)

@Serializable
data class GuideRef(val slug: String = "", val title: String = "")

@Serializable
data class GuideAnswer(val article: GuideArticle = GuideArticle(), val prev: GuideRef? = null, val next: GuideRef? = null)

/** The site's routes of «إعداداتي» and «دليل ذكي», as they are: each decides again on the server. */
interface MeApi {
    @GET("api/me/settings")
    suspend fun facts(@Header("Cache-Control") cache: String = "no-store"): SettingsFacts

    @GET("api/me")
    suspend fun profile(@Header("Cache-Control") cache: String = "no-store"): ProfileAnswer

    @PATCH("api/me")
    suspend fun saveProfile(@Body body: ProfileBody): JsonObject

    @Multipart
    @POST("api/me/avatar")
    suspend fun uploadAvatar(@Part file: MultipartBody.Part): AvatarAnswer

    @DELETE("api/me/avatar")
    suspend fun removeAvatar(): JsonObject

    @GET("api/me/automation")
    suspend fun automation(@Header("Cache-Control") cache: String = "no-store"): Automation

    /** `workHours: null` clears the hours: sent as written ([JsonObject]), a null is never dropped */
    @PATCH("api/me/automation")
    suspend fun saveAutomation(@Body body: JsonObject): Automation

    @GET("api/me/chat-prefs")
    suspend fun prefs(@Header("Cache-Control") cache: String = "no-store"): PrefsAnswer

    /** a section sent replaces the whole stored section; `null` resets it: sent as written ([JsonObject]) */
    @PUT("api/me/chat-prefs")
    suspend fun savePrefs(@Body body: JsonObject): PrefsAnswer

    @GET("api/me/last-seen")
    suspend fun lastSeen(@Header("Cache-Control") cache: String = "no-store"): LastSeen

    @PATCH("api/me/last-seen")
    suspend fun saveLastSeen(@Body body: LastSeen): JsonObject

    @POST("api/me/digits")
    suspend fun saveDigits(@Body body: DigitsBody): JsonObject

    @GET("api/me/app-devices")
    suspend fun appDevices(@Header("Cache-Control") cache: String = "no-store"): AppDevices

    @DELETE("api/me/app-devices/{id}")
    suspend fun removeAppDevice(@Path("id") id: String): JsonObject

    @GET("api/me/push")
    suspend fun push(@Header("Cache-Control") cache: String = "no-store"): PushRows

    @DELETE("api/me/push/{id}")
    suspend fun removePush(@Path("id") id: String): JsonObject

    @GET("api/me/sessions")
    suspend fun sessions(@Header("Cache-Control") cache: String = "no-store"): SessionRows

    @DELETE("api/me/sessions/{id}")
    suspend fun endSession(@Path("id") id: String): JsonObject

    @POST("api/me/logout-everywhere")
    suspend fun logoutEverywhere(@Body body: JsonObject = JsonObject(emptyMap())): JsonObject

    @POST("api/chat/dm")
    suspend fun dm(@Body body: DmBody): DmAnswer

    @GET("api/guide")
    suspend fun guide(): GuideList

    @GET("api/guide/{slug}")
    suspend fun article(@Path("slug") slug: String): GuideAnswer
}
