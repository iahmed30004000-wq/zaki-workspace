package io.zakiai.workspace.feature.library

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import dagger.hilt.android.qualifiers.ApplicationContext
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import javax.inject.Inject
import javax.inject.Singleton

/** The site's one-file limit (src/server/files/sniff.ts `MAX_FILE_BYTES`): known on the phone so a too-big file is refused before it travels. */
const val MAX_FILE_BYTES = 25L * 1024 * 1024

/**
 * The library's uploads, for the app's whole life (like the chat's): leaving the tab does not stop them. One file at a time, as the site
 * sends them, so only one file is ever in memory; a file is read no further than the limit; a camera's HEIC (by its type or its name)
 * becomes a JPEG at most 4096 on its long side (the site's sniffing refuses HEIC). [done] counts finished uploads, for the list to reload.
 */
@Singleton
class LibraryUploads @Inject constructor(@ApplicationContext private val context: Context, private val api: WorkspaceApi) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val oneAtATime = Mutex()

    private val _uploading = MutableStateFlow<List<String>>(emptyList())
    val uploading: StateFlow<List<String>> = _uploading.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    private val _done = MutableStateFlow(0)
    val done: StateFlow<Int> = _done.asStateFlow()

    fun consumeNotice() { _notice.value = null }

    fun add(uris: List<Uri>) {
        for (uri in uris) {
            val name = nameOf(uri)
            _uploading.update { it + name }
            scope.launch {
                oneAtATime.withLock { send(uri, name) }
                _uploading.update { list -> list - name }
            }
        }
    }

    private suspend fun send(uri: Uri, name: String) {
        val size = sizeOf(uri)
        if (size != null && size > MAX_FILE_BYTES) { _notice.value = L.tooLarge; return }
        val prepared = runCatching { prepare(uri, name) }.getOrNull()
        if (prepared == null) { _notice.value = io.zakiai.workspace.feature.chat.C.uploadFailed; return }
        val (bytes, sentName, mime) = prepared
        if (bytes == null) { _notice.value = L.tooLarge; return }
        val part = MultipartBody.Part.createFormData("file", sentName, bytes.toRequestBody(mime.toMediaTypeOrNull()))
        when (val r = apiCall { api.uploadLibrary(part) }) {
            is ApiResult.Ok -> { _notice.value = L.uploaded; _done.update { it + 1 } }
            is ApiResult.Err -> _notice.value = uploadRefusal(r.failure)
        }
    }

    /** Null bytes: past the limit. */
    private fun prepare(uri: Uri, name: String): Triple<ByteArray?, String, String> {
        val mime = context.contentResolver.getType(uri).orEmpty()
        val heic = mime == "image/heic" || mime == "image/heif" || name.endsWith(".heic", true) || name.endsWith(".heif", true)
        if (heic && Build.VERSION.SDK_INT >= 28) {
            val bmp: Bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { d, info, _ ->
                val w = info.size.width; val h = info.size.height
                val scale = minOf(1f, 4096f / maxOf(w, h))
                d.setTargetSize((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1))
                d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
            val out = ByteArrayOutputStream().use { o -> bmp.compress(Bitmap.CompressFormat.JPEG, 90, o); o.toByteArray() }
            bmp.recycle()
            return Triple(out.takeIf { it.size <= MAX_FILE_BYTES }, name.substringBeforeLast('.') + ".jpg", "image/jpeg")
        }
        // read no further than the limit: a provider that does not tell the size cannot make the phone hold a whole video
        val bytes = context.contentResolver.openInputStream(uri)!!.use { input ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                if (total > MAX_FILE_BYTES) return Triple(null, name, mime)
                out.write(buf, 0, n)
            }
            out.toByteArray()
        }
        return Triple(bytes, name, mime.ifEmpty { "application/octet-stream" })
    }

    private fun nameOf(uri: Uri): String = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull() ?: (uri.lastPathSegment ?: "file")

    private fun sizeOf(uri: Uri): Long? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }
    }.getOrNull()
}

/** The site's own words for an upload it refuses (`files.*` keys travel as the message), else the general failure. Pure (unit-tested). */
fun uploadRefusal(f: ApiFailure): String = when {
    f.status == 413 || f.key == "files.too_large" -> L.tooLarge
    f.key == "files.unsupported" -> L.unsupported
    f.key == "files.empty" -> L.empty
    else -> f.message
}
