package io.zakiai.workspace.feature.chat

/** The chat's words on screen (the site's own Arabic where it has one). */
object C {
    // the list
    const val all = "الكل"
    const val unread = "غير مقروءة"
    const val dms = "خاص"
    const val spaces = "المساحات"
    const val mentions = "الإشارات"
    const val archive = "الأرشيف"
    const val search = "دوّر بالدردشات"
    const val searchChats = "محادثات"
    const val searchPeople = "أشخاص"
    const val searchMessages = "رسائل"
    const val nothingFound = "ما لقينا شي."
    const val saved = "الرسائل المحفوظة"
    const val newChat = "محادثة جديدة"
    const val newGroup = "مجموعة جديدة"
    const val newMessage = "رسالة جديدة"
    const val pin = "ثبّت"
    const val unpin = "شيل التثبيت"
    const val toArchive = "أرشف"
    const val fromArchive = "رجّع من الأرشيف"
    const val markRead = "علّم كمقروءة"
    const val markUnread = "علّم كغير مقروءة"
    const val mute = "اكتم"
    const val unmute = "رجّع الصوت"
    const val muteHour = "ساعة"
    const val mute8 = "٨ ساعات"
    const val muteDay = "يوم"
    const val muteForever = "على طول"
    const val deletedPreview = "رسالة محذوفة"
    const val you = "إنت"
    const val topics = "المواضيع"
    const val closedTopic = "مسكّر"
    const val noArchive = "ما في محادثات مؤرشفة."
    const val people = "الناس"

    // the conversation
    const val typing = "عم يكتب…"
    const val typingMany = "عم يكتبوا…"
    const val members = "عضو"
    const val lastSeen = "آخر ظهور"
    const val reply = "رد"
    const val copy = "انسخ"
    const val copied = "انسخت."
    const val forward = "حوّل"
    const val forwardTo = "حوّل لـ…"
    const val forwarded = "انحوّلت."
    const val forwardedFrom = "محوّلة من"
    const val edit = "عدّل"
    const val editing = "تعديل الرسالة"
    const val replyingTo = "رد على"
    const val edited = "معدّلة"
    const val pinMessage = "ثبّت الرسالة"
    const val unpinMessage = "شيل تثبيت الرسالة"
    const val pinned = "رسالة مثبّتة"
    const val deleteForAll = "احذف عند الكل"
    const val deleteForMe = "احذف عندي"
    const val deleteAsk = "أكيد بدك تحذف الرسالة؟"
    const val cancel = "إلغاء"
    const val delete = "احذف"
    const val newMessages = "رسائل جديدة"
    const val toBottom = "لآخر رسالة"
    const val seenBy = "شافها"
    const val today = "اليوم"
    const val yesterday = "مبارح"
    const val loadingOlder = "عم نجيب الأقدم…"

    // the composer
    const val attach = "أرفق"
    const val photo = "صورة أو فيديو"
    const val file = "ملف"
    const val poll = "استطلاع"
    const val checklist = "قائمة مهام"
    const val record = "سجّل رسالة صوتية"
    const val recording = "عم نسجّل… اسحب لتلغي"
    const val uploading = "عم نرفع"
    const val uploadFailed = "ما زبط الرفع. جرّب كمان مرة."
    const val caption = "اكتب تعليق…"

    // polls and lists
    const val question = "السؤال"
    const val option = "خيار"
    const val addOption = "زيد خيار"
    const val multiple = "أكثر من جواب"
    const val anonymous = "بدون أسماء"
    const val votes = "صوت"
    const val closePoll = "سكّر الاستطلاع"
    const val pollClosed = "الاستطلاع مسكّر"
    const val retract = "اسحب صوتي"
    const val listTitle = "عنوان القائمة"
    const val item = "بند"
    const val addItem = "زيد بند"
    const val othersAdd = "الكل بيقدر يزيد"
    const val othersTick = "الكل بيقدر يعلّم"
    const val create = "اعمل"
    const val of = "من"

    // groups and info
    const val groupName = "اسم المجموعة"
    const val pickPeople = "اختار الناس"
    const val info = "معلومات"
    const val leave = "اطلع من المجموعة"
    const val leaveAsk = "أكيد بدك تطلع من المجموعة؟"
    const val addPeople = "زيد ناس"
    const val remove = "شيل"
    const val audience = "مين بيشوف"
    const val oversightNotice = "⚠️ صاحب صلاحية الأرشيف بيقدر يقرأ هالمحادثة."
    const val media = "الصور والملفات"
    const val open = "افتح"
    const val download = "نزّل"
    const val downloadStarted = "بلّش التنزيل."
    const val downloadFailed = "ما زبط نجيب الملف. جرّب كمان مرة."
    const val share = "شارك أو احفظ"
    const val voiceNote = "رسالة صوتية"
    const val attachments = "مرفقات"

    /** The site's templates of a system line (src/lib/i18n, `chatc.sys.*`): `{name}` is always the line's author. */
    private val SYSTEM = mapOf(
        "botfather" to "بوت فاذر: {text}",
        "assistant" to "المساعد: {text}",
        "join" to "انضمام {name} إلى المحادثة",
        "leave" to "مغادرة {name} للمحادثة",
        "pin" to "تثبيت رسالة بواسطة {name}",
        "unpin" to "إلغاء تثبيت رسالة بواسطة {name}",
        "close" to "إغلاق الموضوع بواسطة {name}",
        "reopen" to "إعادة فتح الموضوع بواسطة {name}",
        "topic_created" to "إنشاء الموضوع بواسطة {name}",
        "member_added" to "إضافة عضو بواسطة {name}",
        "member_removed" to "إزالة عضو بواسطة {name}",
        "forwarded" to "تحويل رسالة بواسطة {name}",
        "call_started" to "بلّش {name} مكالمة",
        "call_ended" to "خلصت المكالمة",
        "call_missed" to "مكالمة فايتة من {name}",
        "task_rule" to "القاعدة «{rule}» على {task}: {text}",
        "watch_started" to "بلّش {name} جلسة «نتفرّج سوا»",
        "watch_ended" to "خلّص {name} جلسة «نتفرّج سوا»",
    )

    /** The sentence of a system line, as the site writes it (`systemSentence`). Pure (unit-tested). */
    fun systemLine(k: String?, p: Map<String, String>, name: String): String {
        var out = SYSTEM[k] ?: "تحديث في المحادثة"
        // the author's name cannot be replaced by the line's own words
        for ((key, value) in p + ("name" to name)) out = out.replace("{$key}", value)
        return out
    }
}
