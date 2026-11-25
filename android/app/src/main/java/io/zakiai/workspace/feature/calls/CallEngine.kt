package io.zakiai.workspace.feature.calls

import android.content.Context
import android.content.Intent
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
    val speaker: Boolean = false,
    val peers: List<CallPeer> = emptyList(),
    val endText: String? = null,
    val failure: String? = null,
)

/**
 * THE CALL, native (M2 N5): the site's own LiveKit room `zk-<callId>` joined with the pass the site signs (`POST /api/calls/[id]/token`),
 * so a call between the phone and the site connects both ways. The site's rules: the microphone opens at once only in a DM or for the starter,
 * a network drop rejoins quietly (6 tries, the site's backoff), a final reason ends it (left, removed, sat down on another device, room
 * closed). It lives for the app's whole life (a foreground service keeps it while the screen is off or another app is open).
 */
@Singleton
class CallEngine @Inject constructor(@ApplicationContext private val context: Context, private val api: WorkspaceApi) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _ui = MutableStateFlow(CallUi())
    val ui: StateFlow<CallUi> = _ui.asStateFlow()

    private var room: Room? = null
    private var events: Job? = null
    private var poll: Job? = null
    private var rejoins = 0
    private var leaving = false

    /** The room, for the screen's video renderers. */
    fun currentRoom(): Room? = room

    fun join(callId: String) {
        val now = _ui.value
        if (now.callId == callId && now.phase in setOf("connecting", "in", "lost")) return
        if (now.callId != null && now.callId != callId && now.phase in setOf("in", "lost", "connecting")) leave()
        leaving = false
        rejoins = 0
        _ui.value = CallUi(callId = callId, phase = "connecting")
        scope.launch { connect(callId, first = true) }
    }

    private suspend fun connect(callId: String, first: Boolean) {
        val detail = (apiCall { api.callDetail(callId) } as? ApiResult.Ok)?.value
        if (detail == null) { fail(callId, null); return }
        if (detail.endedAt != null) { finish(callId, CallRules.endText(detail, removed = false)); return }
        _ui.update { it.copy(detail = detail) }
        val pass = when (val r = apiCall { api.callToken(callId) }) {
            is ApiResult.Ok -> r.value
            is ApiResult.Err -> { fail(callId, if (r.failure.key == "calls.e.not_configured") K.notConfigured else r.failure.message); return }
        }
        val r = LiveKit.create(context, RoomOptions(adaptiveStream = true, dynacast = true))
        room = r
        events?.cancel()
        events = scope.launch { r.events.events.collect { e -> onEvent(callId, e) } }
        val ok = runCatching { r.connect(pass.url, pass.token) }.isSuccess
        if (!ok) { onDrop(callId); return }
        apiCall { api.callJoined(callId) }
        if (first) {
            if (CallRules.micOnAtJoin(detail)) runCatching { r.localParticipant.setMicrophoneEnabled(true) }
            if (detail.video && CallRules.micOnAtJoin(detail)) runCatching { r.localParticipant.setCameraEnabled(true) }
        } else {
            // a rejoin keeps what the person had on
            if (_ui.value.micOn) runCatching { r.localParticipant.setMicrophoneEnabled(true) }
            if (_ui.value.camOn) runCatching { r.localParticipant.setCameraEnabled(true) }
        }
        // a video call starts on the loudspeaker, an audio call on the earpiece (as a phone call does)
        setSpeaker(detail.video)
        rejoins = 0
        _ui.update { it.copy(phase = "in", failure = null) }
        refresh()
        CallService.start(context)
        poll?.cancel()
        poll = scope.launch { while (true) { delay(15_000); recheck(callId) } }
    }

    private fun onEvent(callId: String, e: RoomEvent) {
        when (e) {
            is RoomEvent.Disconnected -> {
                if (leaving) return
                val reason = e.reason?.name
                when {
                    reason == "PARTICIPANT_REMOVED" -> finish(callId, CallRules.endText(_ui.value.detail, removed = true))
                    CallRules.isDrop(reason) -> onDrop(callId)
                    else -> scope.launch { recheck(callId); finish(callId, CallRules.endText(_ui.value.detail, removed = false)) }
                }
            }
            is RoomEvent.Reconnecting -> _ui.update { it.copy(phase = "lost") }
            is RoomEvent.Reconnected -> _ui.update { it.copy(phase = "in") }
            else -> refresh()
        }
    }

    private fun onDrop(callId: String) {
        if (leaving || _ui.value.callId != callId) return
        rejoins++
        if (rejoins > CallRules.MAX_REJOINS) { fail(callId, K.reconnecting); return }
        _ui.update { it.copy(phase = "lost") }
        scope.launch {
            delay(CallRules.rejoinDelayMs(rejoins))
            if (leaving || _ui.value.callId != callId) return@launch
            room?.let { runCatching { it.disconnect(); it.release() } }
            room = null
            connect(callId, first = false)
        }
    }

    /** The site's detail again: the people and what the person may do, and whether the call ended meanwhile. */
    private suspend fun recheck(callId: String) {
        val d = (apiCall { api.callDetail(callId) } as? ApiResult.Ok)?.value ?: return
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

    fun toggleMic() = scope.launch {
        val r = room ?: return@launch
        runCatching { r.localParticipant.setMicrophoneEnabled(!_ui.value.micOn) }
        refresh()
    }

    fun toggleCamera() = scope.launch {
        val r = room ?: return@launch
        runCatching { r.localParticipant.setCameraEnabled(!_ui.value.camOn) }
        refresh()
    }

    fun flipCamera() {
        val track = room?.localParticipant?.getTrackPublication(Track.Source.CAMERA)?.track as? LocalVideoTrack ?: return
        val front = track.options.position != CameraPosition.BACK
        runCatching { track.switchCamera(position = if (front) CameraPosition.BACK else CameraPosition.FRONT) }
    }

    fun toggleSpeaker() = setSpeaker(!_ui.value.speaker)

    private fun setSpeaker(on: Boolean) {
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
        leaving = true
        scope.launch { apiCall { api.callLeave(callId) } }
        finish(callId, K.ended)
    }

    /** «إنهاء للكل» (the host): the site ends it for everybody. */
    fun endForAll() {
        val callId = _ui.value.callId ?: return
        leaving = true
        scope.launch { apiCall { api.callEnd(callId) } }
        finish(callId, K.ended)
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

    private fun finish(callId: String, text: String) {
        if (_ui.value.callId != callId) return
        leaving = true
        poll?.cancel()
        events?.cancel()
        room?.let { runCatching { it.disconnect(); it.release() } }
        room = null
        CallService.stop(context)
        _ui.update { it.copy(phase = "ended", endText = text, peers = emptyList()) }
    }

    private fun fail(callId: String, message: String?) {
        if (_ui.value.callId != callId) return
        finish(callId, message ?: K.ended)
        _ui.update { it.copy(failure = message) }
    }

    /** The screen was closed after the end: forget the call. */
    fun dismiss() {
        if (_ui.value.phase == "ended") _ui.value = CallUi()
    }
}
