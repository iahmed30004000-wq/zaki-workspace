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

    // ── «اليوم», «مهامي» and one task (N2) ──────────────────────────────────────────────────────────────────

    @GET("api/today")
    suspend fun today(@Header("Cache-Control") cache: String = "no-cache"): TodayAnswer

    @GET("api/my-work")
    suspend fun myWork(@Query("tab") tab: String, @Header("Cache-Control") cache: String = "no-cache"): MyWorkAnswer

    @GET("api/tasks/{id}/sheet")
    suspend fun taskSheet(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-cache"): TaskSheet

    @POST("api/tasks/{id}/complete")
    suspend fun complete(@Path("id") id: String, @Body body: CompleteBody): TaskAnswer

    @POST("api/tasks/{id}/move")
    suspend fun move(@Path("id") id: String, @Body body: MoveBody): TaskAnswer

    @PATCH("api/tasks/{id}")
    suspend fun patchTask(@Path("id") id: String, @Body body: TaskPatch): TaskAnswer

    /** A due date set («YYYY-MM-DD») or cleared (`null` written out). */
    @PATCH("api/tasks/{id}")
    suspend fun patchTaskRaw(@Path("id") id: String, @Body body: kotlinx.serialization.json.JsonObject): TaskAnswer

    @POST("api/tasks")
    suspend fun newTask(@Body body: NewTaskBody): TaskAnswer

    @POST("api/tasks/{id}/steps")
    suspend fun addStep(@Path("id") id: String, @Body body: StepTitle): kotlinx.serialization.json.JsonObject

    @PATCH("api/tasks/{id}/steps/{step}")
    suspend fun patchStep(@Path("id") id: String, @Path("step") step: String, @Body body: StepPatch): kotlinx.serialization.json.JsonObject

    @DELETE("api/tasks/{id}/steps/{step}")
    suspend fun deleteStep(@Path("id") id: String, @Path("step") step: String): Ok

    @POST("api/tasks/{id}/comments")
    suspend fun addComment(@Path("id") id: String, @Body body: CommentBody): kotlinx.serialization.json.JsonObject

    @DELETE("api/tasks/{id}/comments/{comment}")
    suspend fun deleteComment(@Path("id") id: String, @Path("comment") comment: String): Ok

    @POST("api/tasks/{id}/request/accept")
    suspend fun acceptRequest(@Path("id") id: String, @Body body: AcceptBody2): kotlinx.serialization.json.JsonObject

    @POST("api/tasks/{id}/request/return")
    suspend fun returnRequest(@Path("id") id: String, @Body body: ReturnBody): kotlinx.serialization.json.JsonObject

    @GET("api/reminders")
    suspend fun reminders(@Header("Cache-Control") cache: String = "no-cache"): Reminders

    @POST("api/reminders")
    suspend fun addReminder(@Body body: NewReminder): kotlinx.serialization.json.JsonObject

    @DELETE("api/reminders/{id}")
    suspend fun dismissReminder(@Path("id") id: String): Ok

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

    // ── «المشاريع» (M2 N3): the shared doors of the projects pages, then the site's own write routes ──
    @GET("api/work/projects")
    suspend fun workProjects(@Header("Cache-Control") cache: String = "no-cache"): ProjectsAnswer

    @GET("api/work/projects/{id}")
    suspend fun workProject(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-cache"): ProjectAnswer

    @GET("api/work/boards/{id}")
    suspend fun workBoard(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-cache"): BoardAnswer

    @POST("api/projects")
    suspend fun newProject(@Body body: NewProjectBody): NewProjectAnswer

    @POST("api/boards")
    suspend fun newBoard(@Body body: NewBoardBody): NewBoardAnswer

    @POST("api/boards/{id}/columns")
    suspend fun newColumn(@Path("id") boardId: String, @Body body: NewColumnBody): ColumnAnswer

    @GET("api/projects/{id}/timeline")
    suspend fun timeline(@Path("id") projectId: String, @Header("Cache-Control") cache: String = "no-cache"): TimelineAnswer

    @GET("api/projects/{id}/milestones")
    suspend fun milestones(@Path("id") projectId: String, @Header("Cache-Control") cache: String = "no-cache"): MilestonesAnswer

    @POST("api/projects/{id}/milestones")
    suspend fun newMilestone(@Path("id") projectId: String, @Body body: NewMilestoneBody): kotlinx.serialization.json.JsonObject

    @PATCH("api/milestones/{id}")
    suspend fun milestoneStatus(@Path("id") id: String, @Body body: MilestoneStatusBody): kotlinx.serialization.json.JsonObject

    @GET("api/goals")
    suspend fun goals(@Header("Cache-Control") cache: String = "no-cache"): GoalsAnswer

    @PATCH("api/goals/{id}")
    suspend fun goalProgress(@Path("id") id: String, @Body body: GoalProgressBody): kotlinx.serialization.json.JsonObject

    // ── «المكتبة» (M2 N4): the site's own routes, as the pages call them ──
    @GET("api/files")
    suspend fun libraryFiles(@Header("Cache-Control") cache: String = "no-cache"): FilesAnswer

    @Multipart
    @POST("api/files")
    suspend fun uploadLibrary(@Part file: okhttp3.MultipartBody.Part): UploadedFile

    @DELETE("api/files/{id}")
    suspend fun deleteFile(@Path("id") id: String): Ok

    @GET("api/documents")
    suspend fun documents(@Query("spaceId") spaceId: String, @Header("Cache-Control") cache: String = "no-cache"): DocsAnswer

    @POST("api/documents")
    suspend fun newDocument(@Body body: NewDocBody): DocAnswer

    @GET("api/documents/{id}")
    suspend fun document(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-cache"): DocAnswer

    @PATCH("api/documents/{id}")
    suspend fun saveDocument(@Path("id") id: String, @Body body: SaveDocBody): DocAnswer

    @GET("api/knowledge")
    suspend fun knowledge(@Header("Cache-Control") cache: String = "no-cache"): SheetsAnswer

    @GET("api/knowledge/{id}")
    suspend fun sheet(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-cache"): SheetAnswer

    @DELETE("api/notifications/{id}")
    suspend fun deleteNotification(@Path("id") id: String): Ok

    // ── calls (M2 N5): the site's own call routes; the media goes to the site's LiveKit room ──
    @GET("api/calls/{id}")
    suspend fun callDetail(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-cache"): CallDetail

    @POST("api/calls/{id}/token")
    suspend fun callToken(@Path("id") id: String, @Body body: CallTokenBody = CallTokenBody()): CallPass

    @POST("api/calls/{id}/joined")
    suspend fun callJoined(@Path("id") id: String, @Body body: kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.JsonObject(emptyMap())): Ok

    @POST("api/calls/{id}/leave")
    suspend fun callLeave(@Path("id") id: String, @Body body: kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.JsonObject(emptyMap())): Ok

    @POST("api/calls/{id}/decline")
    suspend fun callDecline(@Path("id") id: String, @Body body: kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.JsonObject(emptyMap())): Ok

    @POST("api/calls/{id}/end")
    suspend fun callEnd(@Path("id") id: String, @Body body: kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.JsonObject(emptyMap())): Ok

    @POST("api/calls/{id}/mute")
    suspend fun callMute(@Path("id") id: String, @Body body: CallUserBody): Ok

    // ── M2 N6 batch 1: «الأفكار», «التسجيل اليومي», «الموافقات» — the site's own routes ──
    @GET("api/ideas")
    suspend fun ideas(@Header("Cache-Control") cache: String = "no-cache"): IdeasAnswer

    @POST("api/ideas")
    suspend fun newIdea(@Body body: NewIdeaBody): kotlinx.serialization.json.JsonObject

    @POST("api/ideas/{id}/vote")
    suspend fun voteIdea(@Path("id") id: String, @Body body: kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.JsonObject(emptyMap())): kotlinx.serialization.json.JsonObject

    @GET("api/checkins/today")
    suspend fun checkinToday(@Query("workspaceId") workspaceId: String?, @Header("Cache-Control") cache: String = "no-cache"): CheckinToday

    @POST("api/checkins/answer")
    suspend fun checkinAnswer(@Body body: CheckinAnswerBody): kotlinx.serialization.json.JsonObject

    @POST("api/checkins/excuse")
    suspend fun checkinExcuse(@Body body: CheckinExcuseBody): kotlinx.serialization.json.JsonObject

    @GET("api/approvals")
    suspend fun approvals(@Query("view") view: String, @Query("workspaceId") workspaceId: String?, @Header("Cache-Control") cache: String = "no-cache"): ApprovalsAnswer

    @GET("api/approvals/{id}")
    suspend fun approval(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-cache"): ApprovalDetailAnswer

    @POST("api/approvals/{id}/decide")
    suspend fun decideApproval(@Path("id") id: String, @Body body: DecideBody): kotlinx.serialization.json.JsonObject

    @POST("api/approvals/{id}/cancel")
    suspend fun cancelApproval(@Path("id") id: String, @Body body: kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.JsonObject(emptyMap())): kotlinx.serialization.json.JsonObject

    // ── M2 N6 batch 2: «التقويم», «الناس», a profile, «تقرير الوقت», «التذاكر» ──
    @GET("api/calendar")
    suspend fun calendar(@Query("month") month: String?, @Query("mine") mine: String?, @Header("Cache-Control") cache: String = "no-cache"): CalendarAnswer

    @GET("api/people")
    suspend fun staff(@Header("Cache-Control") cache: String = "no-cache"): PeopleAnswer

    @GET("api/users/{id}")
    suspend fun profile(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-cache"): ProfileAnswer

    @GET("api/time/report")
    suspend fun timeReport(
        @Query("from") from: String?,
        @Query("to") to: String?,
        @Query("userId") userId: String?,
        @Query("projectId") projectId: String?,
        @Query("workspaceId") workspaceId: String?,
        @Query("format") format: String = "json",
        @Header("Cache-Control") cache: String = "no-cache",
    ): TimeReport

    @GET("api/tickets/mine")
    suspend fun myTickets(@Header("Cache-Control") cache: String = "no-cache"): TicketsAnswer

    @GET("api/departments")
    suspend fun departments(@Header("Cache-Control") cache: String = "no-cache"): DepartmentsAnswer

    @GET("api/departments/{id}/tickets")
    suspend fun departmentTickets(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-cache"): TicketsAnswer

    @POST("api/departments/{id}/tickets")
    suspend fun newTicket(@Path("id") id: String, @Body body: NewTicketBody): kotlinx.serialization.json.JsonObject

    @GET("api/tickets/{id}/detail")
    suspend fun ticket(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): TicketDetailAnswer

    @PATCH("api/tickets/{id}")
    suspend fun patchTicket(@Path("id") id: String, @Body body: TicketPatch): kotlinx.serialization.json.JsonObject

    @POST("api/tickets/{id}/detail")
    suspend fun commentTicket(@Path("id") id: String, @Body body: CommentBody): kotlinx.serialization.json.JsonObject
}
