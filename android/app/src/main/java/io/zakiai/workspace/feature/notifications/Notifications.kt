package io.zakiai.workspace.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
                    Column(
                        Modifier.fillMaxWidth()
                            .background(if (unread) Zk.colors.selectedRow else Zk.colors.surface)
                            .clickable {
                                vm.readOne(n.id)
                                n.linkUrl?.let(onOpenPath)
                            }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                    ) {
                        Text(n.title, style = MaterialTheme.typography.titleSmall, fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal)
                        if (!n.body.isNullOrBlank()) Text(n.body, style = MaterialTheme.typography.bodyMedium, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 2.dp))
                        Text(shortTime(n.createdAt), style = MaterialTheme.typography.labelSmall, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 4.dp))
                    }
                    HorizontalDivider(color = Zk.colors.border)
                }
            }
        }
    }
}
