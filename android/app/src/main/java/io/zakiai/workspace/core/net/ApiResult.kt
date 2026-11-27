package io.zakiai.workspace.core.net

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** The site's error body: `{ error, message?, details? }` (src/server/api.ts) — `error` is the kind, `message` the precise key. */
@Serializable
data class ApiErrorDetail(val path: String? = null, val message: String? = null)

@Serializable
data class ApiErrorBody(val error: String? = null, val message: String? = null, val details: List<ApiErrorDetail>? = null)

/**
 * A failure the screens can show as it is: an Arabic sentence, the server's key, the status, and whether it was the network. [detail]
 * is the precise key of a refused field (`details[0].message` of a validation error, e.g. «not enough stock»): a screen that knows the
 * feature's own words says that instead of the general «تحقق من البيانات».
 */
data class ApiFailure(val message: String, val key: String? = null, val status: Int? = null, val offline: Boolean = false, val detail: String? = null) {
    /** The session is gone (expired, signed out everywhere, the person suspended): back to the sign-in screen. */
    val signedOut: Boolean get() = status == 401
    /** A temporary password or the transparency notice is owed first. */
    val onboardingOwed: Boolean get() = key == "auth.onboarding_required"
}

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Err(val failure: ApiFailure) : ApiResult<Nothing>
}

fun <T> ApiResult<T>.getOrNull(): T? = (this as? ApiResult.Ok)?.value

private val errorJson = Json { ignoreUnknownKeys = true; isLenient = true }

/** Runs one call and turns every way it can fail into an [ApiFailure] with an Arabic sentence. Never throws (but cancels). */
suspend fun <T> apiCall(block: suspend () -> T): ApiResult<T> = try {
    ApiResult.Ok(block())
} catch (e: CancellationException) {
    throw e
} catch (e: HttpException) {
    ApiResult.Err(failureOf(e.code(), runCatching { e.response()?.errorBody()?.string() }.getOrNull()))
} catch (e: UnknownHostException) {
    ApiResult.Err(ApiFailure(Sentences.OFFLINE, offline = true))
} catch (e: SocketTimeoutException) {
    ApiResult.Err(ApiFailure(Sentences.SLOW, offline = true))
} catch (e: IOException) {
    ApiResult.Err(ApiFailure(Sentences.NO_SERVER, offline = true))
} catch (e: SerializationException) {
    ApiResult.Err(ApiFailure(Sentences.UNREADABLE, key = "PARSE"))
}

/** The failure of an HTTP answer: the precise key wins over the kind, the status is the last resort. Pure (unit-tested). */
fun failureOf(status: Int, rawBody: String?): ApiFailure {
    val body = rawBody?.let { runCatching { errorJson.decodeFromString<ApiErrorBody>(it) }.getOrNull() }
    val key = body?.message?.takeIf { it.isNotBlank() && !it.contains(' ') } ?: body?.error
    val detail = body?.details?.firstOrNull()?.message?.takeIf { it.isNotBlank() && !it.contains(' ') }
    val sentence = (detail?.let { Sentences.byKey[it] }) ?: (body?.message?.let { Sentences.byKey[it] }) ?: (body?.error?.let { Sentences.byKey[it] }) ?: statusSentence(status)
    return ApiFailure(sentence, key, status, detail = detail)
}

fun statusSentence(status: Int): String = when (status) {
    400, 422 -> Sentences.byKey.getValue("validation.failed")
    401 -> Sentences.byKey.getValue("auth.required")
    403 -> Sentences.byKey.getValue("forbidden")
    404 -> "مش موجود، أو ما إلك صلاحية تشوفه."
    409 -> "تغيّر من شخص تاني. حدّث وجرّب كمان مرة."
    429 -> Sentences.byKey.getValue("auth.too_many_attempts")
    in 500..599 -> "صار خطأ بالخادم. جرّب بعد شوي."
    else -> "صار خطأ ($status)."
}

/** The Arabic of the keys the app meets (the site's own words, src/lib/i18n). */
object Sentences {
    const val OFFLINE = "ما في اتصال بالإنترنت."
    const val SLOW = "الخادم تأخر بالرد. جرّب كمان مرة."
    const val NO_SERVER = "ما في اتصال بالخادم."
    const val UNREADABLE = "رد الخادم مش مفهوم. حدّث التطبيق."
    /** the second line of a lost connection on a screen with nothing kept: why it is empty and what brings it back */
    const val NOTHING_KEPT = "ما في نسخة محفوظة من هالصفحة على هالجهاز. لما يرجع الاتصال اضغط «جرّب كمان مرة»."

    /** A lost connection (not a refusal): drawn calm, not as an error. Pure (CoreTest). */
    fun isConnection(message: String): Boolean = message == OFFLINE || message == SLOW || message == NO_SERVER

    val byKey: Map<String, String> = mapOf(
        "invalid_credentials" to "اسم المستخدم أو كلمة المرور غير صحيحة.",
        "auth.account_suspended" to "حسابك غير مفعّل حاليًا. تواصل مع مالك النظام.",
        "auth.required" to "انتهت جلستك. سجّل الدخول من جديد.",
        "auth.onboarding_required" to "كمّل خطوات البداية أولًا: كلمة مرور خاصة فيك والموافقة على التنبيه.",
        "auth.too_many_attempts" to "محاولات كثيرة. انتظر قليلًا ثم جرّب من جديد.",
        "forbidden" to "ليس لديك صلاحية",
        "validation.failed" to "تحقق من البيانات المُدخلة.",
        "password.wrong_current" to "كلمة المرور المؤقتة مش صحيحة.",
        "password.min8" to "كلمة المرور لازم تكون 8 خانات على الأقل.",
        "password.letter" to "كلمة المرور لازم تكون فيها حرف إنجليزي واحد على الأقل.",
        "password.digit" to "كلمة المرور لازم تكون فيها رقم واحد على الأقل.",
        "client_errors.too_many" to "وصل تطبيق الجوال تقارير أعطال كتير هالساعة. رح يبعت الباقي بعدين.",
        // «الموافقات» (ar.approvals.json)
        "approvals.e.all_denied" to "قائمة كل الطلبات للمالك ولمديري المساحات فقط.",
        "approvals.e.already_decided" to "تم اتخاذ قرار في هذه الخطوة من قبل.",
        "approvals.e.not_approver" to "لست أحد المعتمدين المسمَّين على هذا الطلب.",
        "approvals.e.not_cancellable" to "لا يمكن إلغاء هذا الطلب في حالته الحالية.",
        "approvals.e.not_pending" to "لم يعد الطلب بانتظار القرار.",
        "approvals.e.not_your_turn" to "لم يصل دورك بعد: ينتظر الطلب معتمدًا قبلك.",
        "approvals.e.reason_long" to "السبب أطول من الحد المسموح (1000 حرف).",
        "approvals.e.reason_required" to "اكتب سبب الرفض.",
        "approvals.e.changes_required" to "اكتب ما المطلوب تعديله.",
        "approvals.e.requester_only" to "هذا الإجراء لصاحب الطلب وحده.",
        "approvals.e.space_archived" to "هذه المساحة مؤرشفة.",
        // «التسجيل اليومي» (ar.checkins.json)
        "checkins.e.guest_denied" to "هذه الميزة غير متاحة للشركاء الخارجيين.",
        "checkins.e.no_round" to "لم تُفتح جولة هذا اليوم بعد.",
        "checkins.e.closed" to "أُغلقت جولة هذا اليوم، ولم يعد التسجيل ممكنًا.",
        "checkins.e.not_participant" to "لست من المشاركين في جولة هذا اليوم.",
        "checkins.e.answer_long" to "يجب ألا يتجاوز الجواب الواحد 1000 حرف.",
        "checkins.e.answer_empty" to "اكتب جوابًا واحدًا على الأقل.",
        "checkins.e.answer_count" to "عدد الأجوبة لا يطابق عدد الأسئلة.",
        "checkins.e.tasks_invalid" to "إحدى المهام المختارة غير متاحة لك أو لم تعد مفتوحة.",
        "checkins.e.already_answered" to "أرسلت جوابك اليوم، فلا يمكن اعتبارك في إجازة.",
        "checkins.e.failed" to "تعذّر تنفيذ الطلب. حاول مرة أخرى.",
        // «الناس», a profile, «التذاكر» (ar.json)
        "chat.dm_not_in_space" to "هالشخص مش معك بهالمساحة. الرسائل الخاصة بين ناس المساحة الوحدة.",
        "chat.dm_self" to "لا محادثة مع نفسك",
        "ticket.not_found" to "التذكرة غير موجودة",
        "ticket.admin_only" to "لا تملك صلاحية على هذه التذكرة",
        "ticket.assignee_not_member" to "المُعيَّن يجب أن يكون من أعضاء القسم",
        "ticket.bad_transition" to "انتقال حالة غير مسموح",
        "ticket.no_change" to "لا تغيير",
        // «مهام قديمة» (ar.work-v2.json)
        "stale.managers_only" to "هاي الصفحة لمالك الشركة ولمدراء المساحات بس",
        "stale.not_manager" to "هاي المهمة بمساحة ما بتديرها",
        "stale.not_open" to "المهمة ما عادت مفتوحة",
        "stale.pick_tasks" to "اختر مهمة وحدة عالأقل",
        "stale.too_many" to "مهام كتير بمرة وحدة: اختر أقل",
        "stale.day_required" to "اختر التاريخ",
        "stale.day_past" to "التاريخ لازم يكون اليوم أو بعده",
        "stale.pick_person" to "اختر الشخص",
        // «الطلبات»: an assignment answered elsewhere (ar.json taskreq.*)
        "taskreq.already_answered" to "سبق الرد على هذا الطلب",
        "taskreq.not_addressee" to "الرد على هذا الطلب للشخص الموجّه إليه أو للمالك فقط",
        "taskreq.reason_required" to "اكتب سبب الإرجاع",
    )
}
