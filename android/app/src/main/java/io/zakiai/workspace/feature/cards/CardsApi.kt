package io.zakiai.workspace.feature.cards

import androidx.compose.runtime.Immutable
import io.zakiai.workspace.core.net.StatusBody
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/*
 * «اللوحات» (M2 N6 batch 4) — what the site's own card routes answer (src/app/api/cards/..., src/lib/cards/shared.ts + page.ts).
 * No door was needed: every screen of the site reads these same routes. Only the fields the phone draws; the rest is ignored.
 */

@Serializable
data class CardFile(val name: String = "", val mimeType: String = "", val size: Long = 0)

@Immutable
@Serializable
data class CardItem(
    val id: String = "",
    val kind: String = "NOTE",
    val title: String = "",
    val body: String? = null,
    /** the list's items, the link's url, the table (null for the kinds with none) */
    val data: JsonElement? = null,
    val color: String = "none",
    val category: String? = null,
    val tags: List<String> = emptyList(),
    val pinned: Boolean = false,
    val position: Double = 0.0,
    val fileId: String? = null,
    val file: CardFile? = null,
    val archivedAt: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
    val createdById: String = "",
    val createdByName: String = "",
    val status: String = "DRAFT",
    val version: Int = 1,
    val coverFileId: String? = null,
)

@Serializable
data class CardList(val cards: List<CardItem> = emptyList(), val canWrite: Boolean = false, val owner: Boolean = false)

@Serializable
data class CardAbilities(
    val write: Boolean = false,
    val participate: Boolean = false,
    val moderate: Boolean = false,
    val gallery: Boolean = false,
    val seeRaters: Boolean = false,
    val internal: Boolean = false,
    val oversight: Boolean = false,
    val restore: Boolean = false,
    val statusMoves: List<String> = emptyList(),
)

@Serializable
data class RaterRow(val userId: String = "", val name: String = "", val stars: Int = 0)

@Serializable
data class RatingView(val average: Double? = null, val count: Int = 0, val mine: Int? = null, val raters: List<RaterRow>? = null)

@Immutable
@Serializable
data class GalleryItem(val id: String = "", val fileId: String = "", val caption: String? = null, val isCover: Boolean = false, val file: CardFile = CardFile())

@Serializable
data class CardPageData(
    val card: CardItem = CardItem(),
    val abilities: CardAbilities = CardAbilities(),
    val rating: RatingView? = null,
    val gallery: List<GalleryItem> = emptyList(),
    val spaceId: String = "",
    val spaceName: String = "",
)

@Immutable
@Serializable
data class NoteItem(
    val id: String = "",
    val authorId: String = "",
    val authorName: String = "",
    val body: String = "",
    val visibility: String = "PUBLIC",
    val createdAt: String = "",
    val editedAt: String? = null,
)

@Serializable
data class NotesView(val publicNotes: List<NoteItem>? = null, val privateNotes: List<NoteItem> = emptyList())

@Immutable
@Serializable
data class RevisionItem(
    val version: Int = 0,
    val title: String = "",
    val body: String? = null,
    val editorName: String = "",
    val createdAt: String = "",
)

@Serializable
data class RevisionsView(val currentVersion: Int = 1, val revisions: List<RevisionItem> = emptyList())

@Immutable
@Serializable
data class LogEntry(val id: String = "", val action: String = "", val at: String = "", val actorName: String? = null, val detail: JsonObject = JsonObject(emptyMap()))

@Serializable
data class LogAnswer(val entries: List<LogEntry> = emptyList())

@Serializable
data class LinkedTask(val id: String = "", val title: String = "", val key: String = "")

@Serializable
data class LinkedTopic(val conversationId: String = "", val messageId: String? = null, val title: String = "", val emoji: String? = null)

@Serializable
data class LinksView(val tasks: List<LinkedTask> = emptyList(), val topics: List<LinkedTopic> = emptyList())

@Serializable
data class CardTopic(val id: String = "", val title: String = "", val emoji: String? = null)

@Serializable
data class CardTopics(val topics: List<CardTopic> = emptyList())

@Serializable
data class NamedRow(val id: String = "", val name: String = "")

@Serializable
data class ProjectsOf(val projects: List<NamedRow> = emptyList())

@Serializable
data class BoardsOf(val boards: List<NamedRow> = emptyList())

@Serializable
data class CardAnswer(val card: CardItem = CardItem())

@Serializable
data class NewCardBody(
    val spaceId: String,
    val kind: String,
    val title: String,
    val body: String? = null,
    val data: JsonElement? = null,
    val color: String,
    val category: String? = null,
    val tags: List<String>,
    val pinned: Boolean,
)

/** An edit: a null field is not sent (the server keeps it). An empty text clears it (the server reads "" as none). */
@Serializable
data class CardPatch(
    val version: Int? = null,
    val title: String? = null,
    val body: String? = null,
    val data: JsonElement? = null,
    val color: String? = null,
    val category: String? = null,
    val tags: List<String>? = null,
    val pinned: Boolean? = null,
)

@Serializable
data class NoteBody(val body: String, val visibility: String)

@Serializable
data class NoteEdit(val body: String)

@Serializable
data class StarsBody(val stars: Int)

@Serializable
data class SendBody(val conversationId: String)

@Serializable
data class TaskBody(val projectId: String, val boardId: String)

@Serializable
data class VersionBody(val version: Int)

/** The site's card routes, as they are (src/app/api/cards/...). Who may do what is decided there, on every call. */
interface CardsApi {
    @GET("api/cards")
    suspend fun list(@Query("spaceId") spaceId: String, @Query("archived") archived: String?, @Header("Cache-Control") cache: String = "no-store"): CardList

    @POST("api/cards")
    suspend fun create(@Body body: NewCardBody): CardAnswer

    @GET("api/cards/{id}/page")
    suspend fun page(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): CardPageData

    @PATCH("api/cards/{id}")
    suspend fun patch(@Path("id") id: String, @Body body: CardPatch): CardAnswer

    @DELETE("api/cards/{id}")
    suspend fun archive(@Path("id") id: String): JsonObject

    @POST("api/cards/{id}/restore")
    suspend fun restore(@Path("id") id: String): JsonObject

    @POST("api/cards/{id}/duplicate")
    suspend fun duplicate(@Path("id") id: String): CardAnswer

    @PUT("api/cards/{id}/status")
    suspend fun status(@Path("id") id: String, @Body body: StatusBody): CardAnswer

    @PUT("api/cards/{id}/rating")
    suspend fun rate(@Path("id") id: String, @Body body: StarsBody): JsonObject

    @GET("api/cards/{id}/notes")
    suspend fun notes(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): NotesView

    @POST("api/cards/{id}/notes")
    suspend fun addNote(@Path("id") id: String, @Body body: NoteBody): JsonObject

    @PATCH("api/cards/{id}/notes/{note}")
    suspend fun editNote(@Path("id") id: String, @Path("note") note: String, @Body body: NoteEdit): JsonObject

    @DELETE("api/cards/{id}/notes/{note}")
    suspend fun deleteNote(@Path("id") id: String, @Path("note") note: String): JsonObject

    @GET("api/cards/{id}/revisions")
    suspend fun revisions(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): RevisionsView

    @POST("api/cards/{id}/revisions/{version}/restore")
    suspend fun restoreRevision(@Path("id") id: String, @Path("version") version: Int, @Body body: VersionBody): CardAnswer

    @GET("api/cards/{id}/log")
    suspend fun log(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): LogAnswer

    @GET("api/cards/{id}/links")
    suspend fun links(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): LinksView

    @GET("api/cards/topics")
    suspend fun topics(@Query("spaceId") spaceId: String): CardTopics

    @POST("api/cards/{id}/send")
    suspend fun send(@Path("id") id: String, @Body body: SendBody): JsonObject

    @GET("api/projects")
    suspend fun projects(@Query("workspaceId") workspaceId: String): ProjectsOf

    @GET("api/projects/{id}/boards")
    suspend fun boards(@Path("id") id: String): BoardsOf

    @POST("api/cards/{id}/task")
    suspend fun toTask(@Path("id") id: String, @Body body: TaskBody): JsonObject
}
