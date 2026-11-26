package io.zakiai.workspace.feature.me

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * «إعداداتي» and «دليل زاكي» — the site's own words (ar.settings-me.json, ar.json, ar.automation.json, ar.last-seen.json, ar.app-devices.json,
 * ar.guide.json) and its rules (src/lib/chat/prefs.ts, src/components/settings-me/), ported as they are. Pure (MeTest pins them).
 */
object M {
    const val title = "إعداداتي"
    const val failed = "ما انحفظ، جرّب مرة تانية"
    const val saved = "انحفظ"
    const val accountWide = "هالاختيار بيلحقك على كل أجهزتك."
    const val save = "حفظ"
    const val cancel = "لا"

    // the sections (sections.ts, in its order; «القائمة» «الاختصارات» «البيانات» are the site's: see the marks below)
    const val sAccount = "حسابي"; const val hAccount = "صورتك واسمك وكلمة السر"
    const val sNotifications = "الإشعارات والأصوات"; const val hNotifications = "شو بينبعتلك وكيف بيظهر"
    const val sPrivacy = "الخصوصية والأمان"; const val hPrivacy = "آخر ظهور وذاكرة الجهاز"
    const val sChat = "الدردشة"; const val hChat = "التفاعل السريع"
    const val sDevices = "الأجهزة"; const val hDevices = "تطبيق الأندرويد والمتصفحات والخروج من كل الأجهزة"
    const val sLanguage = "اللغة والأرقام"; const val hLanguage = "العربية وشكل الأرقام"
    const val sHelp = "المساعدة"; const val hHelp = "الدليل والتواصل مع الإدارة"

    // account
    const val photo = "صورة البروفايل"
    const val photoHint = "صورة واضحة لوجهك، حتى يعرفوك بسرعة."
    const val photoAdd = "أضف صورة"
    const val photoChange = "تغيير الصورة"
    const val photoRemove = "إزالة الصورة"
    const val photoSaved = "تم تحديث الصورة"
    const val photoRemoved = "تمت إزالة الصورة"
    const val photoTooBig = "الصورة أكبر من 2 ميغابايت."
    const val name = "الاسم"
    const val jobTitle = "المسمّى الوظيفي"
    const val jobTitlePh = "مثال: مدير مشاريع"
    const val bio = "نبذة"
    const val profileSaved = "تم حفظ الملف الشخصي"
    const val username = "اسم المستخدم"
    const val usernameManager = "اسم المستخدم بتغيّره من صفحة الناس لأنك مسؤول عن الحسابات."
    const val usernameMember = "اسم المستخدم بيغيّره المسؤول عن الحسابات."
    const val email = "الإيميل"
    const val readonly = "ما بيتغير من هون."
    const val changePassword = "تغيير كلمة المرور"
    const val currentPassword = "كلمة المرور الحالية"
    const val newPassword = "كلمة المرور الجديدة"
    const val passwordRule = "8 خانات على الأقل، فيها حرف إنجليزي ورقم."
    const val passwordChanged = "تم تغيير كلمة المرور"
    const val wrongCurrent = "كلمة المرور الحالية غير صحيحة"
    const val samePassword = "كلمة المرور الجديدة لازم تكون مختلفة عن الحالية."
    const val passwordOthersOut = "بعد التغيير بتطلع أجهزتك التانية من حسابك، وهالجهاز بيضل داخل."

    // work hours and the auto reply (ar.automation.json)
    const val whTitle = "ساعات الدوام والرد التلقائي"
    const val whHint = "حدد أيام وساعات دوامك. خارجها، الزميل اللي بكتبلك برسالة خاصة بيشوف سطر «رد تلقائي» فيه نصك."
    const val whDays = "أيام الدوام"
    val DAYS = listOf("الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت")
    const val whFrom = "من"
    const val whTo = "إلى"
    const val whClear = "إلغاء الساعات"
    const val whOn = "فعّل الرد التلقائي"
    const val whText = "نص الرد"
    const val whTextPh = "مثلا: أنا خارج الدوام، برد عليك أول ما أبدأ."
    const val whNeedsHours = "حدد الأيام والساعات أول، لأن الرد بيشتغل خارجها بس."
    const val whWarn = "⚠️ السطر بيظهر لأي زميل بكتبلك برسالة خاصة خارج دوامك، مرة كل 12 ساعة بكل محادثة. ما بنكتب شي باسمك وما بنبعت شي لأي ذكاء اصطناعي."
    const val whFix = "🔧 بتطفّيه من هون بأي وقت، أو بتمسح الساعات."
    const val whFailed = "ما انحفظ، تأكد من الساعات والنص وجرّب مرة ثانية"
    const val whNoHours = "بدون ساعات دوام"
    const val whSetHours = "حدد ساعات الدوام"

    // notifications (ar.settings-me.json settingsMe.n.*)
    const val nIntro = "كل نوع إشعار إله مفتاح لحاله. اللي بتطفيه ما بيوصلك منه ولا إشعار، لا بالجرس ولا على التلفون."
    val KINDS = listOf("private", "topics", "mentions", "replies", "calls")
    fun kind(k: String) = when (k) {
        "private" -> "الدردشات الخاصة" to "رسالة وصلتك بمحادثة بينك وبين شخص واحد"
        "topics" -> "المواضيع" to "رسالة بموضوع أو مجموعة إنت فيها"
        "mentions" -> "الإشارات" to "لما حدا يذكرك باسمك أو يذكر الكل"
        "replies" -> "الردود عليّ" to "لما حدا يرد على رسالة إنت كاتبها"
        else -> "المكالمات" to "الرنّة والمكالمة الفائتة لما الموقع مسكّر"
    }
    const val nPreview = "نص الرسالة بالإشعار"
    const val nPreviewHint = "لما تطفيه بيطلع الإشعار «رسالة جديدة» بس، من غير ما يبين شو مكتوب."
    const val nWarnMentions = "⚠️ لو طفيتها ما بيوصلك شي لما حدا يذكرك."
    const val nFixMentions = "🔧 شغّلها من هون بأي وقت، والإشارات بتضل ظاهرة جوا المحادثة."
    const val nWarnCalls = "⚠️ لو طفيتها ما بيرنّ عليك التلفون ولا المتصفح لما الموقع مسكّر."
    const val nFixCalls = "🔧 شغّلها من هون بأي وقت. المكالمة بتضل ترنّ لو الموقع مفتوح قدامك."
    const val nReset = "أعد ضبط الإشعارات"
    const val nResetHint = "كل الأنواع بترجع شغّالة ونص الرسالة بيظهر."
    const val nResetDone = "رجعت الإشعارات كلها شغّالة"
    const val nMuteNote = "المحادثات اللي كاتمها بتلاقيها بقائمة الدردشة، وبتلغي كتمها من معلومات المحادثة."

    // privacy
    const val lsTitle = "آخر ظهور"
    const val lsHide = "إخفاء آخر ظهوري"
    const val lsHint = "إذا شغّلتها، ما حدا بيشوف متى كنت آخر مرة على الموقع."
    const val lsWarn = "⚠️ لو خبّيت آخر ظهورك ما رح تشوف آخر ظهور حدا."
    const val lsFix = "🔧 بتقدر ترجّعه بأي وقت من هون، وبيرجع كل شي متل ما كان."
    const val lsOff = "ما بتتوفر عندك ميزة آخر ظهور بهالشركة."
    const val lsSaved = "انحفظ اختيارك."
    const val pDevices = "الأجهزة والجلسات"; const val pDevicesHint = "شوف أجهزتك واطلع من كل الأجهزة"
    const val pPassword = "كلمة السر"; const val pPasswordHint = "غيّرها من حسابي"

    // chat
    const val quick = "التفاعل السريع"
    const val quickHint = "ستة تفاعلات بتطلع فوق قائمة الرسالة. لازم تكون ستة مختلفة."
    const val quickTaken = "هاد التفاعل موجود بمكان تاني، اختار غيره."
    const val quickReset = "ارجع للستة الأصلية"
    /** the site's six (src/lib/chat-reactions.ts CHAT_REACTIONS) and its palette (chat-section.tsx) */
    val QUICK_DEFAULT = listOf("👍", "❤️", "😂", "🎉", "🔥", "👀")
    val QUICK_PALETTE = QUICK_DEFAULT + listOf("😮", "😢", "🙏", "👏", "💯", "✅", "🤔", "😍", "😎", "🤝", "💪", "⭐", "🚀", "👌", "😅", "🙌")
    const val chatSiteWarn = "⚠️ حجم الخط وخلفية الدردشة ومفتاح الإرسال بيشتغلوا على الموقع؛ التطبيق بيكتب بحجم خط جهازك وبخلفية المظهر."
    const val chatSiteFix = "🔧 غيّرهم من «إعداداتي» على الموقع، والمظهر بتختاره من «الإدارة» هون."

    // devices
    const val vApps = "تطبيق الأندرويد"; const val vAppsHint = "التلفونات المربوطة بحسابك."
    const val vAppsOff = "ربط التطبيق مطفي بهالشركة."
    fun lastConnect(w: String) = "آخر اتصال: $w"
    const val never = "ما اتصل لسا"
    const val noPhones = "ما في تلفون مربوط."
    const val unlink = "فك الربط"
    const val thisPhone = "هالتلفون"
    const val vBrowsers = "المتصفحات اللي بتستقبل إشعارات"; const val vBrowsersHint = "كل متصفح سمحت له يبعتلك إشعارات."
    fun lastPush(w: String) = "آخر إشعار: $w"
    const val noPushYet = "ما وصله إشعار لسا"
    const val noBrowsers = "ما في متصفح بيستقبل إشعارات."
    const val disconnect = "افصل"
    const val disconnected = "انفصل المتصفح"
    const val vSessions = "الجلسات المفتوحة"; const val vSessionsHint = "كل جهاز دخّلت منه على حسابك. بتقدر تطلّع جهاز واحد من غير ما يتأثر الباقي."
    const val thisDevice = "هالجهاز"
    fun lastActive(w: String) = "آخر نشاط: $w"
    fun signedIn(w: String) = "دخل: $w"
    const val noSessions = "ما في جلسات مفتوحة."
    const val endSession = "اطلع من هالجهاز"
    const val endCurrentConfirm = "هاد الجهاز اللي عم تستعمله هلأ. رح تطلع منه وتحتاج تدخل من جديد. تكمل؟"
    const val yesOut = "أيوا، اطلع"
    const val sessionEnded = "طلع الجهاز من حسابك"
    const val vEverywhere = "اطلع من كل الأجهزة"; const val vEverywhereHint = "بتنهي كل الجلسات المفتوحة بحسابك على كل الأجهزة."
    const val everywhereWarn = "⚠️ هالجهاز كمان رح يطلع من حسابك، وبتحتاج تدخل كلمة السر من جديد. والمتصفحات والتلفونات المربوطة بتنفصل وبتوقف عنها الإشعارات."
    const val everywhereFix = "🔧 بعد الخروج دخّل من جديد على كل جهاز بتحتاجه، واربط التلفون وفعّل الإشعارات من جديد."
    const val everywhereConfirm = "تطلع من كل الأجهزة؟"

    // language
    const val arabic = "العربية"
    const val arabicHint = "هي اللغة الوحيدة بالتطبيق وبتظهر هون للتوضيح بس."
    const val digits = "الأرقام"
    const val digitsHint = "شكل الأرقام بكل الشاشات."
    const val digitsLatin = "الأرقام 123"
    const val digitsArabic = "الأرقام الهندية المشرقية"
    const val digitsWarn = "⚠️ الأرقام الهندية المشرقية بتظهر على الموقع؛ التطبيق لسا بيكتب 0-9."
    const val digitsFix = "🔧 اختيارك بينحفظ لحسابك وبيشتغل على الموقع فورًا، وعلى التطبيق بمرحلة جاية."

    // help
    const val guide = "دليل زاكي"; const val guideHint = "شرح الشاشات خطوة خطوة"
    const val contact = "تواصل مع الإدارة"; const val contactHint = "بتفتح محادثة خاصة مع مدير الشركة."
    const val contactFailed = "ما قدرنا نفتح المحادثة"

    // what stays the site's (marked, never removed)
    const val siteSectionsWarn = "⚠️ ترتيب القائمة والمجلدات والاختصارات وجودة الصور والتنزيل التلقائي إعدادات للموقع."
    const val siteSectionsFix = "🔧 افتح «إعداداتي» على الموقع من هون لتغيّرهم."

    // the guide (ar.guide.json)
    const val gTitle = "الدليل"
    const val gSubtitle = "شروحات قصيرة بالعربي، بتمشّيك بالنظام خطوة خطوة."
    const val gSearch = "ابحث بالدليل"
    const val gNone = "ما لقينا مقال بهالكلمات."
    const val gManagers = "لمن يدير الحسابات"
    const val gPrev = "المقال السابق"
    const val gNext = "المقال التالي"
    const val gTip = "💡"

    /** A browser's name from its user agent (devices-section.tsx `browserLabel`): «كروم على ويندوز»; the app is named as the app. */
    fun uaLabel(ua: String?): String {
        val s = ua.orEmpty()
        if (Regex("okhttp|^ZakiApp/", RegexOption.IGNORE_CASE).containsMatchIn(s)) return "تطبيق زاكي على أندرويد"
        val browser = when {
            s.contains("Edg/") -> "إيدج"
            s.contains("OPR/") || s.contains("Opera") -> "أوبرا"
            s.contains("Firefox/") -> "فايرفوكس"
            s.contains("SamsungBrowser") -> "متصفح سامسونج"
            s.contains("Chrome/") -> "كروم"
            s.contains("Safari/") -> "سفاري"
            else -> null
        }
        val system = when {
            s.contains("Android") -> "أندرويد"
            s.contains("iPhone") -> "آيفون"
            s.contains("iPad") -> "آيباد"
            s.contains("Windows") -> "ويندوز"
            s.contains("Mac OS") || s.contains("Macintosh") -> "ماك"
            s.contains("Linux") -> "لينكس"
            else -> null
        }
        return when {
            browser == null -> "متصفح ما بنعرف اسمه"
            system == null -> browser
            else -> "$browser على $system"
        }
    }

    // ── the chat prefs (src/lib/chat/prefs.ts): a section is replaced whole; a default value is not stored ──

    data class NotifyRule(val on: Boolean = true, val preview: Boolean = true)

    fun rules(prefs: JsonObject): Map<String, NotifyRule> {
        val section = prefs["notifications"] as? JsonObject
        return KINDS.associateWith { k ->
            val r = section?.get(k) as? JsonObject
            NotifyRule(
                on = (r?.get("on") as? JsonPrimitive)?.booleanOrNull != false,
                preview = (r?.get("preview") as? JsonPrimitive)?.booleanOrNull != false,
            )
        }
    }

    /** The whole «notifications» section to send: only the `false` flags, an empty rule left out, an empty section as `null`. */
    fun notificationsSection(rules: Map<String, NotifyRule>): JsonElement {
        val out = linkedMapOf<String, JsonElement>()
        for (k in KINDS) {
            val r = rules[k] ?: continue
            val flags = linkedMapOf<String, JsonElement>()
            if (!r.on) flags["on"] = JsonPrimitive(false)
            if (!r.preview && k != "calls") flags["preview"] = JsonPrimitive(false)
            if (flags.isNotEmpty()) out[k] = JsonObject(flags)
        }
        return if (out.isEmpty()) JsonNull else JsonObject(out)
    }

    /** The person's six, or the site's six when none (or a broken list) is stored (`quickReactionsOf`). */
    fun quickOf(prefs: JsonObject?): List<String> {
        val list = ((prefs?.get("chat") as? JsonObject)?.get("quickReactions") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        return if (list != null && list.size == 6 && list.toSet().size == 6) list else QUICK_DEFAULT
    }

    /** The «chat» section with these six (the key left out when they are the site's own), everything else in it kept as it was. */
    fun chatWithQuick(prefs: JsonObject, six: List<String>): JsonObject {
        val chat = (prefs["chat"] as? JsonObject)?.toMutableMap() ?: mutableMapOf()
        if (six == QUICK_DEFAULT) chat.remove("quickReactions") else chat["quickReactions"] = JsonArray(six.map { JsonPrimitive(it) })
        // a double tap that is no longer one of the six would point at nothing: the site keeps it only among them
        (chat["doubleTap"] as? JsonPrimitive)?.contentOrNull?.let { if (it !in six) chat.remove("doubleTap") }
        return JsonObject(chat)
    }

    /** The hours as the server takes them: «HH:MM», from before to, one day at least. */
    private val HM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
    fun hoursProblem(h: WorkHours): String? = when {
        h.days.isEmpty() -> whFailed
        !HM.matches(h.from) || !HM.matches(h.to) || h.from >= h.to -> whFailed
        else -> null
    }
}
