package io.zakiai.workspace.feature.chat

import android.Manifest
import android.content.pm.PackageManager
import android.widget.VideoView
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.Poll
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import io.zakiai.workspace.core.net.Attachment
import io.zakiai.workspace.core.net.ChatSend
import io.zakiai.workspace.core.net.ChecklistDraft
import io.zakiai.workspace.core.net.PollDraft
import io.zakiai.workspace.ui.theme.Zk

/** The files waiting to go with the next message: each with its state; a failed one is tried again with a tap. */
@Composable
fun Uploads(vm: ConversationViewModel, files: ChatFiles) {
    val ups by files.ready(vm.id).collectAsStateWithLifecycle()
    if (ups.isEmpty()) return
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (u in ups) {
            Box(Modifier.size(64.dp).clip(RoundedCornerShape(8.dp)).background(Zk.colors.surface2).clickable(enabled = u.state == "failed") { files.retry(vm.id, u) }, contentAlignment = Alignment.Center) {
                if (u.kind == "IMAGE" && u.source != null) AsyncImage(model = u.source, contentDescription = u.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                else Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.AutoMirrored.Filled.InsertDriveFile, contentDescription = null, tint = Zk.colors.fgMuted)
                    Text(u.name, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 2.dp))
                }
                when (u.state) {
                    "uploading" -> CircularProgressIndicator(color = Zk.colors.accent, modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    "failed" -> Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Refresh, contentDescription = u.failure ?: C.uploadFailed, tint = Color.White)
                    }
                }
                Box(Modifier.align(Alignment.TopEnd).size(20.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.5f)).clickable { files.remove(vm.id, u.key) }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Close, contentDescription = C.remove, tint = Color.White, modifier = Modifier.size(14.dp))
                }
            }
        }
    }
}

/** «أرفق»: pictures and videos, a file, and (where the server allows) a poll or a list. */
@Composable
fun AttachButton(vm: ConversationViewModel, files: ChatFiles) {
    var open by remember { mutableStateOf(false) }
    var poll by remember { mutableStateOf(false) }
    var list by remember { mutableStateOf(false) }
    val header by vm.header.collectAsStateWithLifecycle()
    val media = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(ChatFiles.MAX)) { uris -> if (uris.isNotEmpty()) files.add(vm.id, uris) }
    val docs = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris -> if (uris.isNotEmpty()) files.add(vm.id, uris, asFile = true) }
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Filled.AttachFile, contentDescription = C.attach, tint = Zk.colors.fgMuted) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(C.photo) }, leadingIcon = { Icon(Icons.Filled.Photo, null) }, onClick = {
                open = false; media.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
            })
            DropdownMenuItem(text = { Text(C.file) }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null) }, onClick = { open = false; docs.launch("*/*") })
            if (header?.me?.canPoll == true) DropdownMenuItem(text = { Text(C.poll) }, leadingIcon = { Icon(Icons.Filled.Poll, null) }, onClick = { open = false; poll = true })
            if (header?.me?.canChecklist == true) DropdownMenuItem(text = { Text(C.checklist) }, leadingIcon = { Icon(Icons.Filled.Checklist, null) }, onClick = { open = false; list = true })
        }
    }
    if (poll) PollDialog(onClose = { poll = false }) { q, options, multiple, anonymous ->
        vm.sendRich { id -> ChatSend(body = q, clientId = id, poll = PollDraft(options, multiple, anonymous)) }
    }
    if (list) ChecklistDialog(onClose = { list = false }) { title, items ->
        vm.sendRich { id -> ChatSend(body = title, clientId = id, checklist = ChecklistDraft(items)) }
    }
}

/** The microphone: a tap starts recording, a second tap sends, ✕ throws it away. The permission is asked the first time. */
@Composable
fun VoiceButton(vm: ConversationViewModel, files: ChatFiles) {
    val context = LocalContext.current
    val recording by files.recording.collectAsStateWithLifecycle()
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) files.startRecording() }
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (recording) {
            IconButton(onClick = { files.stopRecording(vm.id, send = false) {} }) { Icon(Icons.Filled.Close, contentDescription = C.cancel, tint = Zk.colors.danger) }
        }
        IconButton(onClick = {
            when {
                recording -> files.stopRecording(vm.id, send = true) { uploaded -> vm.send("", listOf(uploaded), voice = true) }
                ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> files.startRecording()
                else -> ask.launch(Manifest.permission.RECORD_AUDIO)
            }
        }) {
            Icon(Icons.Filled.Mic, contentDescription = if (recording) C.recording else C.record, tint = if (recording) Zk.colors.danger else Zk.colors.accent)
        }
    }
}

/** A picture (pinch to zoom) or a video, full screen; swipe between the pictures of one message; ⤓ downloads. */
@Composable
fun MediaViewer(media: List<Attachment>, start: Int, files: ChatFiles, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val pager = rememberPagerState(initialPage = start) { media.size }
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize()) { i ->
                val a = media[i]
                if (a.kind == "VIDEO") {
                    AndroidView(factory = { ctx ->
                        VideoView(ctx).apply {
                            setVideoURI(android.net.Uri.parse(absolute(a.url)), files.headers(a.url))
                            setMediaController(android.widget.MediaController(ctx).also { it.setAnchorView(this) })
                            setOnPreparedListener { start() }
                        }
                    }, modifier = Modifier.fillMaxSize())
                } else {
                    var scale by remember { mutableFloatStateOf(1f) }
                    var dx by remember { mutableFloatStateOf(0f) }
                    var dy by remember { mutableFloatStateOf(0f) }
                    val state = rememberTransformableState { zoom, pan, _ ->
                        scale = (scale * zoom).coerceIn(1f, 5f)
                        if (scale > 1f) { dx += pan.x; dy += pan.y } else { dx = 0f; dy = 0f }
                    }
                    AsyncImage(
                        model = absolute(a.url),
                        contentDescription = a.name,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize()
                            .pointerInput(Unit) { detectTapGestures(onDoubleTap = { scale = if (scale > 1f) 1f else 2.5f; dx = 0f; dy = 0f }) }
                            .transformable(state, enabled = true)
                            .graphicsLayer { scaleX = scale; scaleY = scale; translationX = dx; translationY = dy },
                    )
                }
            }
            // a dark strip behind the buttons: white icons over a light picture would not be seen
            Row(Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.5f)).statusBarsPadding().padding(8.dp)) {
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = C.cancel, tint = Color.White) }
                Spacer(Modifier.weight(1f))
                if (media.size > 1) Text("${pager.currentPage + 1} / ${media.size}", color = Color.White, modifier = Modifier.align(Alignment.CenterVertically))
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { files.download(media[pager.currentPage]) {} }) { Icon(Icons.Filled.Download, contentDescription = C.download, tint = Color.White) }
            }
        }
    }
}

/** «استطلاع»: a question and 2–10 options, one or several answers, with or without names. */
@Composable
private fun PollDialog(onClose: () -> Unit, send: (String, List<String>, Boolean, Boolean) -> Unit) {
    var question by remember { mutableStateOf("") }
    val options = remember { mutableStateListOf("", "") }
    var multiple by remember { mutableStateOf(false) }
    var anonymous by remember { mutableStateOf(false) }
    val ready = question.isNotBlank() && options.count { it.isNotBlank() } >= 2
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(C.poll) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(question, { question = oneLine(it).take(300) }, label = { Text(C.question) }, singleLine = true, keyboardOptions = NEXT, modifier = Modifier.fillMaxWidth())
                options.forEachIndexed { i, o ->
                    OutlinedTextField(o, { options[i] = it.take(100) }, label = { Text("${C.option} ${i + 1}") }, singleLine = true, keyboardOptions = NEXT, modifier = Modifier.fillMaxWidth())
                }
                if (options.size < 10) TextButton(onClick = { options.add("") }) { Text(C.addOption, color = Zk.colors.accent) }
                Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(multiple, { multiple = it }); Text(C.multiple) }
                Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(anonymous, { anonymous = it }); Text(C.anonymous) }
            }
        },
        confirmButton = { TextButton(enabled = ready, onClick = { send(question.trim(), options.map { it.trim() }.filter { it.isNotEmpty() }, multiple, anonymous); onClose() }) { Text(C.create) } },
        dismissButton = { TextButton(onClick = onClose) { Text(C.cancel) } },
    )
}

/** «قائمة مهام»: a title and 1–30 items. */
@Composable
private fun ChecklistDialog(onClose: () -> Unit, send: (String, List<String>) -> Unit) {
    var title by remember { mutableStateOf("") }
    val items = remember { mutableStateListOf("") }
    val ready = title.isNotBlank() && items.any { it.isNotBlank() }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(C.checklist) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(title, { title = oneLine(it).take(200) }, label = { Text(C.listTitle) }, singleLine = true, keyboardOptions = NEXT, modifier = Modifier.fillMaxWidth())
                items.forEachIndexed { i, o ->
                    OutlinedTextField(o, { items[i] = it.take(200) }, label = { Text("${C.item} ${i + 1}") }, singleLine = true, keyboardOptions = NEXT, modifier = Modifier.fillMaxWidth())
                }
                if (items.size < 30) TextButton(onClick = { items.add("") }) { Text(C.addItem, color = Zk.colors.accent) }
            }
        },
        confirmButton = { TextButton(enabled = ready, onClick = { send(title.trim(), items.map { it.trim() }.filter { it.isNotEmpty() }); onClose() }) { Text(C.create) } },
        dismissButton = { TextButton(onClick = onClose) { Text(C.cancel) } },
    )
}

/** The fields of a poll or a list: one line each, آ«ط§ظ„طھط§ظ„ظٹآ» moves to the next one. */
private fun oneLine(s: String) = s.replace('\n', ' ').replace('\t', ' ')

private val NEXT =androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Next)
