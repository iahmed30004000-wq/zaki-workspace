package io.zakiai.workspace

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.fragment.app.FragmentActivity
import dagger.hilt.android.AndroidEntryPoint
import androidx.lifecycle.lifecycleScope
import io.zakiai.workspace.core.AppLock
import io.zakiai.workspace.core.Gate
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import io.zakiai.workspace.core.LookSettings
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.EncryptedCookieJar
import io.zakiai.workspace.core.sync.Schedules
import io.zakiai.workspace.feature.web.WebBridge
import io.zakiai.workspace.ui.Root
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject

/**
 * The one activity (a FragmentActivity: the fingerprint prompt needs one). Every screen is Compose, under [Root]. A tapped
 * notification, a call's «رد» or a link of the site arrives as the intent's address and is handed to the shell ([link]).
 */
@AndroidEntryPoint
class MainActivity : FragmentActivity() {
    @Inject lateinit var session: Session
    @Inject lateinit var lock: AppLock
    @Inject lateinit var look: LookSettings
    @Inject lateinit var jar: EncryptedCookieJar
    @Inject lateinit var schedules: Schedules

    /** The address to open (a notification's, a call's, a link's), until the shell has opened it. */
    val link = MutableStateFlow<String?>(null)

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // the system's questions for a page of the site that is not native yet (microphone, camera, a file): asked here, answered to the page
    private var permissionAnswer: ((Map<String, Boolean>) -> Unit)? = null
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        permissionAnswer?.invoke(granted)
        permissionAnswer = null
    }
    private var fileAnswer: ((ActivityResult) -> Unit)? = null
    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileAnswer?.invoke(result)
        fileAnswer = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // the splash stays while the encrypted session is read on its own thread (a slow phone's Keystore never freezes a frame)
        installSplashScreen().setKeepOnScreenCondition { session.gate.value == Gate.STARTING }
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Notifier.cancelRing(this)
        lifecycleScope.launch {
            // pairing and the background work start once the gate is known (Root re-checks the pairing on every gate change)
            if (session.gate.first { it != Gate.STARTING } != Gate.SIGNED_OUT) schedules.ensure()
        }
        // the address the app was opened with, once: a rotation re-creates the activity with the same intent, and must not
        // push the same screen a second time
        if (savedInstanceState == null) link.value = intent?.dataString
        setContent { Root(this) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        Notifier.cancelRing(this)
        intent.dataString?.let { link.value = it }
    }

    fun makeBridge(): WebBridge = WebBridge(
        this,
        jar,
        askPermissions = { permissions, answer ->
            permissionAnswer = answer
            permissionLauncher.launch(permissions)
        },
        pickFiles = { intent, answer ->
            fileAnswer = answer
            fileLauncher.launch(intent)
        },
    )

    fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
