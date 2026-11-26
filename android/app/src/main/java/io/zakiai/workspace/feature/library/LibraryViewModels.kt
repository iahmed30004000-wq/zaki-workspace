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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
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

/** «مكتبة مساحة العمل»: the space's files (`GET /api/files`); uploads go through [LibraryUploads] (the app's life), delete through `DELETE`. */
@HiltViewModel
class FilesViewModel @Inject constructor(
    private val api: WorkspaceApi,
    private val cache: Cache,
    private val session: Session,
    /** the chat's own fetch-and-open (the session's client, the app's private cache, a temporary read grant): one way to open a file */
    val opener: io.zakiai.workspace.feature.chat.ChatFiles,
    val uploads: LibraryUploads,
) : ViewModel() {
    private val _state = MutableStateFlow(Screen<FilesAnswer>())
    val state: StateFlow<Screen<FilesAnswer>> = _state.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    init {
        viewModelScope.launch { cache.read(KEY, FilesAnswer.serializer())?.let { c -> if (_state.value.data == null) _state.value = _state.value.copy(data = c) } }
        // a finished upload (even one started before the tab was left and opened again) reloads the list
        viewModelScope.launch { var first = true; uploads.done.collect { if (!first) refresh(); first = false } }
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

    fun upload(uris: List<Uri>) = uploads.add(uris)

    fun delete(id: String) = viewModelScope.launch {
        when (val r = apiCall { api.deleteFile(id) }) {
            is ApiResult.Ok -> { _notice.value = L.deleted; refresh() }
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    /** A library file as the chat's attachment shape, so it opens and shares the same way (`/api/files/<id>/raw`, the site's permission check). */
    fun asAttachment(f: io.zakiai.workspace.core.net.LibFile) = io.zakiai.workspace.core.net.Attachment(id = "lib-" + f.id, name = f.name, mime = f.mimeType, size = f.size, url = "/api/files/" + f.id + "/raw")

    fun say(text: String) { _notice.value = text }

    fun consumeNotice() { _notice.value = null }

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
 * with the version it was read at. As on the site: a save in flight is never cancelled (typing meanwhile only asks for one more save after
 * it), a blank title is left out and the text is still saved, a failure retries after 6 s, and another person's newer save (409) stops the
 * autosave until the person chooses «خلّي نسختي» (saved over the newest version) or «خذ نسختهم» (after a question). Leaving the screen saves
 * what is still unsaved, outside the screen's life, so no word is lost on «رجوع».
 */
@HiltViewModel
class DocumentViewModel @Inject constructor(private val api: WorkspaceApi, private val session: Session, handle: SavedStateHandle) : ViewModel() {
    val id: String = checkNotNull(handle["id"])
    private val _state = MutableStateFlow(Screen<DocItem>())
    val state: StateFlow<Screen<DocItem>> = _state.asStateFlow()

    /** what the person typed (null: the document as read) — Compose state, so the field and its cursor stay in step with the keyboard */
    var title by androidx.compose.runtime.mutableStateOf<String?>(null)
        private set
    var content by androidx.compose.runtime.mutableStateOf<String?>(null)
        private set

    enum class Save { Idle, Unsaved, Saving, Saved, Error, Conflict }
    private val _save = MutableStateFlow(Save.Idle)
    val save: StateFlow<Save> = _save.asStateFlow()

    private var timer: Job? = null
    private var inflight = false
    private var again = false
    /** the saves outlive the screen: «رجوع» right after typing still saves */
    private val saver = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun load() = viewModelScope.launch {
        when (val r = apiCall { api.document(id) }) {
            is ApiResult.Ok -> _state.value = Screen(r.value.document)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403 || r.failure.status == 404)
            }
        }
    }

    /** Read once per screen: reading again would move the base version under the person's unsaved words (and could overwrite a colleague). */
    fun loadOnce() { if (_state.value.data == null) load() }

    fun type(title: String? = null, content: String? = null) {
        title?.let { this.title = it.take(200) }
        content?.let { this.content = it.take(100_000) }
        if (_save.value == Save.Conflict) return
        _save.value = Save.Unsaved
        schedule(1200)
    }

    private fun schedule(ms: Long) {
        timer?.cancel()
        timer = saver.launch { kotlinx.coroutines.delay(ms); saveNow() }
    }

    private suspend fun saveNow() {
        val doc = _state.value.data ?: return
        if (_save.value == Save.Conflict) return
        if (inflight) { again = true; return }
        if (title == null && content == null) return
        inflight = true
        again = false
        _save.value = Save.Saving
        // a blank title is left out (the site's rule): the text is still saved
        val t = title?.takeIf { it.isNotBlank() }
        val r = apiCall { api.saveDocument(id, SaveDocBody(version = doc.version, title = t, content = content)) }
        inflight = false
        when (r) {
            is ApiResult.Ok -> {
                _state.value = Screen(r.value.document)
                _save.value = if (again) Save.Unsaved else Save.Saved
                if (again) schedule(0)
            }
            is ApiResult.Err -> when (r.failure.status) {
                409 -> _save.value = Save.Conflict
                else -> { _save.value = Save.Error; schedule(6000) }
            }
        }
    }

    /** «خلّي نسختي»: the newest version read again, the phone's words saved over it. */
    fun keepMine() = saver.launch {
        val fresh = (apiCall { api.document(id) } as? ApiResult.Ok)?.value?.document
        if (fresh == null) { _save.value = Save.Error; return@launch }
        _state.value = Screen(fresh)
        _save.value = Save.Unsaved
        saveNow()
    }

    /** «خذ نسختهم»: theirs loaded, what the phone typed dropped (the screen asks first). */
    fun takeTheirs() = viewModelScope.launch {
        timer?.cancel()
        title = null
        content = null
        _save.value = Save.Idle
        load()
    }

    override fun onCleared() {
        // what is still unsaved goes now, in the saver's own scope (the screen's is ending)
        if (_save.value == Save.Unsaved || _save.value == Save.Error) {
            timer?.cancel()
            saver.launch { saveNow() }
        }
        super.onCleared()
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
