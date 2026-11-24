package io.zakiai.workspace.core

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.WorkManager
import dagger.hilt.android.qualifiers.ApplicationContext
import io.zakiai.workspace.Config
import io.zakiai.workspace.StreamService
import io.zakiai.workspace.core.db.ZakiDb
import io.zakiai.workspace.core.net.AcceptBody
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.DeviceBody
import io.zakiai.workspace.core.net.EncryptedCookieJar
import io.zakiai.workspace.core.net.LoginBody
import io.zakiai.workspace.core.net.Me
import io.zakiai.workspace.core.net.PasswordChangeBody
import io.zakiai.workspace.core.net.ThemeBody
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.core.sync.Schedules
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** Where the person stands: not signed in · signed in but owing the onboarding · in. */
enum class Gate { SIGNED_OUT, ONBOARDING, IN }

/**
 * WHO IS SIGNED IN, and everything that follows from it. The session is the site's own cookie ([EncryptedCookieJar]); the
 * person's profile comes from `/api/me`. Signing in pairs the phone as a device of the person (the live line's key, `/api/me/app-devices`);
 * signing out removes it, ends the session on the server, and wipes everything the app kept (the cache, the outbox, the cookies).
 * Any 401 from any screen comes here ([expired]) and the app goes back to the sign-in screen, saying why.
 */
@Singleton
class Session @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: WorkspaceApi,
    private val jar: EncryptedCookieJar,
    private val db: ZakiDb,
    private val look: LookSettings,
    private val schedules: Schedules,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _gate = MutableStateFlow(if (jar.hasSession()) Gate.IN else Gate.SIGNED_OUT)
    val gate: StateFlow<Gate> = _gate.asStateFlow()

    private val _me = MutableStateFlow<Me?>(null)
    val me: StateFlow<Me?> = _me.asStateFlow()

    /** Why the last session ended, shown once on the sign-in screen. */
    private val _endedBecause = MutableStateFlow<String?>(null)
    val endedBecause: StateFlow<String?> = _endedBecause.asStateFlow()

    /** Reads who the person is (at start and after the onboarding). Offline keeps them signed in: the screens say so. */
    suspend fun refresh(): ApiResult<Me> {
        val r = apiCall { api.me().user }
        when (r) {
            is ApiResult.Ok -> {
                _me.value = r.value
                _gate.value = if (r.value.mustChangePassword || r.value.transparencyPending) Gate.ONBOARDING else Gate.IN
                // the person's own theme follows them to this phone, until they pick one here
                r.value.theme?.takeIf { it != "system" }?.let { if (!look.chosenHere) look.setTheme(it) }
            }
            is ApiResult.Err -> if (r.failure.signedOut) expired(r.failure)
        }
        return r
    }

    suspend fun signIn(identifier: String, password: String): ApiResult<Unit> {
        val r = apiCall { api.login(LoginBody(identifier.trim(), password)) }
        if (r is ApiResult.Err) return r
        _endedBecause.value = null
        refresh()
        if (_gate.value == Gate.SIGNED_OUT) _gate.value = Gate.IN
        pairPhone()
        return ApiResult.Ok(Unit)
    }

    suspend fun changePassword(current: String, new: String): ApiResult<Unit> =
        when (val r = apiCall { api.changePassword(PasswordChangeBody(current, new)) }) {
            is ApiResult.Ok -> { refresh(); ApiResult.Ok(Unit) }
            is ApiResult.Err -> r
        }

    suspend fun acceptNotice(): ApiResult<Unit> =
        when (val r = apiCall { api.acceptNotice(AcceptBody()) }) {
            is ApiResult.Ok -> { refresh(); ApiResult.Ok(Unit) }
            is ApiResult.Err -> r
        }

    /** A theme picked on the phone is saved for the person, so the site shows it too. */
    fun pickTheme(key: String) {
        look.setTheme(key)
        look.chosenHere = true
        scope.launch { apiCall { api.saveTheme(ThemeBody(key)) } }
    }

    /** The phone becomes a device of the person: the key the live line (StreamService) uses for notifications and the call ring. */
    private suspend fun pairPhone() {
        val r = apiCall { api.registerDevice(DeviceBody(Build.MODEL ?: "Android")) }
        if (r is ApiResult.Ok && r.value.token.isNotEmpty()) {
            Config.setToken(context, r.value.token, r.value.id)
            withContext(Dispatchers.Main) { StreamService.start(context) }
        }
        schedules.ensure()
    }

    /** Re-pairs a phone that was signed in by the app before 4.0 but never paired, or whose pairing was removed. */
    fun ensurePaired() {
        if (_gate.value == Gate.SIGNED_OUT) return
        if (Config.token(context).isEmpty()) scope.launch { pairPhone() } else StreamService.start(context)
    }

    suspend fun signOut() {
        val device = Config.deviceId(context)
        if (device.isNotEmpty()) apiCall { api.removeDevice(device) }
        apiCall { api.logout() }
        wipe(null)
    }

    /** The server no longer honours the session (it expired, «سجّل خروج من كل مكان», the person was suspended). */
    fun expired(failure: ApiFailure) {
        if (_gate.value == Gate.SIGNED_OUT) return
        scope.launch { wipe(failure.message) }
    }

    private suspend fun wipe(reason: String?) {
        Config.clearToken(context)
        context.stopService(Intent(context, StreamService::class.java))
        WorkManager.getInstance(context).cancelAllWork()
        jar.clear()
        // the in-app page of the site (⚠️ WebBridge) forgets the session too
        withContext(Dispatchers.Main) {
            runCatching { android.webkit.CookieManager.getInstance().apply { removeAllCookies(null); flush() } }
        }
        withContext(Dispatchers.IO) {
            db.cache().clear()
            db.outbox().clear()
        }
        _me.value = null
        _endedBecause.value = reason
        _gate.value = Gate.SIGNED_OUT
    }

    fun consumeEndedReason() { _endedBecause.value = null }
}
