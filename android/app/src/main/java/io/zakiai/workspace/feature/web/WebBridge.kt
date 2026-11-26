package io.zakiai.workspace.feature.web

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.result.ActivityResult
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import io.zakiai.workspace.BuildConfig
import io.zakiai.workspace.Config
import io.zakiai.workspace.core.net.EncryptedCookieJar
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.WarnFix
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * The pages that STAY the site's on purpose, shown here with their own mark (the owner's decision, 2026-11-26: inside the app, marked,
 * not in the phone's browser): the company's settings, the integrations and API tokens, the Telegram bot, the owner assistant's key,
 * the approval forms builder and the theme gallery — passwords, tokens and keys typed or shown once never live in a phone screen of its
 * own. Pure (tested).
 */
object SiteKept {
    private val PREFIXES = listOf("/automation", "/telegram", "/owner/assistant/settings", "/theme-gallery", "/approvals/forms")

    fun isKept(path: String): Boolean {
        val bare = path.substringBefore('?').substringBefore('#').trimEnd('/')
        // «/settings/me…» is the person's own settings (ported phase by phase); the rest of «/settings» is the company's
        if (bare == "/settings" || (bare.startsWith("/settings/") && !bare.startsWith("/settings/me"))) return true
        return PREFIXES.any { bare == it || bare.startsWith("$it/") }
    }
}

/**
 * ⚠️ The one place the app shows the site: a section that is not native YET opens its page here, signed in with the app's own
 * session, so nothing the team uses today goes missing while the app becomes native phase by phase (docs/restructure/M2-native-app.md),
 * and so do the pages kept on the site on purpose ([SiteKept]). 🔧 Each phase removes its paths from here; what remains is [SiteKept].
 *
 * The page is made when it is opened and thrown away when it is left. Only addresses of the site open inside it; anything else
 * opens in the phone's own browser. The system's questions (microphone and camera for a call, a file to pick) go through the
 * activity, the only one that can ask them.
 */
class WebBridge(
    private val activity: FragmentActivity,
    private val jar: EncryptedCookieJar,
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
        settings.userAgentString = settings.userAgentString + " ZakiApp/" + BuildConfig.VERSION_NAME
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.host == Uri.parse(Config.BASE).host) return false
                runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                return true
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val needed = request.resources.mapNotNull {
                    when (it) {
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                        else -> null
                    }
                }
                if (needed.isEmpty()) { request.deny(); return }
                val missing = needed.filter { ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED }
                if (missing.isEmpty()) { request.grant(request.resources); return }
                pendingPermission?.deny()
                pendingPermission = request
                askPermissions(missing.toTypedArray()) { granted ->
                    val asked = pendingPermission ?: return@askPermissions
                    pendingPermission = null
                    val ok = asked.resources.filter { r ->
                        val p = when (r) {
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                            PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                            else -> null
                        }
                        p != null && (granted[p] == true || ContextCompat.checkSelfPermission(activity, p) == PackageManager.PERMISSION_GRANTED)
                    }
                    if (ok.isEmpty()) asked.deny() else asked.grant(ok.toTypedArray())
                }
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFiles(chooserIntent(params)) { result ->
                        val cb = fileCallback
                        fileCallback = null
                        cb?.onReceiveValue(pickedUris(result))
                    }
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }
    }

    /** The system's picker for a page's file input: all the kinds it accepts, and several files when the input takes several. */
    private fun chooserIntent(params: WebChromeClient.FileChooserParams): Intent {
        val kinds = FilePick.mimeTypes(params.acceptTypes)
        return Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = kinds.singleOrNull() ?: "*/*"
            if (kinds.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, kinds.toTypedArray())
            if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
    }

    /** Several files come back in the answer's clipData, one in its data; null tells the page nothing was picked. */
    private fun pickedUris(result: ActivityResult): Array<Uri>? {
        if (result.resultCode != Activity.RESULT_OK) return null
        val clip = result.data?.clipData
        val several = if (clip == null) emptyList() else (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        return FilePick.picked(several, result.data?.data).takeIf { it.isNotEmpty() }?.toTypedArray()
    }

    /** Gives the web view the cookies of the session, so the page opens already signed in. */
    private fun syncCookies() {
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        for (c in jar.cookiesFor(Config.BASE.toHttpUrl())) cm.setCookie(Config.BASE, c.toString())
        cm.flush()
    }

    fun show(path: String) {
        val url = Config.siteUrl(path)
        if (loaded == url) return
        loaded = url
        syncCookies()
        webView.loadUrl(url)
    }

    fun destroy() {
        webView.stopLoading()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }
}

/** A page of the site over the app, with the ⚠️/🔧 line that says why. Its back walks back through the site's pages, then closes it. */
@Composable
fun WebPage(path: String, make: () -> WebBridge, onClose: () -> Unit) {
    val bridge = remember { make() }
    DisposableEffect(Unit) { onDispose { bridge.destroy() } }
    BackHandler { if (bridge.webView.canGoBack()) bridge.webView.goBack() else onClose() }
    LaunchedEffect(path) { bridge.show(path) }
    Column(Modifier.fillMaxSize().navigationBarsPadding().imePadding()) {
        // a page kept on the site on purpose says why; any other says it becomes native in its phase
        if (SiteKept.isKept(path)) WarnFix(T.siteKeptWarn, T.siteKeptFix) else WarnFix(T.webWarn, T.webFix)
        AndroidView(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            factory = {
                (bridge.webView.parent as? ViewGroup)?.removeView(bridge.webView)
                bridge.webView
            },
        )
    }
}
