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
import io.zakiai.workspace.core.sync.UserMark
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
 * Any 401 from any screen comes here ([expired]) and the app goes back to the sign-in screen, saying why; an expired session keeps
 * the person's own unsent messages for their next sign-in.
 */
@Singleton
class Session @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: WorkspaceApi,
    private val jar: EncryptedCookieJar,
    private val db: ZakiDb,
    private val look: LookSettings,
    private val schedules: Schedules,
    private val cache: Cache,
    private val user: UserMark,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    /** one pairing at a time: two screens asking at once must not register the phone twice */
    private val pairing = Mutex()

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
                adoptUser(r.value.id)
                _me.value = r.value
                _gate.value = if (r.value.mustChangePassword || r.value.transparencyPending) Gate.ONBOARDING else Gate.IN
                // the person's own theme follows them to this phone, until they pick one here
                r.value.theme?.takeIf { it != "system" }?.let { if (!look.chosenHere) look.setTheme(it) }
            }
            is ApiResult.Err -> if (r.failure.signedOut) expired(r.failure)
        }
        return r
    }

    /**
     * Another person than the last one on this phone: nothing of the last one's may stay — their unsent messages are dropped
     * (never sent in this person's name) and the screens' cache is emptied. The same person coming back keeps their outbox.
     */
    private suspend fun adoptUser(id: String) {
        if (id.isEmpty()) return
        val last = user.id
        if (last != null && last != id) {
            cache.bump()
            withContext(Dispatchers.IO) {
                db.outbox().dropOthers(id)
                db.cache().clear()
            }
        }
        if (last != id) user.id = id
    }

    /**
     * Runs on the session's own scope, not the sign-in screen's: the screen goes away as soon as the gate opens, and the pairing
     * that follows must not be cut off with it.
     */
    suspend fun signIn(identifier: String, password: String): ApiResult<Unit> = scope.async {
        val r = apiCall { api.login(LoginBody(identifier.trim(), password)) }
        if (r is ApiResult.Err) return@async r
        _endedBecause.value = null
        refresh()
        if (_gate.value == Gate.SIGNED_OUT) _gate.value = Gate.IN
        pairPhone()
        ApiResult.Ok(Unit)
    }.await()

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
        pairing.withLock {
            if (Config.token(context).isEmpty()) {
                val r = apiCall { api.registerDevice(DeviceBody(Build.MODEL ?: "Android")) }
                if (r is ApiResult.Ok && r.value.token.isNotEmpty()) Config.setToken(context, r.value.token, r.value.id)
            }
            if (Config.token(context).isNotEmpty()) withContext(Dispatchers.Main) { StreamService.start(context) }
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
        // signing out on purpose: nothing of this person stays, their unsent messages included
        wipe(null, keepOutbox = false)
        user.id = null
    }

    /**
     * The server no longer honours the session (it expired, «سجّل خروج من كل مكان», the person was suspended). The outbox is KEPT:
     * the same person signing in again gets their unsent messages sent; somebody else signing in drops them ([adoptUser]).
     */
    fun expired(failure: ApiFailure) {
        if (_gate.value == Gate.SIGNED_OUT) return
        scope.launch { wipe(failure.message, keepOutbox = true) }
    }

    private suspend fun wipe(reason: String?, keepOutbox: Boolean) {
        // an answer still on its way must not refill the cache after it is emptied
        cache.bump()
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
            if (!keepOutbox) db.outbox().clear()
        }
        _me.value = null
        _endedBecause.value = reason
        _gate.value = Gate.SIGNED_OUT
    }

    fun consumeEndedReason() { _endedBecause.value = null }
}
