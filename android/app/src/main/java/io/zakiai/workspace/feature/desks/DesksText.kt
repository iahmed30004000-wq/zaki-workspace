package io.zakiai.workspace.feature.desks

import java.time.LocalDate

/**
 * «الحملات», «الأقسام», «الروتين اليومي» — the site's own words (ar.json camp.*, dept.*, prod.*, work.convert.*, ticket.*) and rules
 * (src/components/work-desks.tsx, department-campaigns.tsx, departments-view.tsx, production-view.tsx). Pure (DesksTest pins them).
 */
object Q {
    // ── the campaigns ──
    const val campaigns = "الحملات"
    const val myCampaigns = "حملاتي"
    const val noMyCampaigns = "ما عندك حملات لسا."
    const val department = "القسم"
    const val noDepartments = "ما في أقسام لسا. المدير بيعمل الأقسام من «الأقسام»."
    const val newCampaign = "حملة"
    const val newCampaignTitle = "حملة جديدة"
    const val campTitlePh = "عنوان الحملة (مثال: حملة رمضان)"
    const val descPh = "التفاصيل…"
    const val start = "البداية"
    const val end = "النهاية"
    const val priority = "الأولوية"
    const val submitCampaign = "إنشاء الحملة"
    const val campaignCreated = "أُنشئت الحملة"
    fun activeCount(n: Int) = "نشطة: $n"
    fun itemsLine(n: Int) = "العناصر: $n"
    const val statusLabel = "الحالة"
    const val delete = "حذف"
    fun deleteCampaignAsk(title: String) = "حذف الحملة «$title»؟"
    const val campaignDeleted = "حُذفت الحملة"
    const val itemsShow = "عرض البنود"
    const val itemsHide = "إخفاء البنود"
    const val itemsEmpty = "ما في بنود بهالحملة"
    const val itemWarn = "⚠️ هاد البند مكرّر مع المهام"
    const val itemFix = "🔧 اعمل منه مهمة وبتضل مربوطة فيه"
    const val linkedTask = "المهمة المرتبطة"
    const val hiddenTask = "في مهمة مرتبطة بس ما بتقدر تفتحها"
    const val makeTask = "اعمل منه مهمة"
    const val taskMade = "انعملت المهمة"
    const val taskAlready = "المهمة انعملت من قبل"
    const val cancel = "إلغاء"
    const val save = "حفظ"
    const val pickDay = "اختار اليوم"
    const val badRange = "تاريخ النهاية قبل تاريخ البداية"
    const val titleShort = "العنوان قصير جدًا"

    val STATUSES = listOf("DRAFT", "SCHEDULED", "RUNNING", "DONE", "CANCELLED")
    fun status(s: String) = when (s) {
        "SCHEDULED" -> "مجدولة"
        "RUNNING" -> "جارية"
        "DONE" -> "منتهية"
        "CANCELLED" -> "ملغاة"
        else -> "مسودة"
    }
    val PRIORITIES = listOf("URGENT", "HIGH", "NORMAL", "LOW")
    fun priority(p: String) = when (p) {
        "URGENT" -> "عاجلة"
        "HIGH" -> "عالية"
        "LOW" -> "منخفضة"
        else -> "عادية"
    }

    /** «نشطة»: running and scheduled (department-campaigns.tsx). */
    fun active(list: List<Campaign>) = list.count { it.status == "RUNNING" || it.status == "SCHEDULED" }

    /** Who manages a department's campaigns on the site: the owner and the admins, and the department's own members. */
    fun managesCampaigns(manager: Boolean, dept: Department?, meId: String?) = manager || (meId != null && dept?.members?.any { it.id == meId } == true)

    // ── the departments ──
    const val departments = "أقسام الشركة"
    const val deptSubtitle = "كل قسم يجمع أعضاءه ومشاريعه في مكان واحد"
    const val newDept = "قسم جديد"
    const val deptAdminOnly = "إدارة الأقسام للمالك والمشرفين فقط"
    const val noDepts = "لا أقسام بعد"
    fun statMembers(n: Int) = "الأعضاء: $n"
    fun statProjects(n: Int) = "المشاريع: $n"
    fun statOpen(n: Int) = "المهام المفتوحة: $n"
    fun statOverdue(n: Int) = "المتأخرة: $n"
    fun statTickets(n: Int) = "التذاكر المفتوحة: $n"
    const val addMembers = "إضافة أعضاء"
    const val removeMember = "إزالة"
    const val deleteDeptAsk = "حذف القسم؟ ستُفكّ المشاريع المرتبطة عنه دون حذفها"
    const val deptDeleted = "حُذف القسم"
    const val editDept = "تعديل القسم"
    const val createDept = "إنشاء قسم"
    const val deptName = "اسم القسم"
    const val deptEmoji = "الرمز"
    const val deptColor = "اللون"
    const val lead = "مدير القسم"
    const val noLead = "بدون مدير"
    const val deptSaved = "حُفظ القسم"
    const val membersTitle = "الأعضاء"
    const val noMembers = "لا أعضاء بعد"
    const val everyoneIn = "الكل موجود"
    const val tickets = "التذاكر"
    const val nameShort = "الاسم قصير جدًا"
    val EMOJIS = listOf("🎨", "💻", "🖥️", "💼", "📣", "⚙️", "👔", "🚀")
    val COLORS = listOf("sky", "emerald", "amber", "fuchsia", "indigo", "rose")
    fun color(c: String) = when (c) {
        "sky" -> "سماوي"
        "emerald" -> "زمرّدي"
        "amber" -> "كهرماني"
        "fuchsia" -> "أرجواني"
        "rose" -> "وردي"
        else -> "نيلي"
    }

    // ── the daily routine ──
    const val routine = "الروتين اليومي"
    const val routineSubtitle = "المهام المتكررة كل يوم، ومن المسؤول عن كل واحدة"
    const val manage = "إدارة المهام المتكررة"
    const val dupWarn = "⚠️ هاد مكرّر مع المهام المتكررة"
    const val dupFix = "🔧 حوّل الروتين لمهام متكررة: كل روتين بيصير مهمة متكررة وحدة بصندوق المهام، والروتين القديم بينحفظ بالأرشيف وسجلّه بيضل مقروء"
    const val prevDay = "اليوم السابق"
    const val nextDay = "اليوم التالي"
    fun doneRatio(done: Int, total: Int) = "$done/$total مكتملة"
    const val noSchedule = "لا مهام مجدولة في هذا اليوم"
    const val assignedTo = "مُعيَّنة إلى"
    const val unassigned = "غير مُعيَّنة"
    const val archivedHint = "هاد الروتين تحوّل لمهمة متكررة. سجلّه القديم بيضل مقروء هون"
    const val archived = "مؤرشف"
    const val convert = "حوّل الروتين لمهام متكررة"
    const val converted = "تحوّل الروتين لمهمة متكررة وانحفظ بالأرشيف"
    const val convertedAlready = "هاد الروتين محوّل من قبل، وما انعملت مهمة جديدة"
    const val done = "أُنجزت"
    const val manageTitle = "المهام المتكررة"
    const val newRoutine = "مهمة متكررة جديدة"
    const val editRoutine = "تعديل المهمة المتكررة"
    const val everyDay = "كل يوم"
    const val paused = "موقوفة"
    const val taskOpen = "افتح المهمة المتكررة"
    const val taskHidden = "تحوّل لمهمة ما بتقدر تفتحها"
    const val noRoutines = "لا مهام متكررة بعد — أضف أول واحدة"
    const val routineTitlePh = "عنوان المهمة (مثال: إنتاج فيديو يومي)"
    const val routineDescPh = "وصف قصير (اختياري)"
    const val activeLabel = "مفعّلة"
    const val routineSaved = "تم الحفظ"
    const val routineDeleted = "حُذفت المهمة المتكررة"
    val WD_SHORT = listOf("أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت")
    private val WD_LONG = listOf("الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت")
    private val MONTHS = listOf("كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول")

    /** «YYYY-MM-DD» as the site's `fmtShort`: «26 تشرين الثاني» ("" when unreadable). */
    fun shortDay(day: String): String = runCatching { LocalDate.parse(day.take(10)) }.getOrNull()?.let { "${it.dayOfMonth} ${MONTHS[it.monthValue - 1]}" }.orEmpty()

    /** The day bar's label (`fmtLongDate`): «الخميس 26 تشرين الثاني 2026». Sunday is day 0, as on the site. */
    fun longDay(day: String): String = runCatching { LocalDate.parse(day) }.getOrNull()?.let { "${WD_LONG[it.dayOfWeek.value % 7]} ${it.dayOfMonth} ${MONTHS[it.monthValue - 1]} ${it.year}" }.orEmpty()

    fun shiftDay(day: String, by: Long): String = runCatching { LocalDate.parse(day).plusDays(by).toString() }.getOrDefault(day)

    /** The stored weekdays («» = every day, «1,3» = Monday and Wednesday; Sunday is 0). */
    fun weekdaysOf(csv: String): Set<Int> = csv.split(',').mapNotNull { it.trim().toIntOrNull()?.takeIf { d -> d in 0..6 } }.toSet().ifEmpty { (0..6).toSet() }

    fun weekdaysLabel(csv: String): String {
        val days = weekdaysOf(csv)
        return if (days.size == 7) everyDay else days.sorted().joinToString(" · ") { WD_SHORT[it] }
    }

    fun doneCount(items: List<RoutineDay>) = items.count { it.doneAt != null }
}
