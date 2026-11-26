package io.zakiai.workspace.feature.cards

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import java.text.Collator
import java.util.Locale

/**
 * «اللوحات» — the site's own words (ar.cards.json, ar.card-page.json) and its rules (src/lib/cards/view.ts, shared.ts, texts.ts),
 * ported as they are. Pure: no Android, no network (CardsTest pins them).
 */
object K {
    const val title = "اللوحات"
    const val archiveTitle = "المحذوفات"
    const val archiveEmpty = "لا توجد لوحات محذوفة."
    const val new = "لوحة جديدة"
    const val edit = "تعديل"
    const val readOnly = "هذه اللوحات للعرض فقط: يمكنك تصفحها والبحث فيها دون تعديل."
    const val noSpace = "لا توجد مساحة مفتوحة لعرض لوحاتها."
    const val empty = "لا توجد لوحات بعد."
    const val emptyHint = "ابدأ بملاحظة أو برومبت أو قائمة أو رابط أو ملف أو لوحة بيانات."
    const val noResults = "لا توجد لوحات تطابق البحث أو التصفية."
    const val search = "ابحث في عنوان اللوحة ونصها"
    const val sortManual = "ترتيبي اليدوي"
    const val sortNewest = "الأحدث"
    const val sortOldest = "الأقدم"
    const val sortTitle = "العنوان"
    const val all = "الكل"
    const val noCategory = "بلا تصنيف"
    const val pinnedOnly = "المثبّتة فقط"
    const val pinned = "مثبّتة"
    const val pin = "تثبيت"
    const val unpin = "إلغاء التثبيت"
    const val duplicate = "نسخة"
    const val send = "أرسل"
    const val toTask = "حوّلها لمهمة"
    const val delete = "حذف"
    const val restore = "استرجاع"
    const val copy = "نسخ"
    const val copied = "تم النسخ"
    const val listEmpty = "القائمة فارغة."
    const val tableNotice = "⚠️ للملاحظات والمواصفات فقط، لا للمخزون ولا للمبالغ. 🔧 الأرقام المالية تأتي لاحقًا من النظام نفسه ولا تُكتب يدويًا."
    const val ledgerNotice = "أرقام المخزون والكلف ما بتنكتب هون بالإيد: بتنعرض من الدفتر الرسمي لما يجهز."
    const val linkInvalid = "عنوان هذا الرابط غير صالح، ولا يُفتح إلا عنوان يبدأ بـ https://"
    const val fileGone = "الملف غير متاح الآن."
    const val fKind = "النوع"
    const val fTitle = "العنوان"
    const val fNote = "النص"
    const val fNoteOptional = "ملاحظة (اختيارية)"
    const val fPrompt = "نص البرومبت"
    const val fUrl = "عنوان الرابط"
    const val fUrlHint = "يجب أن يبدأ بـ https:// ولا تُقبل عناوين أخرى."
    const val fItems = "العناصر"
    const val fItemAdd = "عنصر جديد"
    const val fItemRemove = "احذف العنصر"
    const val fTable = "الجدول"
    const val fColumnAdd = "عمود جديد"
    const val fColumnRemove = "احذف العمود"
    const val fRowAdd = "صف جديد"
    const val fRowRemove = "احذف الصف"
    const val fColor = "اللون"
    const val fCategory = "التصنيف"
    const val fTags = "الوسوم"
    const val fTagsHint = "افصل بين الوسوم بفاصلة"
    const val fPinned = "ثبّت اللوحة في الأعلى"
    const val save = "حفظ"
    const val cancel = "إلغاء"
    const val created = "أُضيفت اللوحة"
    const val saved = "حُفظت اللوحة"
    const val deleted = "حُذفت اللوحة. يبقى المالك قادرًا على استرجاعها."
    const val restored = "استُرجعت اللوحة"
    const val duplicated = "نُسخت اللوحة"
    const val sent = "أُرسلت اللوحة إلى المحادثة"
    const val sendTitle = "أرسل إلى محادثة"
    const val sendHint = "يصل العنوان والنص فقط إلى موضوع من هذه المساحة، ولا يُرسل أي ملف."
    const val sendNone = "لا يوجد موضوع تستطيع الكتابة فيه في هذه المساحة."
    const val taskMade = "أُنشئت المهمة"
    const val taskProject = "المشروع"
    const val taskBoard = "لوحة المشروع"
    const val taskChoose = "اختر"
    const val taskNoProject = "لا يوجد مشروع في هذه المساحة. أنشئ مشروعًا أولًا."
    const val confirmDelete = "حذف هذه اللوحة؟ يبقى المالك قادرًا على استرجاعها."
    const val deletedBanner = "هذه اللوحة محذوفة، ويطّلع عليها المالك وحده."
    const val oversight = "تقرأ هذه اللوحة بصمت: لا يُسجَّل اطلاعك، ولا يمكنك التقييم أو كتابة الملاحظات قبل أن تنضم إلى المساحة."
    const val pageReadOnly = "هذه الصفحة للعرض فقط."
    const val loadFailed = "تعذّر تحميل هذا القسم."
    const val someone = "أحد الأعضاء"
    fun createdBy(name: String) = "أنشأها $name"
    fun version(n: Int) = "الإصدار $n"
    const val status = "حالة الاعتماد"
    const val statusHint = "يغيّر الحالة مشرف المساحة أو المالك، ويُسجَّل كل تغيير في السجل."
    fun statusTo(s: String) = "انقل إلى: ${status(s)}"
    const val statusChanged = "تغيّرت حالة اللوحة"
    const val stars = "التقييم"
    const val starsNone = "لم يقيّم أحد بعد"
    const val starsMine = "تقييمك"
    const val starsSaved = "حُفظ تقييمك"
    const val raters = "من قيّم وكم نجمة أعطى"
    const val ratersHint = "تظهر هذه القائمة لمالك الشركة ولمنشئ اللوحة فقط."
    const val tabNotes = "الملاحظات"
    const val tabGallery = "المعرض"
    const val tabVersions = "الإصدارات"
    const val tabLog = "السجل"
    const val notesPublic = "ملاحظات الفريق"
    const val notesPublicHint = "يقرؤها أعضاء المساحة."
    const val notesEmpty = "لا توجد ملاحظات بعد."
    const val notesPrivate = "ملاحظاتي الخاصة"
    const val notesPrivateHint = "لا يراها أحد غيرك، ولا حتى مالك الشركة."
    const val notesPrivateEmpty = "لا توجد ملاحظات خاصة."
    const val notePlaceholder = "اكتب ملاحظة…"
    const val noteAdd = "أضف ملاحظة"
    const val notePrivateAdd = "أضف ملاحظة خاصة"
    const val noteEdit = "تعديل الملاحظة"
    const val noteDelete = "حذف الملاحظة"
    const val noteEdited = "عُدّلت"
    const val noteAdded = "أُضيفت الملاحظة"
    const val noteDeleted = "حُذفت الملاحظة"
    const val internalOnly = "هذا القسم لفريق المساحة فقط"
    const val versionsEmpty = "لا توجد إصدارات سابقة: لم تُعدَّل اللوحة بعد."
    fun versionCurrent(n: Int) = "الإصدار الحالي: $n"
    fun versionBy(name: String) = "حُفظ قبل تعديل $name"
    const val versionRestore = "استرجع هذا الإصدار"
    fun versionRestored(n: Int) = "استُرجع الإصدار $n كإصدار جديد"
    const val restoreHint = "الاسترجاع يضيف إصدارًا جديدًا ولا يمحو شيئًا من السجل."
    const val logEmpty = "لا توجد أحداث بعد."
    const val galleryEmpty = "لا توجد صور في المعرض بعد."
    const val coverOn = "الغلاف الحالي"
    const val links = "مرتبطة بهذه اللوحة"
    const val linksTasks = "مهام أُنشئت منها"
    const val linksTopics = "أُرسلت إلى"
    const val linksNone = "لم تُحوَّل إلى مهمة ولم تُرسل إلى محادثة بعد."
    const val linkMessage = "افتح الرسالة"
    const val conflictTitle = "اللوحة تغيّرت"
    const val conflictHint = "عدّل زميلك هذه اللوحة بعد أن بدأت تعديلك. لا يُكتب شيء فوق عمل غيرك دون اختيارك."
    const val conflictKeep = "احفظ تعديلي فوقها"
    const val conflictTakeTheirs = "خذ النسخة الحالية وأهمل تعديلي"
    const val open = "افتح"

    // ── the parts kept on the site (⚠️ with its 🔧), the owner's rule: marked, never removed ──
    const val fileWarn = "⚠️ لوحة الملف أو الصورة تنعمل من الموقع: اختيار ملف من مكتبة المساحة ورفعه مش بالجوال بعد."
    const val fileFix = "🔧 افتحها على الموقع من هون، وبعدها بتنفتح وبتنقرأ بالتطبيق."
    const val galleryWarn = "⚠️ إضافة صور للمعرض وترتيبها والغلاف ووصف كل صورة من الموقع بس."
    const val galleryFix = "🔧 افتح صفحة اللوحة على الموقع لتعدّل المعرض؛ الصور بتنعرض هون."
    const val orderWarn = "⚠️ ترتيب اللوحات بالسحب من الموقع بس."
    const val orderFix = "🔧 رتّبها على الموقع، وبيوصل نفس الترتيب للتطبيق."
    const val approvalsWarn = "⚠️ طلب موافقة مربوط باللوحة بينطلب من الموقع."
    const val approvalsFix = "🔧 افتح اللوحة على الموقع واطلب الموافقة من قسم «طلب موافقة»."
    const val diffWarn = "⚠️ مقارنة كل حقل مع النسخة الحالية بتنعرض على الموقع."
    const val diffFix = "🔧 افتح اللوحة على الموقع لتشوف الفرق قبل ما تسترجع."

    val KINDS = listOf("NOTE", "PROMPT", "LIST", "LINK", "FILE", "TABLE")
    /** the kinds the phone makes itself: a FILE card needs a library file (the site's, ⚠️) */
    val NEW_KINDS = listOf("NOTE", "PROMPT", "LIST", "LINK", "TABLE")
    val COLORS = listOf("none", "accent", "ok", "warn", "danger", "info", "cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6")
    val SORTS = listOf("manual", "newest", "oldest", "title")
    const val MAX_TITLE = 140
    const val MAX_NOTE = 4000

    fun kind(k: String) = when (k) {
        "NOTE" -> "ملاحظة"
        "PROMPT" -> "برومبت"
        "LIST" -> "قائمة"
        "LINK" -> "رابط"
        "FILE" -> "ملف أو صورة"
        "TABLE" -> "لوحة بيانات"
        "PRODUCT" -> "كرت منتج"
        "REPLY" -> "رد جاهز"
        else -> "ملاحظة"
    }

    fun color(c: String) = when (c) {
        "accent" -> "لون الواجهة"
        "ok" -> "نجاح"
        "warn" -> "تحذير"
        "danger" -> "خطر"
        "info" -> "معلومة"
        "cat-1" -> "اللون الأول"
        "cat-2" -> "اللون الثاني"
        "cat-3" -> "اللون الثالث"
        "cat-4" -> "اللون الرابع"
        "cat-5" -> "اللون الخامس"
        "cat-6" -> "اللون السادس"
        else -> "بلا لون"
    }

    fun status(s: String) = when (s) {
        "REVIEW" -> "قيد المراجعة"
        "APPROVED" -> "معتمدة"
        "ARCHIVED" -> "مؤرشفة"
        else -> "مسودة"
    }

    fun sort(s: String) = when (s) {
        "newest" -> sortNewest
        "oldest" -> sortOldest
        "title" -> sortTitle
        else -> sortManual
    }

    fun field(f: String) = when (f) {
        "title" -> "العنوان"
        "body" -> "النص"
        "data" -> "المحتوى"
        "color" -> "اللون"
        "category" -> "التصنيف"
        "tags" -> "الوسوم"
        "fileId" -> "الملف"
        else -> f
    }

    fun listProgress(done: Int, total: Int) = "$done من $total"
    fun tableRows(n: Int) = "$n صفوف"
    fun starsAvg(avg: Double) = String.format(Locale.ROOT, "%.1f", avg) + " من 5"
    fun starsCount(n: Int) = "$n تقييم"
    fun starsN(n: Int) = "$n من 5 نجوم"

    // ── a card's data (shared.ts): the list, the link (https only), the table ──

    fun listItems(data: JsonElement?): List<Pair<String, Boolean>> {
        val items = ((data as? JsonObject)?.get("items") as? JsonArray) ?: return emptyList()
        return items.mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val text = (o["text"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            if (text.isEmpty()) null else text to ((o["done"] as? JsonPrimitive)?.booleanOrNull == true)
        }
    }

    fun listData(items: List<Pair<String, Boolean>>): JsonElement =
        JsonObject(mapOf("items" to JsonArray(items.filter { it.first.isNotBlank() }.map { (t, d) -> JsonObject(mapOf("text" to JsonPrimitive(t.trim()), "done" to JsonPrimitive(d))) })))

    /** The site's `isSafeHttpsUrl`: https only, a host, no user or password in it. */
    fun isSafeHttps(url: String?): Boolean {
        val text = url?.trim().orEmpty()
        if (text.isEmpty() || text.length > 2000) return false
        val u = runCatching { java.net.URI(text) }.getOrNull() ?: return false
        return u.scheme.equals("https", ignoreCase = false) && !u.host.isNullOrEmpty() && u.rawUserInfo == null
    }

    fun linkUrl(data: JsonElement?): String? = ((data as? JsonObject)?.get("url") as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { isSafeHttps(it) }

    fun linkData(url: String): JsonElement = JsonObject(mapOf("url" to JsonPrimitive(url.trim())))

    fun table(data: JsonElement?): Pair<List<String>, List<List<String>>> {
        val o = data as? JsonObject ?: return listOf("") to emptyList()
        val cols = (o["columns"] as? JsonArray)?.map { (it as? JsonPrimitive)?.contentOrNull.orEmpty() } ?: listOf("")
        val rows = (o["rows"] as? JsonArray)?.map { r -> (r as? JsonArray)?.map { (it as? JsonPrimitive)?.contentOrNull.orEmpty() }.orEmpty() }.orEmpty()
        return cols.ifEmpty { listOf("") } to rows.map { r -> List(cols.size.coerceAtLeast(1)) { i -> r.getOrElse(i) { "" } } }
    }

    fun tableData(columns: List<String>, rows: List<List<String>>): JsonElement = JsonObject(
        mapOf(
            "columns" to JsonArray(columns.map { JsonPrimitive(it.trim()) }),
            "rows" to JsonArray(rows.map { r -> JsonArray(columns.indices.map { i -> JsonPrimitive(r.getOrElse(i) { "" }.trim()) }) }),
        ),
    )

    /** The one line under a card's title in the list: its progress, its link's host, its rows, its file, or its first words. */
    fun preview(c: CardItem): String = when (c.kind) {
        "LIST" -> listItems(c.data).let { if (it.isEmpty()) listEmpty else listProgress(it.count { i -> i.second }, it.size) }
        "LINK" -> linkUrl(c.data)?.let { runCatching { java.net.URI(it).host }.getOrNull() } ?: linkInvalid
        "TABLE" -> tableRows(table(c.data).second.size)
        "FILE" -> c.file?.name ?: fileGone
        else -> c.body?.lineSequence()?.firstOrNull { it.isNotBlank() }?.trim().orEmpty()
    }

    /** Tags as the site cleans them: trimmed, no leading #, no repeats, 30 letters, ten at most. */
    fun tagsOf(text: String): List<String> {
        val out = mutableListOf<String>()
        for (raw in text.split(',', '،')) {
            val t = raw.trim().trimStart('#').trim().take(30)
            if (t.isNotEmpty() && t !in out) out.add(t)
            if (out.size >= 10) break
        }
        return out
    }

    // ── search, filter, sort (view.ts) ──

    /** For searching: lower case, no short vowels or tatweel, one shape of alef, ya and ta marbuta, Western digits. */
    fun searchKey(text: String): String {
        val sb = StringBuilder()
        for (ch in java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFKC).lowercase(Locale.ROOT)) {
            when {
                ch in 'ً'..'ٟ' || ch == 'ٰ' || ch == 'ـ' -> {}
                ch == 'أ' || ch == 'إ' || ch == 'آ' || ch == 'ٱ' -> sb.append('ا')
                ch == 'ى' -> sb.append('ي')
                ch == 'ة' -> sb.append('ه')
                ch in '٠'..'٩' -> sb.append('0' + (ch - '٠'))
                ch in '۰'..'۹' -> sb.append('0' + (ch - '۰'))
                else -> sb.append(ch)
            }
        }
        return sb.toString()
    }

    private fun haystack(c: CardItem): String {
        val parts = mutableListOf(c.title, c.body.orEmpty())
        if (c.kind == "LIST") parts += listItems(c.data).map { it.first }
        if (c.kind == "TABLE") table(c.data).let { (cols, rows) -> parts += cols; parts += rows.flatten() }
        return searchKey(parts.joinToString("\n"))
    }

    /** `category`: null = every one, "" = «بلا تصنيف». */
    fun visible(cards: List<CardItem>, q: String, kind: String?, category: String?, pinnedOnly: Boolean, sort: String): List<CardItem> {
        val needle = searchKey(q.trim())
        val kept = cards.filter { c ->
            (kind == null || c.kind == kind) &&
                (category == null || (if (category.isEmpty()) c.category == null else c.category == category)) &&
                (!pinnedOnly || c.pinned) &&
                (needle.isEmpty() || haystack(c).contains(needle))
        }
        val ar = Collator.getInstance(Locale("ar"))
        val within: Comparator<CardItem> = when (sort) {
            "newest" -> compareByDescending<CardItem> { it.createdAt }.thenBy { it.id }
            "oldest" -> compareBy<CardItem> { it.createdAt }.thenBy { it.id }
            "title" -> Comparator<CardItem> { a, b -> ar.compare(a.title, b.title) }.thenBy { it.id }
            else -> compareBy<CardItem> { it.position }.thenBy { it.id }
        }
        return kept.sortedWith(compareBy<CardItem> { !it.pinned }.then(within))
    }

    fun categoriesOf(cards: List<CardItem>): List<String> {
        val ar = Collator.getInstance(Locale("ar"))
        return cards.mapNotNull { it.category }.distinct().sortedWith(ar)
    }

    // ── the log (texts.ts `logText`) ──

    fun logLine(e: LogEntry): String {
        val d = e.detail
        fun str(k: String) = (d[k] as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
        fun num(k: String) = (d[k] as? JsonPrimitive)?.intOrNull?.toString().orEmpty()
        val what = when (e.action) {
            "created" -> "أنشأ اللوحة"
            "edited" -> {
                val raw = d["fields"]
                val list = when (raw) {
                    is JsonArray -> raw.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                    is JsonPrimitive -> raw.contentOrNull?.split(',')?.filter { it.isNotBlank() }.orEmpty()
                    else -> emptyList()
                }
                if (list.isNotEmpty()) "عدّل اللوحة (${list.joinToString("، ") { field(it) }}) فصارت الإصدار ${num("version")}"
                else "عدّل اللوحة فصارت الإصدار ${num("version")}"
            }
            "restored" -> "استرجع الإصدار ${num("fromVersion")} فصار الإصدار ${num("version")}"
            "status" -> "نقل الحالة من «${status(str("from"))}» إلى «${status(str("to"))}»"
            "pinned" -> if ((d["pinned"] as? JsonPrimitive)?.booleanOrNull == true) "ثبّت اللوحة" else "ألغى تثبيت اللوحة"
            "sent" -> "أرسل اللوحة إلى محادثة"
            "task" -> "حوّل اللوحة إلى مهمة"
            "archived" -> "حذف اللوحة"
            "unarchived" -> "استرجع اللوحة المحذوفة"
            "rated" -> if (e.actorName != null) "غيّر تقييمه للوحة" else "قيّم أحد الأعضاء اللوحة"
            "image_added" -> "أضاف إلى المعرض: ${str("name")}"
            "image_removed" -> "أزال من المعرض: ${str("name")}"
            "cover" -> if ((d["removed"] as? JsonPrimitive)?.booleanOrNull == true) "أزال الغلاف" else "عيّن غلافًا: ${str("name")}"
            "copied" -> "نسخ من الكرت: ${str("what")}"
            else -> "عدّل اللوحة"
        }
        // a rating seen by somebody who may not know who rated has no name (the site's own rule)
        return if (e.action == "rated" && e.actorName == null) what else "${e.actorName ?: someone}: $what"
    }

    /** a date and an hour, written with 0-9 (an Arabic phone writes ٠-٩ by default: `Locale.ROOT`) */
    fun stamp(iso: String?, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String {
        val t = runCatching { java.time.Instant.parse(iso).atZone(zone) }.getOrNull() ?: return ""
        val day = io.zakiai.workspace.feature.projects.P.dmy(iso, zone).orEmpty()
        return day + " " + String.format(Locale.ROOT, "%02d:%02d", t.hour, t.minute)
    }
}
