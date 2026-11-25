package io.zakiai.workspace.feature.calls

import io.zakiai.workspace.core.net.CallDetail

/** The words of a call on screen: the site's own Arabic (src/lib/i18n, `calls.*`). */
object K {
    const val connecting = "عم نوصلك…" // calls.connecting
    const val reconnecting = "الشبكة ضعيفة، عم نرجّع الاتصال…" // calls.reconnecting
    const val ended = "خلصت المكالمة." // calls.ended
    const val declined = "رفض المكالمة" // calls.declined
    const val noAnswer = "ما حدا ردّ" // calls.no_answer
    const val removedMe = "طلّعوك من هالمكالمة." // calls.removed_me
    const val leave = "اطلع" // calls.leave
    const val endAll = "إنهاء للكل" // calls.end_all
    const val micOff = "سكّر المايك" // calls.mic_off
    const val micOn = "افتح المايك" // calls.mic_on
    const val camOff = "سكّر الكاميرا" // calls.cam_off
    const val camOn = "افتح الكاميرا" // calls.cam_on
    const val you = "إنت" // calls.you
    const val muted = "المايك مسكّر" // calls.muted
    const val audio = "مكالمة صوت" // calls.audio
    const val video = "مكالمة فيديو" // calls.video
    const val answer = "ردّ" // calls.ring.answer
    const val decline = "رفض" // calls.ring.decline
    const val notConfigured = "خادم المكالمات مش جاهز لسّا." // calls.e.not_configured
    const val speaker = "مكبّر الصوت"
    const val flip = "اقلب الكاميرا"
    const val inCall = "مكالمة شغّالة"
    const val pageTitle = "المكالمة" // calls.page_title
    const val failed = "ما قدرنا نوصل لخادم المكالمات. جرّب كمان شوي." // calls.failed
    // calls.no_media, with «إعدادات التلفون» for the phone where the site says «المتصفح»
    const val noMedia = "ما قدرنا نوصل للمايك أو الكاميرا. اسمحلهم من إعدادات التلفون وجرّب مرة تانية."
    /** the same person took their seat on another device (the site sends them back to the chat; the call goes on there) */
    const val elsewhere = "كمّلت المكالمة على جهازك التاني."
}

/** The site's call rules (src/lib/calls/session.ts), pure (unit-tested). */
object CallRules {
    /** LiveKit's reasons that are an END, not a network drop: the person left, sat down elsewhere, was removed, or the room closed. */
    val FINAL = setOf("CLIENT_INITIATED", "DUPLICATE_IDENTITY", "PARTICIPANT_REMOVED", "ROOM_DELETED", "ROOM_CLOSED")

    /** A drop the call rejoins quietly after (the site's `isDrop`): anything not final, and no reason at all. */
    fun isDrop(reason: String?): Boolean = reason == null || reason !in FINAL

    /** The site's `MAX_REJOINS` and its `rejoinDelayMs`: attempt 1 waits 1 s, then 2 s, 4 s, 8 s, at most 15 s. */
    const val MAX_REJOINS = 6
    fun rejoinDelayMs(attempt: Int): Long = minOf(15_000L, 1_000L shl (attempt - 1).coerceIn(0, 10))

    /** The end line (the site's `endKeyOf`). */
    fun endText(detail: CallDetail?, removed: Boolean): String = when {
        removed -> K.removedMe
        detail?.endedHow == "declined" -> K.declined
        detail?.endedHow == "missed" -> K.noAnswer
        else -> K.ended
    }

    /** The microphone opens at once only in a DM or for whoever started the call (the site's `micOnAtJoin`). */
    fun micOnAtJoin(detail: CallDetail): Boolean = detail.kind == "DM" || detail.startedByMe
}
