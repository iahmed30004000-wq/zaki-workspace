package io.zakiai.workspace.feature.chat

import android.app.DownloadManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.OpenableColumns
import dagger.hilt.android.qualifiers.ApplicationContext
import io.zakiai.workspace.Config
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.Attachment
import io.zakiai.workspace.core.net.EncryptedCookieJar
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/** A file on its way into a message: uploading, uploaded (its stored id goes into `attachmentIds`), or failed (tap to try again). */
data class Upload(
    val key: String,
    val name: String,
    val kind: String,
    val state: String, // uploading · done · failed
    val uploadedId: String = "",
    val source: Uri? = null,
    val failure: String? = null,
)

/**
 * THE CHAT'S FILES ON THE PHONE: what is picked is uploaded at once (`POST /api/chat/uploads`, the bytes sniffed again by the server),
 * pictures made smaller first as the site does (1600 px on the long side, JPEG); a voice note is recorded here (AAC in MP4) with its
 * loudness line; a tapped file is downloaded through the system's downloads with the session; a voice note plays here.
 *
 * ⚠️ A file is uploaded when it is picked, so without a network it fails (it says so, with «جرّب كمان مرة»); the MESSAGE that carries it
 * goes through the outbox like any other. 🔧 A queue of files that waits for the network is a later step.
 */
@Singleton
class ChatFiles @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: WorkspaceApi,
    private val jar: EncryptedCookieJar,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val byConversation = ConcurrentHashMap<String, MutableStateFlow<List<Upload>>>()

    fun ready(conversationId: String): StateFlow<List<Upload>> = flowOf(conversationId).asStateFlow()

    private fun flowOf(id: String) = byConversation.getOrPut(id) { MutableStateFlow(emptyList()) }

    /** The files of the message just sent leave the composer. */
    fun consumed(conversationId: String) = flowOf(conversationId).update { list -> list.filter { it.state != "done" } }

    fun remove(conversationId: String, key: String) = flowOf(conversationId).update { list -> list.filter { it.key != key } }

    fun add(conversationId: String, uris: List<Uri>, asFile: Boolean = false) {
        val room = MAX - flowOf(conversationId).value.size
        for (uri in uris.take(room.coerceAtLeast(0))) {
            val key = UUID.randomUUID().toString()
            val name = nameOf(uri)
            val mime = context.contentResolver.getType(uri).orEmpty()
            val kind = when {
                asFile -> "FILE"
                mime.startsWith("image/") -> "IMAGE"
                mime.startsWith("video/") -> "VIDEO"
                mime.startsWith("audio/") -> "AUDIO"
                else -> "FILE"
            }
            flowOf(conversationId).update { it + Upload(key, name, kind, "uploading", source = uri) }
            scope.launch { upload(conversationId, key, uri, name, mime, kind) }
        }
    }

    fun retry(conversationId: String, u: Upload) {
        val uri = u.source ?: return
        flowOf(conversationId).update { list -> list.map { if (it.key == u.key) it.copy(state = "uploading", failure = null) else it } }
        scope.launch { upload(conversationId, u.key, uri, u.name, context.contentResolver.getType(uri).orEmpty(), u.kind) }
    }

    private suspend fun upload(conversationId: String, key: String, uri: Uri, name: String, mime: String, kind: String) {
        val bytes = withContext(Dispatchers.IO) {
            runCatching {
                if (kind == "IMAGE" && mime != "image/gif") smaller(uri) ?: read(uri) else read(uri)
            }.getOrNull()
        }
        if (bytes == null) { mark(conversationId, key) { it.copy(state = "failed", failure = C.uploadFailed) }; return }
        val sentName = if (kind == "IMAGE" && mime != "image/gif") name.substringBeforeLast('.') + ".jpg" else name
        val sentMime = if (kind == "IMAGE" && mime != "image/gif") "image/jpeg" else mime.ifEmpty { "application/octet-stream" }
        val part = MultipartBody.Part.createFormData("file", sentName, bytes.toRequestBody(sentMime.toMediaTypeOrNull()))
        when (val r = apiCall { api.upload(part, kind.toRequestBody()) }) {
            is ApiResult.Ok -> mark(conversationId, key) { it.copy(state = "done", uploadedId = r.value.id) }
            is ApiResult.Err -> mark(conversationId, key) { it.copy(state = "failed", failure = r.failure.message) }
        }
    }

    private fun mark(conversationId: String, key: String, change: (Upload) -> Upload) =
        flowOf(conversationId).update { list -> list.map { if (it.key == key) change(it) else it } }

    private fun read(uri: Uri): ByteArray = context.contentResolver.openInputStream(uri)!!.use { it.readBytes() }

    /** A picture made smaller as the site does (1600 px on the long side, JPEG 80%), turned the right way up (Android 9 and up). */
    private fun smaller(uri: Uri): ByteArray? {
        val bmp: Bitmap = if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
                val w = info.size.width; val h = info.size.height
                val scale = minOf(1f, LONG_SIDE.toFloat() / maxOf(w, h))
                decoder.setTargetSize((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1))
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= LONG_SIDE) sample *= 2
            val decoded = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
            val scale = minOf(1f, LONG_SIDE.toFloat() / maxOf(decoded.width, decoded.height))
            if (scale < 1f) Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true) else decoded
        }
        return ByteArrayOutputStream().use { out -> bmp.compress(Bitmap.CompressFormat.JPEG, 80, out); out.toByteArray() }
    }

    private fun nameOf(uri: Uri): String = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull() ?: (uri.lastPathSegment ?: "file")

    // ── the voice note ────────────────────────────────────────────────────────────────────────────────────

    private var recorder: MediaRecorder? = null
    private var recordFile: File? = null
    private var recordStart = 0L
    private var sampler: Job? = null
    private val levels = ArrayList<Int>()

    private val _recording = MutableStateFlow(false)
    val recording: StateFlow<Boolean> = _recording.asStateFlow()

    fun startRecording(): Boolean {
        if (recorder != null) return true
        val file = File(context.cacheDir, "voice-${System.currentTimeMillis()}.m4a")
        val r = (if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()).apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioSamplingRate(44_100)
            setAudioEncodingBitRate(64_000)
            setOutputFile(file.absolutePath)
        }
        return runCatching { r.prepare(); r.start() }.fold(
            onSuccess = {
                recorder = r; recordFile = file; recordStart = System.currentTimeMillis(); levels.clear(); _recording.value = true
                sampler = scope.launch { while (isActive) { levels.add(runCatching { r.maxAmplitude }.getOrDefault(0)); delay(100) } }
                true
            },
            onFailure = { r.release(); file.delete(); false },
        )
    }

    /** Stops; `send` uploads it as a VOICE file and the message goes with `voice: true`. Under a second is dropped (a slipped tap). */
    fun stopRecording(conversationId: String, send: Boolean, then: (String) -> Unit) {
        val r = recorder ?: return
        recorder = null
        sampler?.cancel()
        _recording.value = false
        val file = recordFile ?: return
        val durationMs = System.currentTimeMillis() - recordStart
        runCatching { r.stop() }
        r.release()
        if (!send || durationMs < 1_000) { file.delete(); return }
        val peaks = Peaks.of(levels)
        scope.launch {
            val part = MultipartBody.Part.createFormData("file", file.name, file.readBytes().toRequestBody("audio/mp4".toMediaTypeOrNull()))
            val r2 = apiCall { api.upload(part, "VOICE".toRequestBody(), durationMs.coerceAtMost(300_000).toString().toRequestBody(), peaks.joinToString(",", "[", "]").toRequestBody()) }
            file.delete()
            if (r2 is ApiResult.Ok) withContext(Dispatchers.Main) { then(r2.value.id) }
            else flowOf(conversationId).update { it + Upload(UUID.randomUUID().toString(), C.record, "VOICE", "failed", failure = (r2 as ApiResult.Err).failure.message) }
        }
    }

    // ── opening what arrived ──────────────────────────────────────────────────────────────────────────────

    /** The session as a header, for the system's own players and downloads (they do not share the app's cookie store). */
    fun headers(url: String): Map<String, String> {
        val u = absolute(url).toHttpUrlOrNull() ?: return emptyMap()
        val cookie = jar.cookiesFor(u).joinToString("; ") { "${it.name}=${it.value}" }
        return if (cookie.isEmpty()) emptyMap() else mapOf("Cookie" to cookie)
    }

    /** A file: the system's downloads, with the session; the notification opens it when it is done. */
    fun download(a: Attachment, started: () -> Unit) {
        runCatching {
            val req = DownloadManager.Request(Uri.parse(absolute(a.url)))
                .setTitle(a.name.ifBlank { "file" })
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setMimeType(a.mime.ifBlank { null })
            headers(a.url).forEach { (k, v) -> req.addRequestHeader(k, v) }
            val safe = a.name.ifBlank { "file" }.replace(Regex("[\\\\/:*?\"<>|]"), "_")
            // Android 10 and up write to «التنزيلات» without a permission; before that the app's own folder (no storage permission asked)
            if (Build.VERSION.SDK_INT >= 29) req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "Zaki/$safe")
            else req.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, safe)
            (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            started()
        }
    }

    private var player: MediaPlayer? = null
    private val _playing = MutableStateFlow<String?>(null)
    /** the attachment playing now */
    val playing: StateFlow<String?> = _playing.asStateFlow()

    /** A voice note or a sound: plays here; the same one again stops it. */
    fun play(a: Attachment) {
        val was = _playing.value
        player?.release(); player = null; _playing.value = null
        if (was == a.id) return
        runCatching {
            player = MediaPlayer().apply {
                setDataSource(context, Uri.parse(absolute(a.url)), headers(a.url))
                setOnPreparedListener { it.start() }
                setOnCompletionListener { it.release(); if (player === it) { player = null; _playing.value = null } }
                prepareAsync()
            }
            _playing.value = a.id
        }
    }

    companion object {
        const val MAX = 10
        const val LONG_SIDE = 1600
        fun base() = Config.BASE
    }
}

/** The loudness line of a voice note: at most 100 values of 0–100, from the recorder's samples. Pure (unit-tested). */
object Peaks {
    fun of(samples: List<Int>): List<Int> {
        if (samples.isEmpty()) return emptyList()
        val max = samples.max().coerceAtLeast(1)
        val step = maxOf(1, (samples.size + 99) / 100)
        return samples.chunked(step).map { chunk -> (chunk.max() * 100 / max).coerceIn(0, 100) }.take(100)
    }
}

private fun String.toRequestBody() = toRequestBody("text/plain".toMediaTypeOrNull())
