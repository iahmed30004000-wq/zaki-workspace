package io.zakiai.workspace.ui

import android.graphics.Color
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.MainActivity
import io.zakiai.workspace.core.Gate
import io.zakiai.workspace.feature.auth.OnboardingScreen
import io.zakiai.workspace.feature.auth.SignInScreen
import io.zakiai.workspace.feature.shell.Shell
import io.zakiai.workspace.ui.theme.ZakiTheme
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.launch

/** Signed out → the sign-in · locked → the lock · owing the onboarding → the onboarding · otherwise the shell. */
@Composable
fun Root(activity: MainActivity) {
    val theme by activity.look.theme.collectAsStateWithLifecycle()
    val gate by activity.session.gate.collectAsStateWithLifecycle()
    val locked by activity.lock.locked.collectAsStateWithLifecycle()
    val ended by activity.session.endedBecause.collectAsStateWithLifecycle()
    val link by activity.link.collectAsStateWithLifecycle()

    ZakiTheme(theme) {
        Surface(Modifier.fillMaxSize(), color = Zk.colors.surface, contentColor = Zk.colors.fg) {
            // the clock and the icons of the system bars read on the theme's paper (light icons on a dark theme, dark on a light one)
            val dark = Zk.theme.dark
            LaunchedEffect(dark) {
                val style = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                activity.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            LaunchedEffect(gate) {
                if (gate != Gate.SIGNED_OUT) {
                    activity.session.refresh()
                    activity.session.ensurePaired()
                    activity.askNotificationPermission()
                }
            }
            when {
                gate == Gate.SIGNED_OUT -> SignInScreen(activity.session, ended)
                locked -> LockScreen(activity)
                gate == Gate.ONBOARDING -> OnboardingScreen(activity.session)
                else -> Shell(
                    link = link,
                    onLinkUsed = { activity.link.value = null },
                    makeBridge = activity::makeBridge,
                    askNotifications = activity::askNotificationPermission,
                )
            }
        }
    }
}

@Composable
private fun LockScreen(activity: MainActivity) {
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { activity.lock.prompt(activity, T.lockScreenTitle, T.unlockSubtitle) }
    Box(Modifier.fillMaxSize().background(Zk.colors.surface).padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(T.appName, style = MaterialTheme.typography.headlineLarge, color = Zk.colors.accent)
            Spacer(Modifier.height(16.dp))
            Text(T.lockScreenTitle, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { activity.lock.prompt(activity, T.lockScreenTitle, T.unlockSubtitle) },
                colors = ButtonDefaults.buttonColors(containerColor = Zk.colors.accent, contentColor = Zk.colors.accentFg),
            ) { Text(T.unlock) }
            TextButton(onClick = { scope.launch { activity.lock.setEnabled(false); activity.session.signOut() } }) { Text(T.logout, color = Zk.colors.danger) }
        }
    }
}
