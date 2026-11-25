package io.zakiai.workspace.feature.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.twilio.audioswitch.AudioDevice
import dagger.hilt.android.qualifiers.ApplicationContext
import io.livekit.android.LiveKit
import io.livekit.android.RoomOptions
import io.livekit.android.audio.AudioSwitchHandler
import io.livekit.android.events.RoomEvent
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.CameraPosition
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.CallDetail
import io.zakiai.workspace.core.net.CallTokenBody
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
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** One person in the call as the screen draws them. */
data class CallPeer(val id: String, val name: String, val isMe: Boolean, val speaking: Boolean, val micOn: Boolean, val video: VideoTrack?)

data class CallUi(
    val callId: String? = null,
    val detail: CallDetail? = null,
    /** idle · connecting · in · lost (rejoining) · ended */
    val phase: String = "idle",
    val micOn: Boolean = false,
    val camOn: Boolean = false,
    val frontCamera: Boolean = true,
    val speaker: Boolean = false,
    val peers: List<CallPeer> = emptyList(),
    val endText: String? = null,
    /** a line under the title while the call runs (the microphone or camera refused, «/end» refused) */
    val notice: String? = null,
)

/**
 * THE CALL, native (M2 N5): the site's own LiveKit room `zk-<callId>` joined with the pass the site signs (`POST /api/calls/[id]/token`),
 * so a call between the phone and the site connects both ways. The site's rules: the microphone opens at once only in a DM or for the starter,
 * a network drop rejoins quietly (6 tries, the site's backoff), a final reason ends it (left, removed, the room closed; another device of the
 * same person took the seat). It lives for the app's whole life; a foreground service keeps it while the screen is off.
 *
 * Every connect is one ATTEMPT: after each wait it checks it is still the current one, so «اطلع» while connecting, or another call, never
 * brings an old attempt back to life; events of a room that is not the current one are ignored; what the person chose (microphone, camera,
 * loudspeaker) is kept apart from what a room reports, so a rejoin gives it back.
 */
@Singleton
class CallEngine @Inject constructor(@ApplicationContext private val context: Context, private val api: WorkspaceApi) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _ui = MutableStateFlow(CallUi())
    val ui: StateFlow<CallUi> = _ui.asStateFlow()

    private var room: Room? = null
    private var events: Job? = null
    private var poll: Job? = null
    private var connecting: Job? = null
    private var attempt = 0
    private var rejoins = 0
    /** this attempt's drop was already handled (the SDK reports a failed connect twice: its event, then the exception) */
    private var dropHandled = false
    private var serviceOn = false
    /** what the person chose, kept across rejoins (a room being torn down reports everything off) */
    private var wantMic = false
    private var wantCam = false
    private var wantSpeaker: Boolean? = null

    /** The room, for the screen's video renderers. */
    fun currentRoom(): Room? = room

    /**
     * Joins [callId]. A call already running or ended on screen is left as it is (a rotation or a return to the screen never joins
     * again); [again] is the person's own «join» after an end.
     */
    fun join(callId: String, again: Boolean = false) {
        val now = _ui.value
        if (now.callId == callId && (now.phase in setOf("connecting", "in", "lost") || (now.phase == "ended" && !again))) return
        if (now.callId != null && now.phase in setOf("in", "lost", "connecting")) leave()
        attempt++
        rejoins = 0
        wantMic = false
        wantCam = false
        wantSpeaker = null
        _ui.value = CallUi(callId = callId, phase = "connecting")
        val my = attempt
        connecting = scope.launch { connect(callId, my, first = true) }
    }

    private fun alive(my: Int, callId: String) = attempt == my && _ui.value.callId == callId && _ui.value.phase != "ended"

    private suspend fun connect(callId: String, my: Int, first: Boolean) {
        dropHandled = false
        val detailAnswer = apiCall { api.callDetail(callId) }
        if (!alive(my, callId)) return
        val detail = (detailAnswer as? ApiResult.Ok)?.value
        if (detail == null) {
            // offline on a rejoin is one more drop, not the end; the first connect says why it cannot
            if (!first && (detailAnswer as ApiResult.Err).failure.offline) onDrop(callId, my) else finish(callId, K.failed)
            return
        }
        if (detail.endedAt != null) { finish(callId, CallRules.endText(detail, removed = false)); return }
        _ui.update { it.copy(detail = detail) }
        // a pass that does not stamp «joined» yet: «/joined» is said once the room is really entered (missed-call detection stays right)
        val passAnswer = apiCall { api.callToken(callId, CallTokenBody(prefetch = true)) }
        if (!alive(my, callId)) return
        val pass = when (passAnswer) {
            is ApiResult.Ok -> passAnswer.value
            is ApiResult.Err -> {
                when {
                    passAnswer.failure.key == "calls.e.not_configured" -> finish(callId, K.notConfigured)
                    !first && passAnswer.failure.offline -> onDrop(callId, my)
                    else -> finish(callId, passAnswer.failure.message)
                }
                return
            }
        }
        val r = LiveKit.create(context, RoomOptions(adaptiveStream = true, dynacast = true))
        room = r
        events?.cancel()
        events = scope.launch { r.events.events.collect { e -> if (e.room === room && attempt == my) onEvent(callId, my, e) } }
        val ok = runCatching { r.connect(pass.url, pass.token) }.isSuccess
        if (!alive(my, callId)) { runCatching { r.disconnect(); r.release() }; return }
        if (!ok) { onDrop(callId, my); return }
        apiCall { api.callJoined(callId) }
        if (!alive(my, callId)) return
        if (first) {
            wantMic = CallRules.micOnAtJoin(detail) && granted(Manifest.permission.RECORD_AUDIO)
            wantCam = detail.video && CallRules.micOnAtJoin(detail) && granted(Manifest.permission.CAMERA)
            if (CallRules.micOnAtJoin(detail) && !granted(Manifest.permission.RECORD_AUDIO)) _ui.update { it.copy(notice = K.noMedia) }
        }
        if (wantMic) runCatching { r.localParticipant.setMicrophoneEnabled(true) }
        if (wantCam) runCatching { r.localParticipant.setCameraEnabled(true) }
        // a video call starts on the loudspeaker, an audio call on the earpiece (as a phone call does); a rejoin keeps the person's choice
        applySpeaker(wantSpeaker ?: detail.video)
        rejoins = 0
        _ui.update { it.copy(phase = "in") }
        refresh()
        startService()
        poll?.cancel()
        poll = scope.launch { while (true) { delay(15_000); if (!alive(my, callId)) break; recheck(callId) } }
    }

    private fun onEvent(callId: String, my: Int, e: RoomEvent) {
        when (e) {
            is RoomEvent.Disconnected -> {
                val reason = e.reason?.name
                when {
                    reason == "PARTICIPANT_REMOVED" -> finish(callId, CallRules.endText(_ui.value.detail, removed = true))
                    // the same person took the seat on another device: the call goes on there
                    reason == "DUPLICATE_IDENTITY" -> finish(callId, K.elsewhere)
                    CallRules.isDrop(reason) -> onDrop(callId, my)
                    else -> scope.launch { recheck(callId); finish(callId, CallRules.endText(_ui.value.detail, removed = false)) }
                }
            }
            is RoomEvent.Reconnecting -> _ui.update { it.copy(phase = "lost") }
            is RoomEvent.Reconnected -> _ui.update { it.copy(phase = "in") }
            else -> if (_ui.value.phase == "in") refresh()
        }
    }

    private fun onDrop(callId: String, my: Int) {
        if (!alive(my, callId) || dropHandled) return
        dropHandled = true
        rejoins++
        if (rejoins > CallRules.MAX_REJOINS) { finish(callId, K.failed); return }
        _ui.update { it.copy(phase = "lost") }
        events?.cancel()
        room?.let { runCatching { it.disconnect(); it.release() } }
        room = null
        connecting = scope.launch {
            delay(CallRules.rejoinDelayMs(rejoins))
            if (!alive(my, callId)) return@launch
            connect(callId, my, first = false)
        }
    }

    /** The site's detail again: the people and what the person may do, and whether the call ended meanwhile. */
    private suspend fun recheck(callId: String) {
        val d = (apiCall { api.callDetail(callId) } as? ApiResult.Ok)?.value ?: return
        if (_ui.value.callId != callId) return
        _ui.update { it.copy(detail = d) }
        if (d.endedAt != null) finish(callId, CallRules.endText(d, removed = false))
    }

    /** Who is in the room now, with their camera (or screen) track and whether they speak. */
    fun refresh() {
        val r = room ?: return
        val me = r.localParticipant
        val peers = buildList {
            add(peerOf(me, isMe = true))
            for (p in r.remoteParticipants.values) add(peerOf(p, isMe = false))
        }
        val micOn = me.getTrackPublication(Track.Source.MICROPHONE)?.let { !it.muted } ?: false
        val camOn = me.getTrackPublication(Track.Source.CAMERA)?.let { !it.muted } ?: false
        _ui.update { it.copy(peers = peers, micOn = micOn, camOn = camOn) }
    }

    private fun peerOf(p: Participant, isMe: Boolean): CallPeer {
        val screen = p.getTrackPublication(Track.Source.SCREEN_SHARE)?.track as? VideoTrack
        val cam = p.getTrackPublication(Track.Source.CAMERA)?.takeIf { !it.muted }?.track as? VideoTrack
        val mic = p.getTrackPublication(Track.Source.MICROPHONE)?.let { !it.muted } ?: false
        return CallPeer(id = p.identity?.value ?: "", name = p.name ?: "", isMe = isMe, speaking = p.isSpeaking, micOn = mic, video = screen ?: cam)
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    fun toggleMic() = scope.launch {
        val r = room ?: return@launch
        if (!_ui.value.micOn && !granted(Manifest.permission.RECORD_AUDIO)) { _ui.update { it.copy(notice = K.noMedia) }; return@launch }
        wantMic = !_ui.value.micOn
        val ok = runCatching { r.localParticipant.setMicrophoneEnabled(wantMic) }.isSuccess
        if (!ok) _ui.update { it.copy(notice = K.noMedia) }
        refresh()
    }

    fun toggleCamera() = scope.launch {
        val r = room ?: return@launch
        if (!_ui.value.camOn && !granted(Manifest.permission.CAMERA)) { _ui.update { it.copy(notice = K.noMedia) }; return@launch }
        wantCam = !_ui.value.camOn
        val ok = runCatching { r.localParticipant.setCameraEnabled(wantCam) }.isSuccess
        if (!ok) _ui.update { it.copy(notice = K.noMedia) }
        refresh()
    }

    fun flipCamera() {
        val track = room?.localParticipant?.getTrackPublication(Track.Source.CAMERA)?.track as? LocalVideoTrack ?: return
        val toBack = _ui.value.frontCamera
        if (runCatching { track.switchCamera(position = if (toBack) CameraPosition.BACK else CameraPosition.FRONT) }.isSuccess) {
            _ui.update { it.copy(frontCamera = !toBack) }
        }
    }

    fun toggleSpeaker() {
        wantSpeaker = !_ui.value.speaker
        applySpeaker(wantSpeaker!!)
    }

    private fun applySpeaker(on: Boolean) {
        val h = room?.audioHandler as? AudioSwitchHandler ?: return
        val devices = h.availableAudioDevices
        // a headset or Bluetooth wins over the earpiece when the loudspeaker is off
        val pick = if (on) devices.firstOrNull { it is AudioDevice.Speakerphone }
        else devices.firstOrNull { it is AudioDevice.BluetoothHeadset || it is AudioDevice.WiredHeadset } ?: devices.firstOrNull { it is AudioDevice.Earpiece }
        pick?.let { runCatching { h.selectDevice(it) } }
        _ui.update { it.copy(speaker = on) }
    }

    /** «اطلع»: out of the room, and the site told (`/leave`: a DM ends for both, a group when the room empties). */
    fun leave() {
        val callId = _ui.value.callId ?: return
        if (_ui.value.phase == "ended") return
        scope.launch { apiCall { api.callLeave(callId) } }
        finish(callId, K.ended)
    }

    /** «إنهاء للكل» (the host): the site ends it for everybody, then the person leaves; a refusal is said and the call goes on. */
    fun endForAll() {
        val callId = _ui.value.callId ?: return
        scope.launch {
            when (val r = apiCall { api.callEnd(callId) }) {
                is ApiResult.Ok -> finish(callId, K.ended)
                is ApiResult.Err -> _ui.update { it.copy(notice = r.failure.message) }
            }
        }
    }

    /** The host mutes somebody (the site mutes the track on the server). */
    fun mute(userId: String) {
        val callId = _ui.value.callId ?: return
        scope.launch { apiCall { api.callMute(callId, io.zakiai.workspace.core.net.CallUserBody(userId)) } }
    }

    /** «رفض» on a ringing call: the site told, so the caller stops ringing at once. */
    fun decline(callId: String) {
        scope.launch { apiCall { api.callDecline(callId) } }
    }

    fun consumeNotice() = _ui.update { it.copy(notice = null) }

    /** The foreground service, once per call, and only with something to keep (the microphone or the camera allowed). */
    private fun startService() {
        if (serviceOn) return
        if (!granted(Manifest.permission.RECORD_AUDIO) && !granted(Manifest.permission.CAMERA)) return
        serviceOn = true
        CallService.start(context)
    }

    private fun finish(callId: String, text: String) {
        if (_ui.value.callId != callId) return
        attempt++
        connecting?.cancel()
        poll?.cancel()
        events?.cancel()
        room?.let { runCatching { it.disconnect(); it.release() } }
        room = null
        if (serviceOn) { serviceOn = false; CallService.stop(context) }
        _ui.update { it.copy(phase = "ended", endText = text, peers = emptyList()) }
    }

    /** The screen was closed after the end: forget the call. */
    fun dismiss() {
        if (_ui.value.phase == "ended") _ui.value = CallUi()
    }
}
