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
    val IDEA_FILTERS = listOf("ALL" to "الكل", "NEW" to "جديدة", "UNDER_REVIEW" to "تحت المراجعة", "PLANNING" to "بالتخطيط", "LAUNCHED" to "انطلقت", "REJECTED" to "مرفوضة", "MINE" to "أفكاري")
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
    fun waiting(time: String) = "تُفتح جولة اليوم في الساعة $time."
    const val submit = "إرسال التسجيل"
    const val update = "حفظ التعديل"
    const val excuse = "إجازة اليوم"
    const val unexcuse = "إلغاء الإجازة"
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
    const val emptyMine = "ما طلبت أي موافقة بعد"
    const val emptyWaiting = "ما في شي بانتظارك"
    const val emptyAll = "ما في طلبات بعد"
    fun by(name: String) = "من $name"
    fun waitingOn(name: String) = "بانتظار $name"
    fun version(n: Int) = "النسخة $n"
    const val amountHidden = "المبلغ مخفي عنك"
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
