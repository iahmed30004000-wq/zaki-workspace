package io.zakiai.workspace.feature.desk

/** The words of «الأفكار», «التسجيل اليومي» and «الموافقات» on screen: the site's own Arabic (src/lib/i18n, keys beside each). */
object D {
    // ideas (ideas.*)
    const val ideas = "الأفكار"
    const val addIdea = "إضافة فكرة"
    const val ideaTitle = "عنوان الفكرة"
    const val ideaDesc = "الوصف (اختياري)"
    const val ideasEmpty = "لا أفكار بعد — شارك أول فكرة"
    const val shared = "مشتركة مع الشركة"
    const val converted = "تحوّلت لمهمة"
    const val vote = "تصويت"
    val IDEA_FILTERS = listOf("ALL" to "الكل", "NEW" to "جديدة", "UNDER_REVIEW" to "تحت المراجعة", "PLANNING" to "بالتخطيط", "LAUNCHED" to "انطلقت", "REJECTED" to "مرفوضة", "SHARED" to "المشتركة مع الشركة", "MINE" to "أفكاري")
    /** ideas.from_space: in «الشركة», a shared idea says which space it comes from */
    fun fromSpace(space: String) = "من $space"

    /**
     * The line under an idea, the site's rule (ideas-view.tsx): in «الشركة» a shared idea of ANOTHER space says where it comes from; outside
     * «الشركة» a shared idea says «مشتركة مع الشركة»; nothing else names the space. Pure (tested).
     */
    fun ideaLine(creator: String, job: String?, shared: Boolean, spaceName: String?, ideaSpace: String?, isHq: Boolean, here: String?, converted: Boolean): String =
        listOfNotNull(
            creator.ifBlank { null },
            job?.ifBlank { null },
            if (isHq && shared && !spaceName.isNullOrBlank() && ideaSpace != here) fromSpace(spaceName) else null,
            if (shared && !isHq) D.shared else null,
            if (converted) D.converted else null,
        ).joinToString(" · ")
    fun ideaStatus(s: String) = when (s) {
        "UNDER_REVIEW" -> "تحت المراجعة"
        "ACCEPTED" -> "معتمدة"
        "REJECTED" -> "مرفوضة"
        "PLANNING" -> "بالتخطيط"
        "LAUNCHED" -> "انطلقت"
        else -> "جديدة"
    }

    // check-ins (checkins.*)
    const val checkins = "التسجيل اليومي"
    const val checkinsOff = "التسجيل اليومي غير مفعّل في هذه المساحة."
    const val checkinsOffTitle = "التسجيل اليومي غير مفعّل في هذه المساحة."
    private val WEEKDAYS_LONG = listOf("الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت")
    /** «الأحد، الاثنين، …» (src/lib/checkins-client.ts weekdaysLabel; 0 = الأحد) */
    fun weekdaysLabel(days: List<Int>) = days.sorted().joinToString("، ") { WEEKDAYS_LONG[((it % 7) + 7) % 7] }

    /** The day of the week of a company day `YYYY-MM-DD`, 0 = الأحد as the site counts; null when unreadable. */
    fun weekdayOf(day: String): Int? = runCatching { java.time.LocalDate.parse(day).dayOfWeek.value % 7 }.getOrNull()

    /**
     * Before today's round opens (checkins-view.tsx): no schedule → off; a check-in day → «تُفتح جولة اليوم في الساعة X (الأيام)»; any other day →
     * «ليس اليوم يوم تسجيل». Pure (tested).
     */
    fun waitingLine(day: String, timeOfDay: String?, weekdays: List<Int>?): String {
        if (timeOfDay == null || weekdays == null) return checkinsOffTitle
        val days = weekdaysLabel(weekdays)
        val working = weekdayOf(day)?.let { it in weekdays } ?: true
        return if (working) "تُفتح جولة اليوم في الساعة $timeOfDay ($days)." else "ليس اليوم يوم تسجيل في هذه المساحة. الأيام: $days."
    }
    const val notParticipant = "لست ضمن المشاركين في جولة اليوم."
    const val roundClosed = "أُغلقت جولة هذا اليوم، ولم يعد التسجيل ممكنًا."
    const val excusedOn = "أنت في إجازة اليوم، ولا يُحتسب غيابك."
    const val answerEmpty = "اكتب جوابًا واحدًا على الأقل."
    const val submit = "إرسال التسجيل"
    const val update = "حفظ التعديل"
    const val excuse = "إجازة اليوم"
    const val unexcuse = "إلغاء الإجازة"
    const val checkinsSiteWarn = "⚠️ سجلّ الأيام السابقة وإعدادات التسجيل وربط المهام بالجواب لسا مش بالتطبيق."
    const val checkinsSiteFix = "🔧 افتحهم من صفحة الموقع."
    const val teamLocked = "تظهر أجوبة زملائك بعد أن ترسل جوابك أنت."
    fun rosterStatus(s: String) = when (s) {
        "answered" -> "سجّل"
        "excused" -> "في إجازة"
        "missed" -> "لم يسجّل"
        else -> "لم يسجّل بعد"
    }

    // approvals (approvals.*)
    const val approvals = "الموافقات"
    const val viewMine = "طلباتي"
    const val viewWaiting = "بانتظاري"
    const val viewAll = "كل الطلبات"
    /** `?v=` of a link (src/lib/approvals/shared.ts viewOf): waiting · all · anything else is «طلباتي», as on the site. Pure (tested). */
    fun viewOf(v: String?): String = when (v) { "waiting", "all" -> v; else -> "mine" }
    const val emptyMine = "ما طلبت أي موافقة بعد"
    const val emptyWaiting = "ما في شي بانتظارك"
    const val emptyAll = "ما في طلبات بعد"
    fun by(name: String) = "من $name"
    fun waitingOn(name: String) = "بانتظار $name"
    fun version(n: Int) = "النسخة $n"
    const val amountHidden = "المبلغ مخفي عنك"
    const val amountHiddenFix = "🔧 المبلغ بيظهر لمن عنده «رؤية الأسعار» أو «بطاقة الصندوق». اطلب من المالك يمنحك وحدة منهم."
    const val oversight = "أنت بتقرأ هذا الطلب كإشراف فقط، وما بتقدر تقرر فيه لأنك مش المعتمد المسمّى."
    const val allDenied = "قائمة كل الطلبات للمالك ولمديري المساحات فقط."
    const val reasonRequired = "اكتب سبب الرفض."
    const val changesRequired = "اكتب ما المطلوب تعديله."
    const val newRequest = "طلب موافقة"
    const val openSite = "افتح على الموقع"
    const val approvalsSiteWarn = "⚠️ طلب موافقة جديد والنماذج لسا مش بالتطبيق."
    const val resubmitWarn = "⚠️ تعديل الطلب وإعادة إرساله لسا مش بالتطبيق."
    const val siteFix = "🔧 افتحه من صفحة الموقع."

    /** «ارفض» needs a reason, «اطلب تعديل» what to change (the site's reasonProblem); null when the decision may go. Pure (tested). */
    fun reasonProblem(decision: String, reason: String): String? = when {
        reason.isNotBlank() -> null
        decision == "REJECT" -> reasonRequired
        decision == "CHANGES" -> changesRequired
        else -> null
    }
    const val moneyNote = "⚠️ الموافقة هون قرار مسجّل بس: التطبيق ما بيحوّل ولا بيصرف أي مبلغ."
    const val moneyFix = "🔧 الصرف بيتم خارج هالصفحة بعد القرار، ومن شخص مسؤول عن الدفع."
    const val decisionTitle = "قرارك"
    const val reason = "السبب (إلزامي مع الرفض وطلب التعديل)"
    const val approve = "وافق"
    const val changes = "اطلب تعديل"
    const val reject = "ارفض"
    const val cancel = "ألغِ الطلب"
    const val attachments = "المرفقات"
    const val chain = "سلسلة الموافقة"
    fun status(s: String) = when (s) {
        "APPROVED" -> "تمت الموافقة"
        "REJECTED" -> "مرفوض"
        "CANCELLED" -> "ملغى"
        "CHANGES_REQUESTED" -> "مطلوب تعديل"
        "SKIPPED" -> "لم يصل دوره"
        else -> "بانتظار القرار"
    }

    /** The site's currency names (`reward.cur.*`); an unknown code stays the code. */
    private val CURRENCY = mapOf("USD" to "دولار", "JOD" to "دينار", "SYP" to "ليرة سورية", "EUR" to "يورو", "TRY" to "ليرة تركية")

    /**
     * An amount as the site writes it (src/lib/rewards.ts `fmtReward`: «1,250.50 دينار»): the minor units over 100, thousands with commas,
     * the cents only when there are some. Never worked out on the phone: the server's minor units are drawn, nothing else. Pure (tested).
     */
    fun money(minor: Long, currency: String?): String {
        if (minor < 0) return ""
        val whole = (minor / 100).toString().reversed().chunked(3).joinToString(",").reversed()
        val cents = minor % 100
        val amount = if (cents == 0L) whole else whole + "." + cents.toString().padStart(2, '0')
        val name = currency?.let { CURRENCY[it] ?: it }.orEmpty()
        return "$amount $name".trim()
    }
}
