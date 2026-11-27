package io.zakiai.workspace.feature.panel

import java.util.Locale

/**
 * «العملاء», «التقارير», «لوحة المالك / لوحة التحكم» — the site's own words (ar.json crm.*, analytics.*, ar.control-panel.json cp.*,
 * ar.owner-board.json ownerboard.*) and its small rules. Pure (PanelTest pins them).
 */
object B {
    // ── «العملاء» ──
    const val crm = "العملاء"
    const val customers = "العملاء"
    const val opportunities = "الفرص"
    const val newCustomer = "عميل جديد"
    const val newOpportunity = "فرصة جديدة"
    const val editCustomer = "تعديل عميل"
    const val editOpportunity = "تعديل الفرصة"
    const val emptyCustomers = "لا يوجد عملاء بعد"
    const val emptyOpportunities = "لا توجد فرص بعد"
    const val forWhom = "لـ"
    const val name = "الاسم"
    const val company = "الشركة"
    const val email = "البريد الإلكتروني"
    const val phone = "الهاتف"
    const val notes = "ملاحظات"
    const val customer = "عميل"
    const val title = "العنوان"
    const val value = "القيمة"
    const val stage = "المرحلة"
    const val saved = "تم الحفظ"
    const val deleted = "حُذف بنجاح"
    const val save = "حفظ"
    const val cancel = "إلغاء"
    const val delete = "حذف"
    const val edit = "تعديل"
    const val none = "—"
    const val deleteCustomerAsk = "حذف العميل؟ بتنحذف فرصه معه."
    const val deleteOpportunityAsk = "حذف الفرصة؟"
    const val nameShort = "اسم العميل قصير جدًا"
    const val titleShort = "عنوان الفرصة قصير جدًا"
    val STAGES = listOf("LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST")
    fun stage(s: String) = when (s) {
        "QUALIFIED" -> "مؤهَّل"
        "PROPOSAL" -> "عرض سعر"
        "NEGOTIATION" -> "تفاوض"
        "WON" -> "تمت الصفقة"
        "LOST" -> "خسارة"
        else -> "عميل محتمل"
    }

    /** an amount as the site writes it (`fmtNumber`): digits 0-9 and a thousands comma, «—» when the server cut it */
    fun amount(v: Double?): String = v?.let { if (it % 1.0 == 0.0) String.format(Locale.ROOT, "%,d", it.toLong()) else String.format(Locale.ROOT, "%,.2f", it) } ?: none

    // ── «التقارير» ──
    const val reports = "التقارير"
    const val reportsSubtitle = "أرقام من بيانات شركتك الفعلية"
    const val ownerReportsSubtitle = "أرقام الشركة (أو مساحة وحدة) من قاعدة بياناتها لحظيًا، بتوقيت الشركة."
    const val totalTasks = "كل المهام"
    const val totalTasksHint = "غير المؤرشفة"
    const val openTasks = "مهام مفتوحة"
    const val completed = "مكتملة"
    fun completionRate(rate: Int) = "نسبة الإنجاز $rate%"
    const val overdue = "متأخرة"
    const val overdueNote = "استحقاق مضى دون إكمال"
    const val allGood = "لا شيء متأخر — جيد!"
    const val created30 = "أُنشئت آخر 30 يومًا"
    const val completed30 = "اكتملت آخر 30 يومًا"
    const val upcoming7 = "تستحق خلال 7 أيام"
    const val avgDays = "معدل المدة من الإنشاء للإنجاز"
    fun avgDaysValue(n: Double?) = n?.let { String.format(Locale.ROOT, "%.1f", it) + " يوم" } ?: none
    const val openByPriority = "المهام المفتوحة حسب الأولوية"
    const val noOpen = "لا مهام مفتوحة"
    const val workload = "حِمل الأعضاء (مهام مفتوحة)"
    const val noWorkload = "لا مهام مسندة مفتوحة"
    const val ideasFunnel = "الأفكار حسب الحالة"
    fun ideasTotal(n: Int) = "المجموع $n"
    const val noIdeas = "لا أفكار بعد"
    fun statWorkspaces(n: Int) = "مساحات العمل: $n"
    fun statProjects(n: Int) = "المشاريع: $n"
    const val formulaNote = "الأرقام محسوبة لحظيًا من قاعدة بيانات الشركة"
    const val series = "آخر 8 أسابيع: مهام جديدة ومهام منتهية"
    const val createdLabel = "جديدة"
    const val doneLabel = "منتهية"
    fun weekAgo(n: Int) = "قبل $n"
    const val weekNow = "هالأسبوع"
    const val bySpace = "المساحات"
    const val colSpace = "المساحة"
    const val colOpen = "مفتوحة"
    const val colOverdue = "متأخرة"
    const val colDone30 = "انتهت (30 يوم)"
    const val allSpaces = "كل المساحات"
    const val emptyScope = "ما في مهام بهالنطاق."
    val PRIORITIES = listOf("URGENT", "HIGH", "NORMAL", "LOW", "NONE")
    fun priority(p: String) = when (p) {
        "URGENT" -> "عاجلة"
        "HIGH" -> "عالية"
        "NORMAL" -> "عادية"
        "LOW" -> "منخفضة"
        else -> "بلا أولوية"
    }
    val IDEA_STATUSES = listOf("NEW", "UNDER_REVIEW", "PLANNING", "LAUNCHED", "REJECTED")
    fun ideaStatus(s: String) = when (s) {
        "UNDER_REVIEW" -> "تحت المراجعة"
        "PLANNING" -> "بالتخطيط"
        "LAUNCHED" -> "انطلقت"
        "REJECTED" -> "مرفوضة"
        else -> "جديدة"
    }
    /** a whole percent of a part, 0 when there is nothing to divide by */
    fun rate(part: Int, whole: Int) = if (whole <= 0) 0 else Math.round(part * 100.0 / whole).toInt()

    // ── the board and the panel ──
    fun boardTitle(mode: String?, panel: Boolean) = when {
        panel -> "لوحة التحكم"
        mode == "owner" -> "لوحة المالك"
        mode == "team" -> "لوحة الفريق"
        else -> "لوحتي"
    }
    const val adminTitle = "الإدارة"
    const val overview = "نظرة عامة"
    const val people = "الناس"
    const val kpiTitle = "أرقام اليوم"
    const val doneToday = "أُنجز اليوم"
    fun weekLine(n: Int) = "$n هالأسبوع"
    fun weekChange(pct: Double?) = when {
        pct == null -> "ما في أسبوع قبله نقارن فيه"
        pct > 0 -> "▲ ${Math.round(pct)}% عن الأسبوع اللي قبله"
        pct < 0 -> "▼ ${Math.round(-pct)}% عن الأسبوع اللي قبله"
        else -> "نفس الأسبوع اللي قبله"
    }
    const val overdueCompany = "متأخرة بالشركة"
    const val onTime = "الالتزام بالمواعيد"
    fun onTimePrev(p: Double) = "كان ${Math.round(p)}% الأسبوع اللي قبله"
    const val activeToday = "نشطين اليوم"
    fun activeValue(n: Int, total: Int) = "$n من $total"
    const val insightsTitle = "شو لازم تنتبه إله"
    const val insightsHint = "جمل محسوبة من أرقام الشركة. كل وحدة بتقلّك كيف انحسبت. الجملة عن شخص مش حكم عليه: ممكن يكون بإجازة."
    const val how = "كيف انحسبت؟"
    const val open = "افتح"
    const val todayTitle = "اليوم لحد الآن"
    const val todayFormula = "من بداية يوم الشركة لحد هلأ: مهام منجزة + خطوات + رسائل لكل شخص."
    const val todayDone = "سجّلوا شي اليوم"
    const val todayIdle = "لسا ما سجّلوا شي اليوم"
    const val noneDone = "ما حدا سجّل شي لحد الآن."
    const val noneIdle = "الكل سجّل شي اليوم."
    fun todayLine(tasks: Int, steps: Int, messages: Int) = "$tasks مهمة · $steps خطوة · $messages رسالة"
    const val cardsTitle = "ملخص الشركة للفترة"
    const val range = "الفترة"
    val RANGES = listOf("today", "7", "14", "30")
    fun rangeLabel(r: String) = when (r) {
        "today" -> "اليوم"
        "7" -> "7 أيام"
        "30" -> "30 يوم"
        else -> "14 يوم"
    }
    fun window(fromIso: String, toIso: String, days: Int): String {
        val from = io.zakiai.workspace.feature.desks.Q.shortDay(fromIso).ifEmpty { fromIso }
        val to = io.zakiai.workspace.feature.desks.Q.shortDay(toIso).ifEmpty { toIso }
        return "الفترة المعروضة: من $from إلى $to ($days يوم) بتوقيت الشركة."
    }
    const val peopleEmpty = "ما في أشخاص بالنطاق المختار."
    const val inactive = "موقوف/منتهي"
    const val online = "متصل الآن"
    val SORTS = listOf("completed", "openTasks", "overdue", "onTime", "steps", "messages", "lastActivity", "name")
    fun column(c: String) = when (c) {
        "completed" -> "منجزة"
        "openTasks" -> "مفتوحة (الحِمل الحالي)"
        "overdue" -> "متأخرة"
        "onTime" -> "الالتزام بالموعد"
        "steps" -> "خطوات"
        "messages" -> "رسائل"
        "lastActivity" -> "آخر نشاط"
        else -> "الشخص"
    }
    fun card(key: String) = when (key) {
        "completed" -> "مهام منجزة"
        "open" -> "مهام مفتوحة"
        "overdue" -> "متأخرة (مفتوحة)"
        "late" -> "أُنجزت متأخرة"
        "avgDays" -> "متوسط الأيام حتى الإنجاز"
        "messages" -> "رسائل مُرسلة"
        "active" -> "ناس نشيطون"
        else -> "ناس بلا شي مسجّل"
    }
    fun role(r: String) = when (r) {
        "OWNER" -> "مالك"
        "ADMIN" -> "مشرف"
        "LEAD" -> "قائد فريق"
        "GUEST" -> "زائر"
        else -> "عضو"
    }
    fun personTitle(name: String) = "صفحة $name"
    const val summary = "ملخص الفترة"
    const val trend = "منحنى الإنجاز"
    const val daysTitle = "يوم بيوم"
    const val noTasks = "لا مهام منجزة (صفر)"
    const val openTitle = "مهامه المفتوحة"
    const val openNone = "ما عنده مهام مفتوحة (صفر)."
    fun openMore(shown: Int, total: Int) = "يظهر أول $shown من $total مهمة مفتوحة."
    const val overdueTag = "متأخرة"
    fun due(d: String) = "الموعد: $d"
    const val noDue = "بلا موعد"
    const val spacesTitle = "المساحات اللي بيشتغل فيها"
    const val spacesNone = "ما هو عضو بأي مساحة ضمن نطاقك."
    const val definition = "«إنجاز» = مهمة اتعلّمت منجزة ووقع وقت إنجازها بهاليوم. كل صفر معناه «ما في شي مسجّل بالنظام»، مش حكم على الشخص."
    const val restWarn = "⚠️ باقي أقسام لوحة التحكم (الحسابات والصلاحيات، المساحات، الميزات، التكاملات، الهيكل، الأرشيف، ربط ذكي أي أي) لسا صفحة الموقع."
    const val restFix = "🔧 افتحها من هون على الموقع جوّا التطبيق؛ الأرقام والناس والتقارير هون بالتطبيق."
    const val csvWarn = "⚠️ تنزيل الجدول كملف من الموقع بس."
    const val csvFix = "🔧 افتح اللوحة على الموقع ونزّل الملف من هناك."

    /** an ISO instant as «HH:MM» in the company's zone (0-9 always), or the text as it came */
    fun clock(iso: String?, zone: String): String {
        if (iso.isNullOrBlank()) return none
        val z = runCatching { java.time.ZoneId.of(zone) }.getOrNull() ?: java.time.ZoneId.systemDefault()
        return runCatching { java.time.Instant.parse(iso).atZone(z) }.getOrNull()?.let { String.format(Locale.ROOT, "%02d:%02d", it.hour, it.minute) } ?: iso
    }
}
