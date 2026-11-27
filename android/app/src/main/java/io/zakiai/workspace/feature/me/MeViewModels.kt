package io.zakiai.workspace.feature.me

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.apiCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.encodeToJsonElement
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import javax.inject.Inject

/**
 * «إعداداتي» on the phone: each section reads and writes the site's own route (the server decides again on every one). What a section
 * needs is loaded when it is opened; a refusal is said in the site's sentence, and a signed-out answer ends the session.
 */
@HiltViewModel
class MeViewModel @Inject constructor(
    retrofit: retrofit2.Retrofit,
    val session: Session,
    @ApplicationContext private val context: Context,
) : ViewModel() {
    private val api = retrofit.create(MeApi::class.java)
    private val json = Json { encodeDefaults = true; explicitNulls = true }

    private val _facts = MutableStateFlow<SettingsFacts?>(null)
    val facts: StateFlow<SettingsFacts?> = _facts.asStateFlow()
    private val _profile = MutableStateFlow<Profile?>(null)
    val profile: StateFlow<Profile?> = _profile.asStateFlow()
    private val _automation = MutableStateFlow<Automation?>(null)
    val automation: StateFlow<Automation?> = _automation.asStateFlow()
    private val _prefs = MutableStateFlow<JsonObject?>(null)
    val prefs: StateFlow<JsonObject?> = _prefs.asStateFlow()
    private val _lastSeen = MutableStateFlow<Boolean?>(null)
    val lastSeen: StateFlow<Boolean?> = _lastSeen.asStateFlow()
    private val _phones = MutableStateFlow<List<AppDevice>?>(null)
    val phones: StateFlow<List<AppDevice>?> = _phones.asStateFlow()
    private val _browsers = MutableStateFlow<List<PushRow>?>(null)
    val browsers: StateFlow<List<PushRow>?> = _browsers.asStateFlow()
    private val _sessions = MutableStateFlow<List<SessionRow>?>(null)
    val sessions: StateFlow<List<SessionRow>?> = _sessions.asStateFlow()
    private val _digits = MutableStateFlow<String?>(null)
    val digits: StateFlow<String?> = _digits.asStateFlow()
    private val _failure = MutableStateFlow<String?>(null)
    /** the section could not be read at all */
    val failure: StateFlow<String?> = _failure.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun consumeNotice() { _notice.value = null }
    fun say(text: String) { _notice.value = text }

    private fun fail(f: ApiFailure, sentence: String? = null) {
        if (f.signedOut) session.expired(f)
        _notice.value = sentence ?: f.message
    }

    private suspend fun <T> read(call: suspend () -> T, into: (T) -> Unit) {
        when (val r = apiCall { call() }) {
            is ApiResult.Ok -> into(r.value)
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure.message }
        }
    }

    /** one action at a time: a double tap never sends twice */
    private fun act(call: suspend () -> Any, sentence: String? = null, failed: ((ApiFailure) -> String?)? = null, then: () -> Unit = {}) = viewModelScope.launch {
        if (_busy.value) return@launch
        _busy.value = true
        try {
            when (val r = apiCall { call() }) {
                is ApiResult.Ok -> { sentence?.let(::say); then() }
                is ApiResult.Err -> fail(r.failure, failed?.invoke(r.failure))
            }
        } finally {
            _busy.value = false
        }
    }

    fun loadFacts() = viewModelScope.launch { read({ api.facts() }) { _facts.value = it; if (_digits.value == null) _digits.value = it.digits } }

    // ── حسابي ──

    fun loadAccount() = viewModelScope.launch {
        loadFacts().join()
        read({ api.profile().user }) { _profile.value = it }
        if (_facts.value?.features?.chatAutomation != false) {
            // the block hides itself when it cannot be read (a switched-off company answers «not found»)
            (apiCall { api.automation() } as? ApiResult.Ok)?.let { _automation.value = it.value }
        }
    }

    fun saveProfile(name: String, jobTitle: String, bio: String) = act(
        { api.saveProfile(ProfileBody(name.trim(), jobTitle.trim(), bio.trim().ifBlank { null })) },
        M.profileSaved,
    ) { viewModelScope.launch { session.refresh() } }

    fun changePassword(current: String, new: String, done: () -> Unit) = viewModelScope.launch {
        if (_busy.value) return@launch
        if (current == new) { say(M.samePassword); return@launch }
        _busy.value = true
        try {
            // the server re-issues this phone's session and ends the others (Session.changePassword reads the person again)
            when (val r = session.changePassword(current, new)) {
                is ApiResult.Ok -> { say(M.passwordChanged); done() }
                is ApiResult.Err -> fail(r.failure, if (r.failure.key == "password.wrong_current") M.wrongCurrent else if (r.failure.key == "onboarding.err_same") M.samePassword else null)
            }
        } finally {
            _busy.value = false
        }
    }

    /** The picture is made small on the phone first (the site does it in the browser): 1024 at most, JPEG, under the 2 MB the server takes. */
    fun uploadPicture(uri: Uri) = viewModelScope.launch {
        if (_busy.value) return@launch
        _busy.value = true
        try {
            val bytes = withContext(Dispatchers.IO) { shrink(uri) }
            if (bytes == null) { say(M.failed); return@launch }
            if (bytes.size > 2 * 1024 * 1024) { say(M.photoTooBig); return@launch }
            val part = MultipartBody.Part.createFormData("file", "avatar.jpg", bytes.toRequestBody("image/jpeg".toMediaType()))
            when (val r = apiCall { api.uploadAvatar(part) }) {
                is ApiResult.Ok -> { say(M.photoSaved); _profile.value = _profile.value?.copy(avatarUrl = r.value.avatarUrl); session.refresh() }
                is ApiResult.Err -> fail(r.failure)
            }
        } finally {
            _busy.value = false
        }
    }

    private fun shrink(uri: Uri): ByteArray? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1024) sample *= 2
        val bmp = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
        val scale = 1024f / maxOf(bmp.width, bmp.height)
        val sized = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
        ByteArrayOutputStream().use { out -> sized.compress(Bitmap.CompressFormat.JPEG, 85, out); out.toByteArray() }
    }.getOrNull()

    fun removePicture() = act({ api.removeAvatar() }, M.photoRemoved) {
        _profile.value = _profile.value?.copy(avatarUrl = null)
        viewModelScope.launch { session.refresh() }
    }

    /** Both parts, always (the site does the same); `null` hours clear them. */
    fun saveAutomation(hours: WorkHours?, reply: AutoReply) {
        hours?.let { h -> M.hoursProblem(h)?.let { say(it); return } }
        val body = JsonObject(
            mapOf(
                "workHours" to (hours?.let { json.encodeToJsonElement(it) } ?: JsonNull),
                "chatAutomation" to json.encodeToJsonElement(reply.copy(text = reply.text.trim())),
            ),
        )
        act({ api.saveAutomation(body).also { _automation.value = it } }, M.saved, failed = { M.whFailed })
    }

    // ── the chat prefs: notifications and the quick reactions ──

    fun loadPrefs() = viewModelScope.launch { read({ api.prefs() }) { _prefs.value = it.prefs } }

    private fun savePrefs(section: String, value: JsonElement, sentence: String? = null) {
        val before = _prefs.value
        // drawn at once (the site saves optimistically); a refusal puts it back
        _prefs.value = JsonObject((before ?: JsonObject(emptyMap())).toMutableMap().apply { if (value is JsonNull) remove(section) else put(section, value) })
        viewModelScope.launch {
            when (val r = apiCall { api.savePrefs(JsonObject(mapOf(section to value))) }) {
                is ApiResult.Ok -> { _prefs.value = r.value.prefs; sentence?.let(::say) }
                is ApiResult.Err -> { _prefs.value = before; fail(r.failure, M.failed) }
            }
        }
    }

    fun setRule(kind: String, rule: M.NotifyRule) {
        val rules = M.rules(_prefs.value ?: return).toMutableMap().apply { put(kind, rule) }
        savePrefs("notifications", M.notificationsSection(rules))
    }

    fun resetNotifications() = savePrefs("notifications", JsonNull, M.nResetDone)

    fun setQuick(six: List<String>) {
        if (six.size != 6 || six.toSet().size != 6) { say(M.quickTaken); return }
        savePrefs("chat", M.chatWithQuick(_prefs.value ?: return, six))
    }

    // ── الخصوصية ──

    fun loadPrivacy() = viewModelScope.launch {
        loadFacts().join()
        if (_facts.value?.features?.lastSeen == true) read({ api.lastSeen() }) { _lastSeen.value = it.hide }
    }

    fun setLastSeen(hide: Boolean) {
        val before = _lastSeen.value
        _lastSeen.value = hide
        act({ api.saveLastSeen(LastSeen(hide)) }, M.lsSaved, failed = { _lastSeen.value = before; null })
    }

    // ── الأجهزة ──

    fun loadDevices() = viewModelScope.launch {
        loadFacts().join()
        if (_facts.value?.features?.appConnection == true) (apiCall { api.appDevices() } as? ApiResult.Ok)?.let { _phones.value = it.value.devices } ?: run { _phones.value = emptyList() }
        (apiCall { api.push() } as? ApiResult.Ok)?.let { _browsers.value = it.value.subscriptions } ?: run { _browsers.value = emptyList() }
        read({ api.sessions() }) { _sessions.value = it.sessions }
    }

    fun unlinkPhone(id: String, isThis: Boolean) = act({ api.removeAppDevice(id) }) {
        // unlinking this very phone ends its notifications line: it signs out, as the site's «فك الربط» leaves it unpaired
        if (isThis) viewModelScope.launch { session.signOut() } else loadDevices()
    }

    fun disconnectBrowser(id: String) = act({ api.removePush(id) }, M.disconnected) { loadDevices() }

    fun endSession(row: SessionRow) = act({ api.endSession(row.id) }, M.sessionEnded) {
        if (row.current) viewModelScope.launch { session.signOut() } else loadDevices()
    }

    /** every session ends, every phone and browser is unlinked: this phone signs out after it */
    fun logoutEverywhere() = act({ api.logoutEverywhere() }) { viewModelScope.launch { session.signOut() } }

    // ── اللغة والأرقام ──

    fun setDigits(d: String) {
        val before = _digits.value
        _digits.value = d
        act({ api.saveDigits(DigitsBody(d)) }, M.lsSaved, failed = { _digits.value = before; M.failed })
    }

    // ── المساعدة ──

    fun contactOwner(opened: (String) -> Unit) {
        val owner = _facts.value?.contactOwnerId ?: return
        var id: String? = null
        act({ api.dm(DmBody(owner)).id.also { id = it } }, failed = { M.contactFailed }) { id?.takeIf { it.isNotEmpty() }?.let(opened) }
    }
}

/** «دليل ذكي»: the articles this person may read, and one article (`GET /api/guide`, `/api/guide/[slug]`). */
@HiltViewModel
class GuideViewModel @Inject constructor(retrofit: retrofit2.Retrofit, private val session: Session) : ViewModel() {
    private val api = retrofit.create(MeApi::class.java)
    private val _list = MutableStateFlow<List<GuideEntry>?>(null)
    val list: StateFlow<List<GuideEntry>?> = _list.asStateFlow()
    private val _article = MutableStateFlow<GuideAnswer?>(null)
    val article: StateFlow<GuideAnswer?> = _article.asStateFlow()
    private val _failure = MutableStateFlow<String?>(null)
    val failure: StateFlow<String?> = _failure.asStateFlow()

    fun loadList() = viewModelScope.launch {
        when (val r = apiCall { api.guide() }) {
            is ApiResult.Ok -> _list.value = r.value.articles
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure.message }
        }
    }

    fun open(slug: String) = viewModelScope.launch {
        _article.value = null; _failure.value = null
        when (val r = apiCall { api.article(slug) }) {
            is ApiResult.Ok -> _article.value = r.value
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure.message }
        }
    }
}
