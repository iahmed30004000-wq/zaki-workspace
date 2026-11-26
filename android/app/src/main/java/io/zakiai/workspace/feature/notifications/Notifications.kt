package io.zakiai.workspace.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Done
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Cache
import io.zakiai.workspace.core.Loadable
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.Notifications
import io.zakiai.workspace.core.net.ReadOne
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.shortTime
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class NotificationsViewModel @Inject constructor(
    private val api: WorkspaceApi,
    private val cache: Cache,
    private val session: Session,
) : ViewModel() {
    private val _state = MutableStateFlow(Loadable<Notifications>())
    val state: StateFlow<Loadable<Notifications>> = _state.asStateFlow()

    init {
        viewModelScope.launch { cache.read(KEY, Notifications.serializer())?.let { if (_state.value.data == null) _state.value = _state.value.copy(data = it) } }
    }

    fun refresh() {
        if (_state.value.refreshing) return
        _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            when (val r = cache.refresh(KEY, Notifications.serializer()) { apiCall { api.notifications() } }) {
                is ApiResult.Ok -> _state.value = Loadable(r.value)
                is ApiResult.Err -> {
                    if (r.failure.signedOut) session.expired(r.failure)
                    _state.value = _state.value.copy(failure = r.failure, refreshing = false)
                }
            }
        }
    }

    fun readAll() = viewModelScope.launch { apiCall { api.readAll() }; refresh() }

    fun readOne(id: String) = viewModelScope.launch { apiCall { api.readOne(ReadOne(id)) } }

    /** the row's own âœ“: read, without opening it (the site's panel) */
    fun markRead(id: String) = viewModelScope.launch { if (apiCall { api.readOne(ReadOne(id)) } is ApiResult.Ok) refresh() }

    /** the row's ًں—‘: the site's DELETE /api/notifications/[id] (one's own only) */
    fun delete(id: String) = viewModelScope.launch {
        _state.value.data?.let { d -> _state.value = _state.value.copy(data = d.copy(items = d.items.filter { it.id != id })) }
        apiCall { api.deleteNotification(id) }
        refresh()
    }

    companion object { const val KEY = "notifications" }
}

/** The bell's notifications. A tap marks one read and opens what it is about. */
@Composable
fun NotificationsScreen(onOpenPath: (String) -> Unit, vm: NotificationsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    WhileOnScreen(20_000) { vm.refresh() }
    val d = state.data
    Column(Modifier.fillMaxSize()) {
        if ((d?.unreadCount ?: 0) > 0) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { vm.readAll() }) { Text(T.markAllRead, color = Zk.colors.accent) }
            }
        }
        when {
            d == null && state.failure == null -> Loading()
            d == null -> Failure(state.failure!!.message, onRetry = vm::refresh)
            d.items.isEmpty() -> Empty(T.noNotifications)
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(d.items, key = { it.id }) { n ->
                    val unread = n.readAt == null
                    // the site's panel row: unread on the accent at 5% with a bold title, the time «قبل …», and its own ✓ and 🗑 (44 each)
                    Row(
                        Modifier.fillMaxWidth()
                            .background(if (unread) Zk.colors.accent.copy(alpha = 0.06f) else Zk.colors.surface)
                            .clickable {
                                vm.readOne(n.id)
                                n.linkUrl?.let(onOpenPath)
                            }
                            .padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(n.title, fontSize = 15.sp, color = Zk.colors.fg, fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal, maxLines = 2)
                            if (!n.body.isNullOrBlank()) Text(n.body, fontSize = 13.sp, lineHeight = 19.sp, color = Zk.colors.fgMuted, maxLines = 2, modifier = Modifier.padding(top = 2.dp))
                            Text(io.zakiai.workspace.ui.components.Ago.of(n.createdAt), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 4.dp))
                        }
                        if (unread) io.zakiai.workspace.ui.components.RoundIcon(androidx.compose.material.icons.Icons.Filled.Done, T.markRead, tint = Zk.colors.accent) { vm.markRead(n.id) }
                        io.zakiai.workspace.ui.components.RoundIcon(androidx.compose.material.icons.Icons.Filled.DeleteOutline, T.delete, tint = Zk.colors.fgMuted) { vm.delete(n.id) }
                    }
                    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f))
                }
            }
        }
    }
}
