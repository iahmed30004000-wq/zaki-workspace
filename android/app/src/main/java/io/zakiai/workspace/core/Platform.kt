package io.zakiai.workspace.core

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.SystemClock
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import android.os.Build
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import dagger.hilt.android.qualifiers.ApplicationContext
import io.zakiai.workspace.ui.theme.DEFAULT_THEME_KEY
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/** Online or not, as the system says — drives the «بدون اتصال» bar. */
@Singleton
class Connectivity @Inject constructor(@ApplicationContext context: Context) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private val _online = MutableStateFlow(now())
    val online: StateFlow<Boolean> = _online.asStateFlow()

    init {
        runCatching {
            cm?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { _online.value = true }
                override fun onLost(network: Network) { _online.value = now() }
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    _online.value = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                }
            })
        }
    }

    private fun now(): Boolean {
        val caps = cm?.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}

/** What this phone remembers about the look: the theme (the person's own, from the site, until they pick another one here). */
@Singleton
class LookSettings @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences("zaki_look", Context.MODE_PRIVATE)
    private val _theme = MutableStateFlow(prefs.getString("theme", null) ?: DEFAULT_THEME_KEY)
    val theme: StateFlow<String> = _theme.asStateFlow()

    fun setTheme(key: String) {
        prefs.edit().putString("theme", key).apply()
        _theme.value = key
    }

    /** The person picked a theme on this phone: the site's saved one no longer overrides it at the next start. */
    var chosenHere: Boolean
        get() = prefs.getBoolean("chosen", false)
        set(value) { prefs.edit().putBoolean("chosen", value).apply() }
}

/**
 * THE OPTIONAL FINGERPRINT LOCK («قفل التطبيق»). When on, the app opens to a lock that only the phone's fingerprint (or its screen
 * lock) opens — after a cold start and after five minutes in the background. It is local: the site is not asked anything, and the
 * session stays encrypted by the Keystore either way.
 */
@Singleton
class AppLock @Inject constructor(@ApplicationContext private val context: Context) : DefaultLifecycleObserver {
    private val prefs = context.getSharedPreferences("zaki_lock", Context.MODE_PRIVATE)
    private val _enabled = MutableStateFlow(prefs.getBoolean("on", false))
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()
    private val _locked = MutableStateFlow(_enabled.value)
    val locked: StateFlow<Boolean> = _locked.asStateFlow()
    private var backgroundAt = 0L

    init { ProcessLifecycleOwner.get().lifecycle.addObserver(this) }

    fun available(): Boolean = BiometricManager.from(context).canAuthenticate(authenticators(Build.VERSION.SDK_INT)) == BiometricManager.BIOMETRIC_SUCCESS

    fun setEnabled(on: Boolean) {
        prefs.edit().putBoolean("on", on).apply()
        _enabled.value = on
        if (!on) _locked.value = false
    }

    override fun onStop(owner: LifecycleOwner) { backgroundAt = SystemClock.elapsedRealtime() }

    override fun onStart(owner: LifecycleOwner) {
        if (shouldLock(_enabled.value, backgroundAt, SystemClock.elapsedRealtime())) _locked.value = true
    }

    fun prompt(activity: FragmentActivity, title: String, subtitle: String) {
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { _locked.value = false }
        })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setAllowedAuthenticators(authenticators(Build.VERSION.SDK_INT))
                .build(),
        )
    }

    companion object {
        const val AWAY_MS = 5 * 60_000L

        /**
         * What may open the lock: Android 11+ takes a strong fingerprint or the screen lock; Android 8–10 cannot combine the
         * screen lock with «strong», so there it is any fingerprint or the screen lock (otherwise the switch would stay greyed out).
         */
        fun authenticators(sdk: Int): Int = if (sdk >= 30) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_WEAK or DEVICE_CREDENTIAL

        /** Locks again only when it is on and the app was away more than five minutes. Pure (unit-tested). */
        fun shouldLock(enabled: Boolean, backgroundAt: Long, now: Long): Boolean = enabled && backgroundAt > 0 && now - backgroundAt > AWAY_MS
    }
}
