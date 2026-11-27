package io.zakiai.workspace.feature.work

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DecimalStyle
import java.util.Locale

/** «اليوم», «مهامي» and a task's words on screen — the site's own Arabic (src/lib/i18n) wherever it has one. */
object W {
    const val today = "اليوم"
    const val myWork = "مهامي"
    const val morning = "صباح الخير"
    const val evening = "مساء الخير"
    const val mission = "المهمّة الجاية"
    const val nothingToday = "ما عندك شي مستعجل اليوم."
    const val overdue = "متأخرة"
    const val dueToday = "اليوم"
    const val later = "بعدين"
    const val waiting = "بانتظار قرارك"
    const val mentions = "ذكروك"
    const val followUps = "مواعيد اليوم"
    const val pinned = "مثبّتة"
    const val reminders = "تذكيراتي"
    const val projects = "مشاريعك"
    const val spaces = "المساحات"
    const val myWeek = "أسبوعي"
    const val done = "خلصت"
    const val open = "مفتوحة"
    const val unreadChat = "رسائل ما انقرت"
    const val newTask = "مهمة جديدة"
    const val taskTitle = "شو المهمة؟"
    const val dueNone = "بدون موعد"
    const val dueTomorrow = "بكرا"
    const val add = "زيد"
    const val cancel = "إلغاء"
    const val save = "احفظ"
    const val nothingHere = "ما في مهام هون."
    const val sectionOff = "هالقسم مسكّر عليك. اطلب من المالك يفتحلك ياه"

    // «مهامي»'s six tabs (mywork.tab.*)
    val TABS = listOf(
        "today" to "اليوم",
        "overdue" to "متأخرة",
        "upcoming" to "قادمة",
        "mine" to "مسندة إليّ",
        "created" to "أنشأتها",
        "completed" to "مكتملة",
    )

    // the task
    const val status = "الحالة"
    const val priority = "الأولوية"
    const val due = "الموعد"
    const val assignees = "لمين"
    const val description = "الوصف"
    const val noDescription = "ما في وصف."
    const val steps = "الخطوات"
    const val addStep = "زيد خطوة"
    const val comments = "التعليقات"
    const val writeComment = "اكتب تعليق…"
    const val noComments = "ما في تعليقات."
    const val markDone = "خلّصتها"
    const val reopen = "رجّعها مفتوحة"
    const val remind = "ذكّرني"
    const val remindInHour = "بعد ساعة"
    const val remindTonight = "الساعة 6 المسا"
    const val remindTomorrow = "بكرا الصبح"
    const val reminderSet = "رح نذكّرك."
    const val request = "طلب"
    const val requestSent = "انبعت طلب، بستنى يرد."
    const val requestFor = "طلب تسليم المهمة"
    const val accept = "قبول"
    const val giveBack = "إرجاع بسبب"
    const val reason = "ليش؟ (بيوصله السبب)"
    const val waitingAnswer = "بانتظار الرد"
    const val creator = "أنشأها"
    const val readOnly = "بتقدر تقرأ هالمهمة بس."
    const val deleteComment = "احذف التعليق"
    const val saved = "انحفظ."

    /** `priority.<V>` of the site. */
    fun priorityLabel(p: String): String = when (p) {
        "URGENT" -> "عاجلة"
        "HIGH" -> "عالية"
        "NORMAL" -> "عادية"
        "LOW" -> "منخفضة"
        "NONE" -> "بلا أولوية"
        else -> "غير معروف"
    }

    val PRIORITIES = listOf("URGENT", "HIGH", "NORMAL", "LOW")

    /** `columnLabel`: the default English column names in Arabic; any other name as it was typed. */
    fun columnLabel(name: String): String = when (name.trim().lowercase()) {
        "backlog" -> "لاحقًا"
        "todo", "to do" -> "للعمل"
        "in_progress", "in progress", "doing" -> "قيد التنفيذ"
        "review" -> "قيد المراجعة"
        "done" -> "منتهي"
        "blocked" -> "متوقّف"
        else -> name
    }

    /**
     * A due day in words, from the phone's own day: «اليوم», «بكرا», «مبارح», «متأخرة» (earlier), or the date (Arabic month, Western
     * digits). Pure (unit-tested).
     */
    fun dueLabel(iso: String?, today: LocalDate = LocalDate.now(), zone: ZoneId = ZoneId.systemDefault()): String? {
        if (iso.isNullOrBlank()) return null
        val day = runCatching { Instant.parse(iso).atZone(zone).toLocalDate() }.getOrNull() ?: return null
        return when {
            day == today -> "اليوم"
            day == today.plusDays(1) -> "بكرا"
            day == today.minusDays(1) -> "مبارح"
            day.isBefore(today) -> "متأخرة · " + io.zakiai.workspace.ui.components.ArDate.dm(day)
            else -> io.zakiai.workspace.ui.components.ArDate.dm(day)
        }
    }

    /** Whether a due day is before today (the red colour). */
    fun isLate(iso: String?, today: LocalDate = LocalDate.now(), zone: ZoneId = ZoneId.systemDefault()): Boolean =
        runCatching { Instant.parse(iso).atZone(zone).toLocalDate().isBefore(today) }.getOrDefault(false)

}
