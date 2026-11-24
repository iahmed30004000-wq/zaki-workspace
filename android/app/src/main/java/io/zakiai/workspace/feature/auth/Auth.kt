package io.zakiai.workspace.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.launch

/** The client-side check of a new password — the server's own rule (src/server/validation.ts `passwordShape`). Pure (unit-tested). */
object PasswordRule {
    /** The first thing wrong with it, as the sentence the screen shows, or null when it is fine. */
    fun problem(current: String, new: String, confirm: String): String? = when {
        new.length < 8 -> T.errMin8
        new.none { it in 'a'..'z' || it in 'A'..'Z' } -> T.errLetter
        new.none { it in '0'..'9' } -> T.errDigit
        new == current -> T.errSame
        new != confirm -> T.errMismatch
        else -> null
    }
}

@Composable
private fun PasswordField(value: String, onChange: (String) -> Unit, label: String, shown: Boolean, onToggle: (() -> Unit)?, ime: ImeAction, onIme: () -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = if (shown) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ime),
        keyboardActions = KeyboardActions(onAny = { onIme() }),
        trailingIcon = if (onToggle == null) null else {
            { IconButton(onClick = onToggle) { Icon(if (shown) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, contentDescription = if (shown) T.hidePassword else T.showPassword) } }
        },
        modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(),
    )
}

@Composable
private fun PrimaryButton(text: String, enabled: Boolean, busy: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        colors = ButtonDefaults.buttonColors(containerColor = Zk.colors.accent, contentColor = Zk.colors.accentFg),
        modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth().height(52.dp),
    ) {
        if (busy) CircularProgressIndicator(strokeWidth = 2.dp, color = Zk.colors.accentFg, modifier = Modifier.height(22.dp)) else Text(text, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun AuthColumn(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().statusBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) { content() }
}

/** «تسجيل الدخول»: a username or an e-mail, and the password. The reason the last session ended is said once. */
@Composable
fun SignInScreen(session: Session, endedBecause: String?) {
    var identifier by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var shown by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(endedBecause) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (busy || identifier.isBlank() || password.isEmpty()) return
        busy = true
        error = null
        session.consumeEndedReason()
        scope.launch {
            val r = session.signIn(identifier, password)
            if (r is ApiResult.Err) error = r.failure.message
            busy = false
        }
    }

    AuthColumn {
        Text(T.appName, style = MaterialTheme.typography.headlineLarge, color = Zk.colors.accent)
        Text(T.appTagline, style = MaterialTheme.typography.bodyLarge, color = Zk.colors.fgMuted)
        Spacer(Modifier.height(32.dp))
        Text(T.signIn, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Start, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth())
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = identifier,
            onValueChange = { identifier = it },
            label = { Text(T.identifier) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        PasswordField(password, { password = it }, T.password, shown, { shown = !shown }, ImeAction.Done) { submit() }
        if (error != null) {
            Spacer(Modifier.height(12.dp))
            Text(error!!, color = Zk.colors.danger, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth())
        }
        Spacer(Modifier.height(20.dp))
        PrimaryButton(T.enter, identifier.isNotBlank() && password.isNotEmpty(), busy) { submit() }
    }
}

/**
 * The one-time onboarding, as on the site (/onboarding): a password of one's own when the current one is temporary, then the
 * transparency notice. Each step calls the site's own route; when nothing is owed any more the app opens.
 */
@Composable
fun OnboardingScreen(session: Session) {
    val me by session.me.collectAsStateWithLifecycle()
    val owesPassword = me?.mustChangePassword == true
    val total = (if (owesPassword) 1 else 0) + (if (me?.transparencyPending == true) 1 else 0)
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AuthColumn {
        Text(T.welcome.format(me?.name.orEmpty()), style = MaterialTheme.typography.headlineMedium)
        Text(if (total > 1) T.introTwo else T.introOne, color = Zk.colors.fgMuted)
        Spacer(Modifier.height(24.dp))
        if (owesPassword) {
            var current by remember { mutableStateOf("") }
            var new by remember { mutableStateOf("") }
            var confirm by remember { mutableStateOf("") }
            var shown by remember { mutableStateOf(false) }
            Text(T.step.format(1, total), color = Zk.colors.accent, style = MaterialTheme.typography.labelLarge, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth())
            Text(T.passwordTitle, style = MaterialTheme.typography.titleLarge, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth())
            Text(T.passwordHint, color = Zk.colors.fgMuted, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            PasswordField(current, { current = it }, T.currentPassword, shown, { shown = !shown }, ImeAction.Next) {}
            Spacer(Modifier.height(8.dp))
            PasswordField(new, { new = it }, T.newPassword, shown, null, ImeAction.Next) {}
            Spacer(Modifier.height(8.dp))
            PasswordField(confirm, { confirm = it }, T.confirmPassword, shown, null, ImeAction.Done) {}
            Text(T.passwordRule, color = Zk.colors.fgMuted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(top = 6.dp))
            if (error != null) Text(error!!, color = Zk.colors.danger, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(top = 8.dp))
            Spacer(Modifier.height(16.dp))
            PrimaryButton(T.passwordSubmit, current.isNotEmpty() && new.isNotEmpty() && confirm.isNotEmpty(), busy) {
                val problem = PasswordRule.problem(current, new, confirm)
                if (problem != null) { error = problem; return@PrimaryButton }
                busy = true; error = null
                scope.launch {
                    val r = session.changePassword(current, new)
                    if (r is ApiResult.Err) error = r.failure.message
                    busy = false
                }
            }
        } else {
            Text(T.step.format(total, total), color = Zk.colors.accent, style = MaterialTheme.typography.labelLarge, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth())
            Text(T.noticeTitle, style = MaterialTheme.typography.titleLarge, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            for (line in listOf(T.noticeIntro, "• " + T.noticeKept, "• " + T.noticeWork, T.noticeRecord)) {
                Text(line, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(vertical = 3.dp))
            }
            if (error != null) Text(error!!, color = Zk.colors.danger, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(top = 8.dp))
            Spacer(Modifier.height(16.dp))
            PrimaryButton(T.noticeAccept, true, busy) {
                busy = true; error = null
                scope.launch {
                    val r = session.acceptNotice()
                    if (r is ApiResult.Err) error = r.failure.message
                    busy = false
                }
            }
        }
    }
}
