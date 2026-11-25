package io.zakiai.workspace.feature.calls

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.lifecycle.HiltViewModel
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.track.VideoTrack
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.theme.Zk
import javax.inject.Inject

@HiltViewModel
class CallViewModel @Inject constructor(val engine: CallEngine) : ViewModel()

/**
 * THE CALL SCREEN (the site's call page, src/components/calls/call-room.tsx): the people as tiles (their camera or screen, else their
 * picture; a ring of the accent while one speaks; the muted microphone marked), the title and where the call stands on top, and the
 * controls at the bottom — the microphone, the camera, flipping it, the loudspeaker, and the red «اطلع» (with «إنهاء للكل» for the host).
 * «رجوع» leaves the screen, not the call: it goes on in the background with its notification.
 */
@Composable
fun CallScreen(callId: String, onBack: () -> Unit, vm: CallViewModel = hiltViewModel()) {
    val engine = vm.engine
    val ui by engine.ui.collectAsStateWithLifecycle()
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { engine.join(callId) }
    // asked once per screen, saved across a rotation: coming back to the screen never joins a call again by itself
    var asked by androidx.compose.runtime.saveable.rememberSaveable(callId) { androidx.compose.runtime.mutableStateOf(false) }
    LaunchedEffect(callId) {
        if (asked) return@LaunchedEffect
        asked = true
        // the microphone (and the camera) are asked for once, then the site's room is joined whatever the answer (listening needs neither)
        ask.launch(arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA, Manifest.permission.BLUETOOTH_CONNECT))
    }
    // the microphone's button asks again when it was refused, then opens it
    val askMic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) engine.toggleMic() }
    val context = androidx.compose.ui.platform.LocalContext.current
    val micAllowed = { androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED }
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, tint = Zk.colors.fg) { if (ui.phase == "ended") engine.dismiss(); onBack() }
            Column(Modifier.weight(1f).padding(horizontal = 6.dp)) {
                val d = ui.detail
                Text(d?.conversationTitle ?: d?.title ?: K.pageTitle, color = Zk.colors.fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    when (ui.phase) {
                        "connecting" -> K.connecting
                        "lost" -> K.reconnecting
                        "ended" -> ui.endText ?: K.ended
                        else -> if (d?.video == true) K.video else K.audio
                    },
                    color = Zk.colors.fgMuted,
                    fontSize = 13.sp,
                )
                ui.notice?.let { Text(it, color = Zk.colors.warn, fontSize = 12.sp, modifier = Modifier.clickable { engine.consumeNotice() }) }
            }
            if (ui.detail?.can?.end == true && ui.phase == "in") TextButton(onClick = { engine.endForAll() }) { Text(K.endAll, color = Zk.colors.danger) }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (ui.phase == "ended") {
                Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(ui.endText ?: K.ended, color = Zk.colors.fg, fontSize = 18.sp)
                }
            } else {
                val cols = if (ui.peers.size <= 1) 1 else 2
                LazyVerticalGrid(GridCells.Fixed(cols), Modifier.fillMaxSize(), contentPadding = PaddingValues(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(ui.peers, key = { it.id + it.isMe }) { p -> Tile(p, engine, tall = cols == 1, mirror = p.isMe && ui.frontCamera) }
                }
            }
        }
        if (ui.phase != "ended") {
            Row(Modifier.fillMaxWidth().padding(vertical = 18.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                Control(if (ui.micOn) Icons.Filled.Mic else Icons.Filled.MicOff, if (ui.micOn) K.micOff else K.micOn, on = ui.micOn) { if (!ui.micOn && !micAllowed()) askMic.launch(Manifest.permission.RECORD_AUDIO) else engine.toggleMic() }
                Control(if (ui.camOn) Icons.Filled.Videocam else Icons.Filled.VideocamOff, if (ui.camOn) K.camOff else K.camOn, on = ui.camOn) { engine.toggleCamera() }
                if (ui.camOn) Control(Icons.Filled.Cameraswitch, K.flip, on = false) { engine.flipCamera() }
                Control(Icons.AutoMirrored.Filled.VolumeUp, K.speaker, on = ui.speaker) { engine.toggleSpeaker() }
                Box(Modifier.size(64.dp).clip(CircleShape).background(Zk.colors.danger).clickable { engine.leave() }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.CallEnd, K.leave, tint = Zk.colors.dangerFg, modifier = Modifier.size(28.dp))
                }
            }
        } else {
            TextButton(onClick = { engine.dismiss(); onBack() }, modifier = Modifier.align(Alignment.CenterHorizontally).padding(16.dp)) { Text(T.back, color = Zk.colors.accent) }
        }
    }
}

@Composable
private fun Control(icon: ImageVector, label: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(54.dp).clip(CircleShape).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, tint = if (on) Zk.colors.accentFg else Zk.colors.fg, modifier = Modifier.size(24.dp)) }
}

/** One person: their video when they show one, else their picture; the accent ring while they speak; «المايك مسكّر» marked. */
@Composable
private fun Tile(p: CallPeer, engine: CallEngine, tall: Boolean, mirror: Boolean) {
    val shape = RoundedCornerShape(18.dp)
    Box(
        Modifier.fillMaxWidth().then(if (tall) Modifier.aspectRatio(0.75f) else Modifier.aspectRatio(0.8f)).clip(shape).background(Zk.colors.surface1)
            .then(if (p.speaking) Modifier.border(3.dp, Zk.colors.accent, shape) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        val track = p.video
        if (track != null) androidx.compose.runtime.key(track) { VideoView(track, engine, mirror = mirror) }
        else Avatar(p.name, size = 84.dp)
        Row(
            Modifier.align(Alignment.BottomStart).padding(8.dp).clip(RoundedCornerShape(50)).background(Zk.colors.scrim.copy(alpha = 0.55f)).padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!p.micOn) { Icon(Icons.Filled.MicOff, K.muted, tint = Zk.colors.onPhoto, modifier = Modifier.size(14.dp)); Spacer(Modifier.size(4.dp)) }
            Text(if (p.isMe) K.you else p.name, color = Zk.colors.onPhoto, fontSize = 12.sp, maxLines = 1)
        }
    }
}

/** A video track drawn by LiveKit's own renderer, initialised on the room and detached when the tile goes. */
@Composable
private fun VideoView(track: VideoTrack, engine: CallEngine, mirror: Boolean) {
    val room = engine.currentRoom() ?: return
    val holder = remember(track) { arrayOfNulls<TextureViewRenderer>(1) }
    AndroidView(
        factory = { ctx ->
            TextureViewRenderer(ctx).also { v ->
                room.initVideoRenderer(v)
                v.setMirror(mirror)
                track.addRenderer(v)
                holder[0] = v
            }
        },
        // the mirror follows the camera: the front one is drawn as a mirror, the back one is not
        update = { v -> v.setMirror(mirror) },
        modifier = Modifier.fillMaxSize(),
    )
    DisposableEffect(track) {
        onDispose { holder[0]?.let { r -> runCatching { track.removeRenderer(r); r.release() } } }
    }
}
