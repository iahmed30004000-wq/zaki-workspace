package io.zakiai.workspace

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat

/**
 * A page of the site inside the app (never in another app), signed in with the app's own session. It is made when a page is opened and thrown
 * away when the person leaves it, so a closed page costs the app nothing. The system's questions (microphone and camera for a call, a file
 * to pick) go through the two callbacks the activity gives, because only the activity can ask for them.
 */
class WebHost(
    private val activity: ComponentActivity,
    private val askPermissions: (Array<String>, (Map<String, Boolean>) -> Unit) -> Unit,
    private val pickFiles: (Intent, (ActivityResult) -> Unit) -> Unit,
) {
    private var pendingPermission: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var loaded: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    val webView: WebView = WebView(activity).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.userAgentString = settings.userAgentString + " ZakiApp/3.0"
        setBackgroundColor(0xFF050F1F.toInt())
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.host == Uri.parse(Config.BASE).host) return false
                // anything that is not the site opens in the phone's own browser or the app that handles it, never inside this window
                runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                return true
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val needed = mutableListOf<String>()
                for (r in request.resources) {
                    when (r) {
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> needed += Manifest.permission.RECORD_AUDIO
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> needed += Manifest.permission.CAMERA
                    }
                }
                if (needed.isEmpty()) {
                    request.deny()
                    return
                }
                val missing = needed.filter { ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED }
                if (missing.isEmpty()) {
                    request.grant(request.resources)
                    return
                }
                pendingPermission?.deny()
                pendingPermission = request
                askPermissions(missing.toTypedArray()) { granted ->
                    val asked = pendingPermission ?: return@askPermissions
                    pendingPermission = null
                    val resources = asked.resources.filter { r ->
                        when (r) {
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE -> granted[Manifest.permission.RECORD_AUDIO] == true || ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                            PermissionRequest.RESOURCE_VIDEO_CAPTURE -> granted[Manifest.permission.CAMERA] == true || ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                            else -> false
                        }
                    }
                    if (resources.isEmpty()) asked.deny() else asked.grant(resources.toTypedArray())
                }
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFiles(params.createIntent()) { result ->
                        val cb = fileCallback
                        fileCallback = null
                        cb?.onReceiveValue(FileChooserParams.parseResult(result.resultCode, result.data))
                    }
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }
    }

    /** The address of a page of the site. */
    private fun urlOf(path: String): String = if (path.startsWith("http")) path else Config.BASE + (if (path.startsWith("/")) path else "/$path")

    /** Opens a page of the site (the session is handed to the web view first, here on the screen's own thread). */
    fun show(path: String) {
        val url = urlOf(path)
        if (loaded == url) return
        loaded = url
        Api.syncToWebView()
        webView.loadUrl(url)
    }

    fun destroy() {
        webView.stopLoading()
        webView.destroy()
    }
}
