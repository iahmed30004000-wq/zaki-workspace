package io.zakiai.workspace.feature.library

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.zakiai.workspace.core.Cache
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.DocItem
import io.zakiai.workspace.core.net.DocsAnswer
import io.zakiai.workspace.core.net.FilesAnswer
import io.zakiai.workspace.core.net.NewDocBody
import io.zakiai.workspace.core.net.SaveDocBody
import io.zakiai.workspace.core.net.SheetAnswer
import io.zakiai.workspace.core.net.SheetsAnswer
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.work.Screen
import io.zakiai.workspace.feature.work.missingDoor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import javax.inject.Inject

/** The site's one-file limit (src/server/files/sniff.ts `MAX_FILE_BYTES`): known on the phone so a too-big file is refused before it travels. */
const val MAX_FILE_BYTES = 25L * 1024 * 1024

/** «مكتبة مساحة العمل»: the space's files (`GET /api/files`); upload through the site's own `POST /api/files`, delete through `DELETE`. */
@HiltViewModel
class FilesViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: WorkspaceApi,
    private val cache: Cache,
    private val session: Session,
    /** the chat's own fetch-and-open (the session's client, the app's private cache, a temporary read grant): one way to open a file */
    val opener: io.zakiai.workspace.feature.chat.ChatFiles,
) : ViewModel() {
    private val _state = MutableStateFlow(Screen<FilesAnswer>())
    val state: StateFlow<Screen<FilesAnswer>> = _state.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    /** the names being uploaded now (their rows show a spinner) */
    private val _uploading = MutableStateFlow<List<String>>(emptyList())
    val uploading: StateFlow<List<String>> = _uploading.asStateFlow()

    init {
        viewModelScope.launch { cache.read(KEY, FilesAnswer.serializer())?.let { c -> if (_state.value.data == null) _state.value = _state.value.copy(data = c) } }
    }

    fun refresh() = viewModelScope.launch {
        when (val r = cache.refresh(KEY, FilesAnswer.serializer()) { apiCall { api.libraryFiles() } }) {
            is ApiResult.Ok -> _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403 || (r.failure.status == 404 && !r.failure.missingDoor()))
            }
        }
    }

    /** One file at a time, as the site sends them; a camera's HEIC becomes a JPEG (the site's sniffing refuses HEIC). */
    fun upload(uris: List<Uri>) {
        for (uri in uris) viewModelScope.launch {
            val name = nameOf(uri)
            val size = sizeOf(uri)
            if (size != null && size > MAX_FILE_BYTES) { _notice.value = L.tooLarge; return@launch }
            _uploading.value = _uploading.value + name
            val prepared = withContext(Dispatchers.IO) { runCatching { prepare(uri, name) }.getOrNull() }
            if (prepared == null) {
                _uploading.value = _uploading.value - name
                _notice.value = io.zakiai.workspace.feature.chat.C.uploadFailed
                return@launch
            }
            val (bytes, sentName, mime) = prepared
            if (bytes.size > MAX_FILE_BYTES) { _uploading.value = _uploading.value - name; _notice.value = L.tooLarge; return@launch }
            val part = MultipartBody.Part.createFormData("file", sentName, bytes.toRequestBody(mime.toMediaTypeOrNull()))
            val r = apiCall { api.uploadLibrary(part) }
            _uploading.value = _uploading.value - name
            when (r) {
                is ApiResult.Ok -> { _notice.value = L.uploaded; refresh() }
                is ApiResult.Err -> _notice.value = r.failure.message
            }
        }
    }

    fun delete(id: String) = viewModelScope.launch {
        when (val r = apiCall { api.deleteFile(id) }) {
            is ApiResult.Ok -> { _notice.value = L.deleted; refresh() }
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    /** A library file as the chat's attachment shape, so it opens and shares the same way (`/api/files/<id>/raw`, the site's permission check). */
    fun asAttachment(f: io.zakiai.workspace.core.net.LibFile) = io.zakiai.workspace.core.net.Attachment(id = "lib-" + f.id, name = f.name, mime = f.mimeType, size = f.size, url = "/api/files/" + f.id + "/raw")

    fun consumeNotice() { _notice.value = null }

    private fun prepare(uri: Uri, name: String): Triple<ByteArray, String, String> {
        val mime = context.contentResolver.getType(uri).orEmpty()
        if ((mime == "image/heic" || mime == "image/heif") && Build.VERSION.SDK_INT >= 28) {
            val bmp: Bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { d, _, _ -> d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE }
            val out = ByteArrayOutputStream().use { o -> bmp.compress(Bitmap.CompressFormat.JPEG, 90, o); o.toByteArray() }
            return Triple(out, name.substringBeforeLast('.') + ".jpg", "image/jpeg")
        }
        val bytes = context.contentResolver.openInputStream(uri)!!.use { it.readBytes() }
        return Triple(bytes, name, mime.ifEmpty { "application/octet-stream" })
    }

    private fun nameOf(uri: Uri): String = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull() ?: (uri.lastPathSegment ?: "file")

    private fun sizeOf(uri: Uri): Long? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }
    }.getOrNull()

    companion object { const val KEY = "library-files" }
}

/** «المستندات»: the documents of the space the person is in (`GET /api/documents?spaceId=`); «مستند جديد» through `POST /api/documents`. */
@HiltViewModel
class DocsViewModel @Inject constructor(private val api: WorkspaceApi, private val session: Session) : ViewModel() {
    private val _state = MutableStateFlow(Screen<DocsAnswer>())
    val state: StateFlow<Screen<DocsAnswer>> = _state.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    private var spaceId: String? = null

    fun refresh(space: String?) = viewModelScope.launch {
        if (space == null) return@launch
        if (spaceId != space) { spaceId = space; _state.value = Screen() }
        when (val r = apiCall { api.documents(space) }) {
            is ApiResult.Ok -> if (spaceId == space) _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403 || (r.failure.status == 404 && !r.failure.missingDoor()))
            }
        }
    }

    fun create(title: String, then: (String) -> Unit) = viewModelScope.launch {
        val space = spaceId ?: return@launch
        when (val r = apiCall { api.newDocument(NewDocBody(spaceId = space, title = title.trim())) }) {
            is ApiResult.Ok -> then(r.value.document.id)
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun consumeNotice() { _notice.value = null }
}

/**
 * ONE DOCUMENT: read (`GET /api/documents/[id]`), and for whom may write, written with the site's autosave — 1.2 s after the typing stops,
 * with the version it was read at; another person's newer save (409) stops the autosave until the person chooses «خلّي نسختي» (saved over
 * the newest version) or «خذ نسختهم» (theirs loaded, the phone's words dropped).
 */
@HiltViewModel
class DocumentViewModel @Inject constructor(private val api: WorkspaceApi, private val session: Session, handle: SavedStateHandle) : ViewModel() {
    val id: String = checkNotNull(handle["id"])
    private val _state = MutableStateFlow(Screen<DocItem>())
    val state: StateFlow<Screen<DocItem>> = _state.asStateFlow()

    /** what the person typed (null: the document as read) */
    private val _title = MutableStateFlow<String?>(null)
    val title: StateFlow<String?> = _title.asStateFlow()
    private val _content = MutableStateFlow<String?>(null)
    val content: StateFlow<String?> = _content.asStateFlow()

    enum class Save { Idle, Unsaved, Saving, Saved, Error, Conflict }
    private val _save = MutableStateFlow(Save.Idle)
    val save: StateFlow<Save> = _save.asStateFlow()
    private var pending: Job? = null

    fun load() = viewModelScope.launch {
        when (val r = apiCall { api.document(id) }) {
            is ApiResult.Ok -> _state.value = Screen(r.value.document)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403 || r.failure.status == 404)
            }
        }
    }

    fun type(title: String? = null, content: String? = null) {
        title?.let { _title.value = it.take(200) }
        content?.let { _content.value = it.take(100_000) }
        if (_save.value == Save.Conflict) return
        _save.value = Save.Unsaved
        pending?.cancel()
        pending = viewModelScope.launch { delay(1200); saveNow() }
    }

    private suspend fun saveNow() {
        val doc = _state.value.data ?: return
        val t = _title.value
        if (t != null && t.isBlank()) return
        _save.value = Save.Saving
        when (val r = apiCall { api.saveDocument(id, SaveDocBody(version = doc.version, title = t, content = _content.value)) }) {
            is ApiResult.Ok -> {
                _state.value = Screen(r.value.document)
                _save.value = Save.Saved
            }
            is ApiResult.Err -> when {
                r.failure.status == 409 -> _save.value = Save.Conflict
                else -> {
                    _save.value = Save.Error
                    // the site retries after 6 s
                    pending = viewModelScope.launch { delay(6000); saveNow() }
                }
            }
        }
    }

    /** «خلّي نسختي»: the newest version read again, the phone's words saved over it. */
    fun keepMine() = viewModelScope.launch {
        val fresh = (apiCall { api.document(id) } as? ApiResult.Ok)?.value?.document ?: return@launch
        _state.value = Screen(fresh)
        _save.value = Save.Unsaved
        saveNow()
    }

    /** «خذ نسختهم»: theirs loaded, what the phone typed dropped. */
    fun takeTheirs() = viewModelScope.launch {
        _title.value = null
        _content.value = null
        _save.value = Save.Idle
        load()
    }
}

/** «المنتجات»: the product sheets (`GET /api/knowledge`) and one sheet (`GET /api/knowledge/[id]`), read-only on the phone. */
@HiltViewModel
class SheetsViewModel @Inject constructor(private val api: WorkspaceApi, private val cache: Cache, private val session: Session) : ViewModel() {
    private val _state = MutableStateFlow(Screen<SheetsAnswer>())
    val state: StateFlow<Screen<SheetsAnswer>> = _state.asStateFlow()

    init {
        viewModelScope.launch { cache.read(KEY, SheetsAnswer.serializer())?.let { c -> if (_state.value.data == null) _state.value = _state.value.copy(data = c) } }
    }

    fun refresh() = viewModelScope.launch {
        when (val r = cache.refresh(KEY, SheetsAnswer.serializer()) { apiCall { api.knowledge() } }) {
            is ApiResult.Ok -> _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403 || r.failure.status == 404)
            }
        }
    }

    companion object { const val KEY = "knowledge" }
}

@HiltViewModel
class SheetViewModel @Inject constructor(private val api: WorkspaceApi, private val session: Session, handle: SavedStateHandle) : ViewModel() {
    val id: String = checkNotNull(handle["id"])
    private val _state = MutableStateFlow(Screen<SheetAnswer>())
    val state: StateFlow<Screen<SheetAnswer>> = _state.asStateFlow()

    fun load() = viewModelScope.launch {
        when (val r = apiCall { api.sheet(id) }) {
            is ApiResult.Ok -> _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403 || r.failure.status == 404)
            }
        }
    }
}
