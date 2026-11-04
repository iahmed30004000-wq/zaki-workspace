package io.zakiai.workspace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/** The words the screens use (Arabic, the house's Jordanian register). */
object T {
    const val appName = "زاكي"
    const val signIn = "تسجيل الدخول"
    const val identifier = "اسم المستخدم أو البريد الإلكتروني"
    const val password = "كلمة المرور"
    const val enter = "دخول"
    const val badCredentials = "اسم المستخدم أو كلمة المرور غير صحيحة."
    const val suspended = "حسابك موقوف. راجع مدير النظام."
    const val tooMany = "محاولات كثيرة. جرّب بعد شوي."
    const val offline = "ما في اتصال بالإنترنت."
    const val generic = "صار خطأ. جرّب مرة ثانية."
    const val chat = "الدردشة"
    const val today = "اليوم"
    const val tasks = "المهام"
    const val notifications = "الإشعارات"
    const val more = "المزيد"
    const val noChats = "ما في محادثات لسا."
    const val privateChats = "رسائل خاصة"
    const val noNotifications = "ما في إشعارات."
    const val markAllRead = "تعليم الكل كمقروء"
    const val writeMessage = "اكتب رسالة"
    const val send = "إرسال"
    const val call = "اتصال"
    const val cannotPost = "ما بتقدر تكتب هون."
    const val systemMessage = "حدث بالمحادثة"
    const val deletedMessage = "رسالة محذوفة"
    const val attachment = "مرفق"
    const val back = "رجوع"
    const val logout = "تسجيل الخروج"
    const val permissions = "عشان الرنّة والإشعارات"
    const val allowNotifications = "السماح بالإشعارات"
    const val allowFullScreen = "السماح بشاشة المكالمة الكاملة"
    const val allowBattery = "تشغيل التطبيق بدون قيود البطارية"
    const val pages = "صفحات الموقع"
    const val account = "الحساب"
}

@Composable
fun LoginScreen(onSignedIn: (next: String) -> Unit) {
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (busy || identifier.isBlank() || password.isEmpty()) return
        busy = true
        error = null
        scope.launch {
            try {
                val res = Api.login(identifier, password)
                onSignedIn(res.next)
            } catch (e: ApiException) {
                error = when {
                    e.status == 429 -> T.tooMany
                    e.status == 403 -> T.suspended
                    e.status == 401 -> T.badCredentials
                    else -> T.generic
                }
            } catch (e: Exception) {
                error = T.offline
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(T.appName, fontSize = 44.sp, fontWeight = FontWeight.Bold, color = Zk.Accent)
        Spacer(Modifier.height(4.dp))
        Text("Zaki Workspace", fontSize = 16.sp, color = Zk.Muted)
        Spacer(Modifier.height(32.dp))
        Text(T.signIn, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Start, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth())
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = identifier,
            onValueChange = { identifier = it },
            label = { Text(T.identifier) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text(T.password) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(),
        )
        if (error != null) {
            Spacer(Modifier.height(12.dp))
            Text(error!!, color = Zk.Danger, modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth())
        }
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = { submit() },
            enabled = !busy && identifier.isNotBlank() && password.isNotEmpty(),
            colors = ButtonDefaults.buttonColors(containerColor = Zk.Accent, contentColor = Zk.OnAccent),
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth().height(52.dp),
        ) {
            if (busy) CircularProgressIndicator(strokeWidth = 2.dp, color = Zk.OnAccent, modifier = Modifier.height(22.dp)) else Text(T.enter, fontSize = 18.sp)
        }
    }
}
