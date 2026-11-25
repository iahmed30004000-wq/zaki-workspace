package io.zakiai.workspace.feature.projects

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import io.zakiai.workspace.ui.theme.Zk

/** The words of «المشاريع» on screen: the site's own Arabic (src/lib/i18n/ar*.json, the keys named beside each). */
object P {
    const val projects = "المشاريع" // nav.projects
    const val newProject = "مشروع جديد" // proj.new
    const val projectName = "اسم المشروع" // proj.name
    const val create = "إنشاء المشروع" // proj.create
    const val emptyTitle = "لا مشاريع بعد" // proj.emptyTitle
    const val emptyHint = "أنشئ مشروعًا لتبدأ بتنظيم العمل." // proj.emptyHint
    const val noSpaces = "لا توجد مساحات متاحة لك" // proj.noWorkspaces
    const val noSpacesHint = "لم تُضَف إلى أي مساحة بعد، اطلب من مدير المساحة أو من المالك إضافتك." // proj.noWorkspacesHint
    const val inboxName = "صندوق المهام" // work.inbox.name
    const val inboxHint = "المهام السريعة من أي مكان بتنزل هون بخانة «للتنفيذ»." // work.inbox.hint
    const val pinned = "مثبّت" // work.inbox.pinned
    const val instantProject = "مهام فورية" // instant.project
    fun cardLine(tasks: Int, boards: Int) = "المهام: $tasks · لوحات المشروع: $boards" // proj.cardLine
    fun tasksLine(tasks: Int) = "المهام: $tasks" // work.inbox.line
    fun dueLine(date: String) = "الموعد: $date" // proj.dueLine
    fun progressLine(open: Int, done: Int, pct: Int) = "المفتوحة: $open · المنجزة: $done · $pct%" // proj.progressLine

    // the project's tabs (projpage.tab.*)
    const val tabBoard = "اللوحة"
    const val tabTimeline = "الجدول الزمني"
    const val tabMilestones = "المعالم" // milestones.title
    const val tabSettings = "الإعدادات"
    const val boards = "اللوحات" // projpage.settings.boards
    const val newBoard = "لوحة جديدة" // board.new
    const val boardName = "اسم اللوحة" // board.name
    const val createBoard = "إنشاء اللوحة" // board.create
    const val noBoards = "لا توجد لوحات في هذا المشروع." // board.empty

    // the board (board.*)
    const val addColumn = "إضافة عمود"
    const val columnName = "عمود جديد"
    const val dropHere = "أفلت المهام هنا"
    const val newTask = "مهمة جديدة" // task.new
    const val taskTitle = "عنوان المهمة" // task.title
    const val unassigned = "غير مسندة" // list.unassigned
    const val late = "متأخرة" // dash.overdue
    const val moveTo = "انقل إلى"
    const val add = "إضافة" // common.add
    const val cancel = "إلغاء" // common.cancel
    const val open = "افتح"

    // the timeline (timeline.*)
    const val today = "اليوم"
    const val scaleDay = "يومي"
    const val scaleWeek = "أسبوعي"
    const val scaleMonth = "شهري"
    const val timelineEmpty = "لا مهام أو معالم بتواريخ بعد"
    const val undated = "مهام بلا تواريخ (لا تظهر على الجدول)"
    const val legendActive = "جارية"
    const val legendPriority = "أولوية عالية"
    const val legendDone = "مكتملة"
    const val legendLate = "متأخرة"
    const val legendMilestone = "معلم"

    // milestones (milestones.*)
    const val milestonesEmpty = "ما في معالم بعد. ضيف معلم أول تاريخ بتتقاس عليه."
    const val newMilestone = "معلم جديد"
    const val milestonePlaceholder = "مثال: تسليم النسخة الأولى"
    const val addMilestone = "أضف المعلم"
    const val msOpen = "مفتوح"
    const val msDone = "مكتمل"
    const val msOverdue = "متأخر"
    const val msNoDate = "بلا تاريخ"
    fun msOpenTasks(n: Int) = "مهام مفتوحة: $n"
    const val markDone = "خلّيه مكتمل"
    const val markOpen = "رجّعه مفتوح"

    // goals (goal.* / okr.*)
    const val goals = "الأهداف"
    const val goalsSubtitle = "ما نريد تحقيقه أسبوعيًا وشهريًا"
    const val weekly = "أسبوعي"
    const val monthly = "شهري"
    const val quarterly = "ربعي"
    const val noGoals = "لا أهداف في هذه الفترة بعد"
    const val achieved = "محقق"
    const val progress = "التقدم"
    fun ownerLine(name: String) = "المسؤول: $name"
    fun fromResults(n: Int) = "محسوب من $n نتائج"

    /** «الشغل»: the site's work tabs on the phone */
    const val work = "الشغل"
    const val myWork = "مهامي"
    const val list = "القائمة"

    /** The site's month names (src/lib/format.ts `MONTHS`). */
    val MONTHS = listOf("كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول")

    /** «25 تشرين الثاني 2026», as the site's `fmtDMY` (in the phone's zone); null for nothing or an unreadable date. */
    fun dmy(iso: String?, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String? {
        val d = runCatching { java.time.Instant.parse(iso).atZone(zone).toLocalDate() }.getOrNull() ?: return null
        return "${d.dayOfMonth} ${MONTHS[d.monthValue - 1]} ${d.year}"
    }

    /** ProjectStatus, as the site's enums (ar.enums.json). */
    fun status(s: String) = when (s) {
        "PLANNING" -> "قيد التخطيط"
        "ACTIVE" -> "نشط"
        "ON_HOLD" -> "متوقّف مؤقتًا"
        "AT_RISK" -> "في خطر"
        "COMPLETED" -> "مكتمل"
        "ARCHIVED" -> "مؤرشف"
        else -> "قيد التخطيط"
    }
}

/** A status's tone, as the site's `PROJECT_TONE`: ACTIVE accent, COMPLETED ok, ON_HOLD warn, AT_RISK danger, the rest neutral. */
@Composable
fun projectTone(status: String): Color = when (status) {
    "ACTIVE" -> Zk.colors.accent
    "COMPLETED" -> Zk.colors.ok
    "ON_HOLD" -> Zk.colors.warn
    "AT_RISK" -> Zk.colors.danger
    else -> Zk.colors.fgMuted
}

/** A label's or column's colour from the site's hex («#3b82f6»); anything unreadable is the muted grey. */
fun hexColor(hex: String?, fallback: Color = Color(0xFF6B7280)): Color = runCatching {
    val h = hex!!.removePrefix("#")
    val v = h.toLong(16)
    when (h.length) {
        6 -> Color(0xFF000000 or v)
        8 -> Color(v)
        else -> fallback
    }
}.getOrDefault(fallback)
