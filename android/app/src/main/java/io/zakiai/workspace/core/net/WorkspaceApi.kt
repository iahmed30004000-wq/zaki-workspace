package io.zakiai.workspace.core.net

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The site's own API — the same routes the website calls (src/app/api). Nothing here exists only for the phone except
 * `/api/client-errors` (the crash reports). The session is the site's cookie, kept by [EncryptedCookieJar].
 */
interface WorkspaceApi {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginBody): LoginResult

    @POST("api/auth/logout")
    suspend fun logout(@Body body: Map<String, String> = emptyMap()): Ok

    @GET("api/me")
    suspend fun me(): MeAnswer

    @POST("api/me/password")
    suspend fun changePassword(@Body body: PasswordChangeBody): Ok

    @POST("api/me/transparency")
    suspend fun acceptNotice(@Body body: AcceptBody = AcceptBody()): Ok

    @POST("api/me/theme")
    suspend fun saveTheme(@Body body: ThemeBody): Ok

    @GET("api/workspaces")
    suspend fun spaces(): Spaces

    /**
     * Enters a space (the site's own switcher: `/go` sets the space cookie, then sends the browser on). `next` is the lightest page
     * there is, so the redirect costs a small JSON answer, not a whole page.
     */
    @GET("go")
    suspend fun enterSpace(@Query("space") id: String, @Query("next") next: String = "/api/me"): retrofit2.Response<okhttp3.ResponseBody>

    @POST("api/me/app-devices")
    suspend fun registerDevice(@Body body: DeviceBody): DeviceKey

    @DELETE("api/me/app-devices/{id}")
    suspend fun removeDevice(@Path("id") id: String): Ok

    @GET("api/chat/home")
    suspend fun chatHome(@Header("Cache-Control") cache: String = "no-cache"): ChatHome

    @GET("api/chat/conversations/{id}")
    suspend fun conversation(@Path("id") id: String, @Query("limit") limit: Int = 30, @Header("Cache-Control") cache: String = "no-cache"): Conversation

    @POST("api/chat/conversations/{id}/messages")
    suspend fun send(@Path("id") id: String, @Body body: SendBody): Ok

    @POST("api/chat/conversations/{id}/read")
    suspend fun markRead(@Path("id") id: String, @Body body: Map<String, String> = emptyMap()): Ok

    @POST("api/chat/conversations/{id}/join")
    suspend fun join(@Path("id") id: String, @Body body: Map<String, String> = emptyMap()): Ok

    @POST("api/chat/conversations/{id}/call")
    suspend fun startCall(@Path("id") id: String, @Body body: StartCallBody = StartCallBody()): CallStarted

    @GET("api/chat/unread")
    suspend fun chatUnread(): UnreadTotal

    @GET("api/notifications")
    suspend fun notifications(): Notifications

    @POST("api/notifications/read")
    suspend fun readAll(@Body body: ReadAll = ReadAll()): Ok

    @POST("api/notifications/read")
    suspend fun readOne(@Body body: ReadOne): Ok

    @POST("api/client-errors")
    suspend fun clientErrors(@Body body: ClientErrorBatch): Ok
}
