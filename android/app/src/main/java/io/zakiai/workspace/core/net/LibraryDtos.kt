package io.zakiai.workspace.core.net

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/*
 * «المكتبة» (M2 N4) — what the site's own routes answer: GET /api/files (the space's library), /api/documents and /api/documents/[id],
 * /api/knowledge and /api/knowledge/[id]. Only the fields the phone draws; a field the server adds later is ignored.
 */

// ── the space's library (GET /api/files) ──────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class LibFile(
    val id: String = "",
    val familyId: String = "",
    val name: String = "",
    val mimeType: String = "",
    val size: Long = 0,
    val version: Int = 1,
    val versions: Int = 1,
    val previewable: Boolean = false,
    val uploader: String = "",
    val uploaderId: String = "",
    val createdAt: String = "",
)

@Serializable
data class LibStorage(val target: String = "server", val reason: String? = null)

@Serializable
data class LibSpace(val id: String = "", val name: String = "")

@Serializable
data class FilesAnswer(
    val files: List<LibFile> = emptyList(),
    val onDrive: Boolean = false,
    val storage: LibStorage = LibStorage(),
    val space: LibSpace? = null,
)

@Serializable
data class UploadedFile(val id: String = "", val version: Int = 1, val mimeType: String = "")

// ── documents (GET /api/documents?spaceId=, GET/PATCH /api/documents/[id]) ────────────────────────────────

@Immutable
@Serializable
data class DocRow(
    val id: String = "",
    val title: String = "",
    val excerpt: String = "",
    val version: Int = 1,
    val sharedWithPartners: Boolean = false,
    val updatedAt: String = "",
    val authorName: String? = null,
)

@Serializable
data class DocsAnswer(val documents: List<DocRow> = emptyList(), val canCreate: Boolean = false, val spaceId: String = "")

@Serializable
data class DocPerson(val id: String = "", val name: String = "")

@Serializable
data class DocItem(
    val id: String = "",
    val spaceId: String = "",
    val title: String = "",
    val content: String = "",
    val version: Int = 1,
    val sharedWithPartners: Boolean = false,
    val updatedAt: String = "",
    val authorName: String? = null,
    val lastEditorName: String? = null,
    val archived: Boolean = false,
    val canWrite: Boolean = false,
    val canManage: Boolean = false,
    val people: List<DocPerson> = emptyList(),
)

@Serializable
data class DocAnswer(val document: DocItem = DocItem())

@Serializable
data class NewDocBody(val spaceId: String, val title: String, val content: String? = null)

@Serializable
data class SaveDocBody(val version: Int, val title: String? = null, val content: String? = null)

// ── «المنتجات» (GET /api/knowledge, /api/knowledge/[id]) ──────────────────────────────────────────────────

@Immutable
@Serializable
data class SheetRow(
    val id: String = "",
    val name: String = "",
    val category: String? = null,
    val tagline: String = "",
    val badges: List<String> = emptyList(),
    val stockStatus: String? = null,
    val price: Double? = null,
    val currency: String? = null,
    val stale: Boolean = false,
    val missing: Boolean = false,
    val status: String = "APPROVED",
)

@Serializable
data class SheetsAnswer(
    val configured: Boolean = false,
    val canEdit: Boolean = false,
    val isOwner: Boolean = false,
    val sheets: List<SheetRow> = emptyList(),
)

@Serializable
data class SheetSection(val key: String = "", val title: String = "", val kind: String = "text", val text: String? = null, val items: List<String> = emptyList())

@Serializable
data class SheetFaq(val q: String = "", val a: String = "")

@Serializable
data class SheetData(
    val tagline: String = "",
    val badges: List<String> = emptyList(),
    val sections: List<SheetSection> = emptyList(),
    val faq: List<SheetFaq> = emptyList(),
    val testNote: String? = null,
)

@Serializable
data class SheetExternal(
    val price: Double? = null,
    val currency: String? = null,
    val stockStatus: String? = null,
    val stale: Boolean = false,
    val link: String? = null,
)

@Serializable
data class SheetItem(
    val id: String = "",
    val name: String = "",
    val category: String? = null,
    val data: SheetData? = null,
    val external: SheetExternal? = null,
    val status: String = "APPROVED",
)

@Serializable
data class SheetAnswer(val sheet: SheetItem = SheetItem())
