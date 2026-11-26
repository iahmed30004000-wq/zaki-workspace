package io.zakiai.workspace.feature.office

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/**
 * The words of «التقويم», «الناس», a profile, «تقرير الوقت» and «التذاكر» (the site's own Arabic, src/lib/i18n, keys beside each), and the site's
 * display rules ported as pure functions (tested in OfficeTest).
 */
object O {
    // ── «التقويم» (cal.*) ──
    const val calendar = "التقويم"
    const val prev = "الشهر السابق"
    const val next = "الشهر التالي"
    const val mineOnly = "مهامي فقط"
    const val calEmpty = "لا مهام مفتوحة بموعد في هذا الشهر. حدّد موعدًا لمهمة من صفحتها لتظهر هنا."
    const val noSpace = "لا توجد مساحة لعرض مهامها بعد. اطلب من مدير المساحة أو المالك أن يضيفك إلى مساحة."
    const val feedWarn = "⚠️ «اشتراك التقويم» (ربط مهامك بتقويم جوالك) لسا مش بالتطبيق."
    const val feedFix = "🔧 افتحه من صفحة «التقويم» بالموقع."
    const val dayEmpty ="ما في مهام مفتوحة بموعدها بهاليوم."
    const val moveDay = "غيّر اليوم"
    const val moved = "انتقلت المهمة"

    /** The site's short week-day names (src/lib/format.ts WEEKDAYS_SHORT), Sunday first as the grid draws them. */
    val WEEKDAYS_SHORT = listOf("أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت")
    private val MONTHS = listOf("كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول")

    /** «تشرين الثاني 2026» for "2026-11" (the page's monthTitle). */
    fun monthTitle(ym: String): String {
        val y = ym.take(4)
        val m = ym.drop(5).take(2).toIntOrNull() ?: return ym
        return "${MONTHS.getOrElse(m - 1) { "" }} $y"
    }

    /** "YYYY-MM" moved by [delta] months (src/server/services/calendar.ts shiftMonth). */
    fun shiftMonth(ym: String, delta: Int): String {
        val y = ym.take(4).toIntOrNull() ?: return ym
        val m = ym.drop(5).take(2).toIntOrNull() ?: return ym
        val d = LocalDate.of(y, m, 1).plusMonths(delta.toLong())
        return "%04d-%02d".format(Locale.ROOT, d.year, d.monthValue)
    }

    /**
     * The month as the site's grid draws it (calendar-grid.tsx): Sunday first, the blanks before the 1st, then the days. Each cell is the
     * day "YYYY-MM-DD" or null for a blank. Pure.
     */
    fun monthCells(ym: String): List<String?> {
        val y = ym.take(4).toIntOrNull() ?: return emptyList()
        val m = ym.drop(5).take(2).toIntOrNull() ?: return emptyList()
        val first = LocalDate.of(y, m, 1)
        val offset = first.dayOfWeek.value % 7 // Sunday = 0
        return List(offset) { null } + (1..first.lengthOfMonth()).map { "%04d-%02d-%02d".format(Locale.ROOT, y, m, it) }
    }

    /** The company's day of an instant (the grid's `dayOfInstant`): the due date falls on the day of the company's zone. */
    fun dayOf(iso: String, zone: String): String? = runCatching {
        Instant.parse(iso).atZone(runCatching { ZoneId.of(zone) }.getOrDefault(ZoneId.of("Asia/Damascus"))).toLocalDate().toString()
    }.getOrNull()

    // ── «الناس» and a profile (teams.*, members.*, profilecard.*, stat.*) ──
    const val people = "الناس"
    const val peopleSubtitle = "زملاؤك في الفريق"
    const val peopleEmpty = "لا يوجد أحد في القائمة."
    const val searchPh = "ابحث بالاسم أو المسمّى…"
    const val noMatch = "لا نتائج تطابق بحثك."
    const val noTitle = "بدون مسمّى وظيفي"
    const val accountsWarn = "⚠️ إنشاء الحسابات وتعديل الرتب والمفاتيح لسا مش بالتطبيق."
    const val accountsFix = "🔧 افتحها من صفحة «الأعضاء والصلاحيات» بالموقع."
    const val message = "راسله"
    const val about = "نبذة"
    fun since(date: String) = "عضو منذ $date"
    const val sharedSpaces = "المساحات المشتركة بينكم"
    const val statIdeas = "أفكار"
    const val statVotes = "تصويتات على أفكاره"
    const val statOpen = "مهام جارية"
    const val statDone = "مهام مكتملة"
    const val online = "متصل الآن"
    const val lastSeen = "آخر ظهور"
    const val unknown = "غير معروف"
    const val profileWarn = "⚠️ تعديل ملفك (الاسم والصورة والنبذة) لسا مش بالتطبيق."
    const val profileFix = "🔧 افتحه من «حسابي» بالموقع."
    fun role(r: String?) = when (r) {
        "OWNER" -> "مالك"
        "ADMIN" -> "مشرف"
        "LEAD" -> "قائد فريق"
        "GUEST" -> "زائر"
        else -> "عضو"
    }

    /** The directory's search (the site filters by name or title, any case). Pure. */
    fun matches(name: String, title: String?, q: String): Boolean {
        val n = q.trim()
        return n.isEmpty() || name.contains(n, ignoreCase = true) || (title?.contains(n, ignoreCase = true) == true)
    }

    // ── «تقرير الوقت» (tt.report.*) ──
    const val time = "تقرير الوقت"
    const val timeSubtitle = "الوقت اللي انسجّل على المهام، بتوقيت الشركة."
    const val week = "هذا الأسبوع"
    const val month = "هذا الشهر"
    const val total = "المجموع"
    const val byPerson = "حسب الشخص"
    const val byProject = "حسب المشروع"
    const val byDay = "حسب اليوم"
    const val noProject = "بدون مشروع"
    const val entries = "السجلّات"
    const val timeEmpty = "ما في وقت مسجّل بهالفترة."
    const val allPeople = "كل الأشخاص"
    const val allProjects = "كل المشاريع"
    const val timeWarn = "⚠️ المؤقّتات الشغّالة ما بتنحسب بالتقرير إلا بعد ما توقف."
    const val timeFix = "🔧 وقّف المؤقّت أو انتظر يتسكّر لحاله بعد 12 ساعة."
    const val reportSiteWarn = "⚠️ فترة تختارها بنفسك، و«كل مساحاتي»، وتنزيل ملف إكسل، وتعديل السجلات وحذفها، لسا مش بالتطبيق."
    const val reportSiteFix = "🔧 افتحها من صفحة «تقرير الوقت» بالموقع."
    const val autoStopped ="أُوقف تلقائيًا بعد 12 ساعة"
    fun source(s: String) = if (s == "MANUAL") "يدوي" else "مؤقّت"

    private fun whole(seconds: Long) = if (seconds > 0) seconds else 0

    /** `hh:mm`, rounded to the nearest minute (src/lib/time-tracking.ts formatHM). Pure. */
    fun hm(seconds: Long): String {
        val minutes = (whole(seconds) + 30) / 60
        return "%02d:%02d".format(Locale.ROOT, minutes / 60, minutes % 60)
    }

    /** Hours with two digits, rounded half up by integer arithmetic (formatDecimal). Pure. */
    fun decimal(seconds: Long): String {
        val hundredths = (whole(seconds) * 100 + 1800) / 3600
        return "${hundredths / 100}.%02d".format(Locale.ROOT, hundredths % 100)
    }

    /** `hh:mm · 1.50` (src/lib/time-client.ts bothText). */
    fun both(seconds: Long) = "${hm(seconds)} · ${decimal(seconds)}"

    /**
     * The site's presets (presetRange): «هذا الأسبوع» from Sunday to Saturday around the company's today, «هذا الشهر» its first to last day.
     * Returns (from, to) as "YYYY-MM-DD". Pure.
     */
    fun preset(week: Boolean, today: LocalDate): Pair<String, String> =
        if (week) {
            val from = today.minusDays((today.dayOfWeek.value % 7).toLong())
            from.toString() to from.plusDays(6).toString()
        } else {
            today.withDayOfMonth(1).toString() to today.withDayOfMonth(today.lengthOfMonth()).toString()
        }

    // ── «التذاكر» (desk.*, ticket.*, priority.*) ──
    const val tickets = "التذاكر"
    const val myTickets = "تذاكري: اللي طلبتها أو اللي معك"
    const val noMyTickets = "ما عندك تذاكر لسا."
    const val noDeptTickets = "ما في تذاكر بهالقسم لسا."
    const val noDepartments ="ما في أقسام لسا. المدير بيعمل الأقسام من «الأقسام»."
    const val department = "القسم"
    const val newTicket = "تذكرة جديدة"
    const val ticketTitlePh = "عنوان التذكرة (مشكلة أو طلب)"
    const val ticketDescPh = "التفاصيل…"
    const val submitTicket = "فتح التذكرة"
    const val ticketCreated = "فُتحت التذكرة"
    const val unassigned = "غير مُعيَّنة"
    const val statusLabel = "الحالة"
    const val priorityLabel = "الأولوية"
    const val to = "إلى"
    const val comments = "التعليقات"
    const val commentPh = "اكتب تعليق…"
    const val commentAdded = "أُضيف التعليق"
    const val updated = "حُدّثت التذكرة"
    const val customerNumber = "رقم الزبون"
    const val linkedTask = "المهمة المرتبطة"
    const val linkedHidden = "مرتبطة بمهمة ما بتقدر تفتحها."
    const val ticketsSiteWarn = "⚠️ تعديل نص التذكرة وتغيير المسؤول عنها وحذفها وتحويلها لمهمة، وتعديل التعليقات وحذفها وسجلّ الحركات، لسا مش بالتطبيق."
    const val ticketsSiteFix = "🔧 افتحها من صفحة الموقع."
    const val instantWarn = "⚠️ التذاكر الفورية لسا مش بالتطبيق."
    const val instantFix = "🔧 افتحها من صفحة «التذاكر» بالموقع."

    /** The moves the server allows (src/server/services/tickets.ts canTransition): only these are offered. Pure (tested). */
    fun canMove(from: String, to: String): Boolean = when {
        from == to -> true
        from == "OPEN" -> to == "IN_PROGRESS" || to == "RESOLVED" || to == "CLOSED"
        from == "IN_PROGRESS" -> to == "RESOLVED" || to == "CLOSED" || to == "OPEN"
        from == "RESOLVED" -> to == "CLOSED" || to == "IN_PROGRESS"
        else -> to == "OPEN" // CLOSED reopens
    }
    fun openCount(n: Int) = "مفتوحة: $n"
    fun status(s: String) = when (s) {
        "IN_PROGRESS" -> "قيد العمل"
        "RESOLVED" -> "تم الحل"
        "CLOSED" -> "مغلقة"
        else -> "مفتوحة"
    }
    fun priority(p: String) = when (p) {
        "URGENT" -> "عاجلة"
        "HIGH" -> "عالية"
        "LOW" -> "منخفضة"
        else -> "عادية"
    }
    val STATUSES = listOf("OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED")
    val PRIORITIES = listOf("URGENT", "HIGH", "NORMAL", "LOW")
    const val openSite = "افتح على الموقع"
}
