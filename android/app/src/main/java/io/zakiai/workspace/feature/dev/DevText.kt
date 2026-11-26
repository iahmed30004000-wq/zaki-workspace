package io.zakiai.workspace.feature.dev

import java.util.Locale

/** The site's sentence of [key] (generated from ar.team-development.json), its «{param}» filled. */
fun w(key: String, vararg params: Pair<String, Any?>): String = DevWords.s(key, *params)

/** Numbers, dates and the shapes of «الأداء والتطوير» on the phone. Pure (DevTest pins them). */
object D {
    const val cancel = "إلغاء"
    const val save = "حفظ"
    const val csvWarn = "⚠️ تنزيل الجدول كملف من الموقع بس."
    const val csvFix = "🔧 افتح «الأداء والتطوير» على الموقع ونزّل الملف من هناك؛ نفس الأرقام اللي هون."
    const val moreWarn = "⚠️ مصفوفة المهارات وإعدادات التقييم لسا صفحات الموقع جوّا التطبيق."
    const val moreFix = "🔧 بتفتح من هون، وبتنقلب أصلية بالدفعة الجاية."

    val TABS = listOf("skills", "score", "reviews", "plan", "notes")

    /** the tabs of a person's file: nobody scores, reviews or plans the owner, his file is his skills */
    fun tabsOf(role: String): List<String> = if (role == "OWNER") listOf("skills") else TABS

    /** a whole number, Western digits always */
    fun n(v: Number): String = String.format(Locale.ROOT, "%d", v.toLong())

    /** «—» for a missing number, the rounded value otherwise */
    fun num(v: Double?): String = v?.let { n(Math.round(it)) } ?: "—"

    /** one decimal, as the site writes the average of the ratings */
    fun one(v: Double): String = String.format(Locale.ROOT, "%.1f", Math.round(v * 10) / 10.0).removeSuffix(".0")

    /** minutes as «h:mm» */
    fun minutes(m: Int?): String = m?.let { String.format(Locale.ROOT, "%d:%02d", it / 60, it % 60) } ?: "—"

    fun light(l: String?): String = l?.let { DevWords.all["teamdev.light.$it"] ?: it } ?: "—"
    fun band(b: String?): String = b?.let { DevWords.all["teamdev.band.$it"] ?: it } ?: "—"
    fun level(n: Int?): String = n?.let { "${n(it)} — " + (DevWords.all["teamdev.level.$it"] ?: "") } ?: w("teamdev.skill.none")

    private val MONTHS = listOf("كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول")

    /** «5 كانون الثاني 2026» from «YYYY-MM-DD» or an ISO instant */
    fun day(iso: String?): String = runCatching { java.time.LocalDate.parse(iso!!.take(10)) }.getOrNull()?.let { "${it.dayOfMonth} ${MONTHS[it.monthValue - 1]} ${it.year}" }.orEmpty()

    /** the name of a period among the choices the server sent, the key itself otherwise */
    fun period(key: String, choices: List<PeriodChoice>): String = choices.firstOrNull { it.key == key }?.label ?: key

    /** the precise refusal of the section when the site has a sentence for it, the general one otherwise */
    fun refusal(detail: String?, key: String?, general: String): String = detail?.let { DevWords.all[it] } ?: key?.let { DevWords.all[it] } ?: general

    /** a rating tapped again is taken back, as on the site */
    fun rate(ratings: Map<String, Int>, criterion: String, value: Int): Map<String, Int> =
        if (ratings[criterion] == value) ratings - criterion else ratings + (criterion to value)

    /** one line of the tree: the person and how deep they sit */
    data class TreeLine(val node: StructureNode, val depth: Int, val loose: Boolean)

    /**
     * «الهيكل» as a list: from each top person down (at most 8 deep, as the site), then the people nobody answers for, each with their own
     * people under them. Somebody reached twice is drawn once.
     */
    fun tree(s: Structure): List<TreeLine> {
        val byId = s.nodes.associateBy { it.userId }
        val kids = s.nodes.filter { it.managerId != null }.groupBy { it.managerId!! }
        val seen = HashSet<String>()
        val out = ArrayList<TreeLine>()
        fun walk(id: String, depth: Int, loose: Boolean) {
            val node = byId[id] ?: return
            if (!seen.add(id)) return
            out += TreeLine(node, depth, loose)
            if (depth < 8) kids[id].orEmpty().forEach { walk(it.userId, depth + 1, loose) }
        }
        s.roots.forEach { walk(it, 0, false) }
        s.unassigned.forEach { walk(it, 0, true) }
        return out
    }

    /** who may be picked as somebody's supervisor: not the person, not anybody below them (a loop the server would refuse) */
    fun pickable(s: Structure, userId: String): List<StructureNode> {
        val kids = s.nodes.filter { it.managerId != null }.groupBy { it.managerId!! }
        val below = HashSet<String>()
        val stack = ArrayDeque(listOf(userId))
        while (stack.isNotEmpty()) kids[stack.removeLast()].orEmpty().forEach { if (below.add(it.userId)) stack.addLast(it.userId) }
        return s.nodes.filter { it.userId != userId && it.userId !in below }
    }
}
