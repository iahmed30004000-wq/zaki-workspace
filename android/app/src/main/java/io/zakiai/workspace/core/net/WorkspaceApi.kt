package io.zakiai.workspace.core.net

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

    // ── the chat, as the site's v2 chat reads it (N1) ─────────────────────────────────────────────────────

    @GET("api/chat/list")
    suspend fun chatList(@Header("Cache-Control") cache: String = "no-cache"): ChatList

    @PUT("api/chat/conversations/{id}/me")
    suspend fun myState(@Path("id") id: String, @Body body: MyChatState): MyChatStateAnswer

    @PUT("api/chat/conversations/{id}/me")
    suspend fun myStateRaw(@Path("id") id: String, @Body body: kotlinx.serialization.json.JsonObject): MyChatStateAnswer

    @GET("api/me/chat-prefs")
    suspend fun chatPrefs(): ChatPrefsAnswer

    @GET("api/chat/conversations/{id}/header")
    suspend fun header(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-cache"): ConversationHeader

    /** One window, oldest first: no cursor = the newest; at most one of `before` / `after` / `around`. */
    @GET("api/chat/conversations/{id}/messages")
    suspend fun messages(
        @Path("id") id: String,
        @Query("before") before: String? = null,
        @Query("after") after: String? = null,
        @Query("around") around: String? = null,
        @Query("limit") limit: Int = 50,
        @Header("Cache-Control") cache: String = "no-cache",
    ): MessagesPage

    @GET("api/chat/conversations/{id}")
    suspend fun people(@Path("id") id: String, @Query("limit") limit: Int = 1): ConversationPeople

    @POST("api/chat/conversations/{id}/messages")
    suspend fun sendMessage(@Path("id") id: String, @Body body: ChatSend): Message

    /** The read mark moves up to `upTo` (never back) and clears my «علّم كغير مقروء». */
    @POST("api/chat/conversations/{id}/read")
    suspend fun readUpTo(@Path("id") id: String, @Query("upTo") upTo: String, @Body body: Map<String, String> = emptyMap()): Ok

    @PATCH("api/chat/messages/{id}")
    suspend fun edit(@Path("id") id: String, @Body body: EditBody): Message

    @DELETE("api/chat/messages/{id}")
    suspend fun deleteForAll(@Path("id") id: String): Ok

    @POST("api/chat/messages/{id}/hide")
    suspend fun hideForMe(@Path("id") id: String, @Body body: Map<String, String> = emptyMap()): Ok

    /** A toggle: the same emoji again takes it back. */
    @POST("api/chat/messages/{id}/react")
    suspend fun react(@Path("id") id: String, @Body body: ReactBody): ReactAnswer

    @POST("api/chat/messages/{id}/pin")
    suspend fun pin(@Path("id") id: String, @Body body: Map<String, String> = emptyMap()): PinAnswer

    @POST("api/chat/messages/{id}/forward")
    suspend fun forward(@Path("id") id: String, @Body body: ForwardBody): IdAnswer

    @GET("api/chat/forward-targets")
    suspend fun forwardTargets(): ForwardTargets

    @PUT("api/chat/messages/{id}/poll/vote")
    suspend fun vote(@Path("id") id: String, @Body body: VoteBody): Message

    @POST("api/chat/messages/{id}/poll/close")
    suspend fun closePoll(@Path("id") id: String, @Body body: Map<String, String> = emptyMap()): Message

    @POST("api/chat/messages/{id}/checklist/items")
    suspend fun addItem(@Path("id") id: String, @Body body: ItemText): Message

    @PUT("api/chat/messages/{id}/checklist/items/{item}")
    suspend fun tick(@Path("id") id: String, @Path("item") item: String, @Body body: TickBody): Message

    @POST("api/rt/typing")
    suspend fun typing(@Body body: TypingBody): retrofit2.Response<Unit>

    /** Everything that changed after `after` (no `after`: only the current cursor). */
    @GET("api/chat/sync")
    suspend fun sync(@Query("after") after: String? = null, @Query("limit") limit: Int = 200, @Header("Cache-Control") cache: String = "no-cache"): SyncAnswer

    @Multipart
    @POST("api/chat/uploads")
    suspend fun upload(
        @Part file: okhttp3.MultipartBody.Part,
        @Part("kind") kind: okhttp3.RequestBody,
        @Part("durationMs") durationMs: okhttp3.RequestBody? = null,
        @Part("peaks") peaks: okhttp3.RequestBody? = null,
    ): Uploaded

    @GET("api/search")
    suspend fun search(@Query("q") q: String, @Query("scope") scope: String = "chat", @Query("conversationId") conversationId: String? = null): SearchAnswer

    @POST("api/chat/dm")
    suspend fun openDm(@Body body: DmBody): IdAnswer

    @POST("api/chat/conversations")
    suspend fun newGroup(@Body body: NewGroupBody): IdAnswer

    @PATCH("api/chat/conversations/{id}")
    suspend fun changeGroup(@Path("id") id: String, @Body body: GroupChange): Ok

    @DELETE("api/chat/conversations/{id}")
    suspend fun leave(@Path("id") id: String): Ok

    @GET("api/chat/spaces/{spaceId}/topics")
    suspend fun spaceTopics(@Path("spaceId") spaceId: String, @Header("Cache-Control") cache: String = "no-cache"): SpaceTopics

    @POST("api/chat/spaces/{spaceId}/topics")
    suspend fun newTopic(@Path("spaceId") spaceId: String, @Body body: NewTopicBody): IdAnswer

    @GET("api/chat/directory")
    suspend fun directory(@Query("scope") scope: String? = null): Directory

    @GET("api/notifications")
    suspend fun notifications(): Notifications

    @POST("api/notifications/read")
    suspend fun readAll(@Body body: ReadAll = ReadAll()): Ok

    @POST("api/notifications/read")
    suspend fun readOne(@Body body: ReadOne): Ok

    @POST("api/client-errors")
    suspend fun clientErrors(@Body body: ClientErrorBatch): Ok
}
