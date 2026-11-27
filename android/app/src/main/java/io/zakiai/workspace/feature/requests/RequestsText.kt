package io.zakiai.workspace.feature.requests

/** The words of «الطلبات» (the site's own Arabic: workreq.*, taskreq.*). */
object R {
    const val title = "الطلبات"
    const val waiting = "بانتظاري"
    const val mine = "طلباتي"
    const val company = "على مستوى الشركة"
    const val approve = "وافق"
    const val changes = "اطلب تعديل"
    const val reject = "ارفض"
    const val take = "استلمها"
    const val resolve = "حُلّت"
    const val cardApprove = "اعتمد"
    const val cardBack = "رجّعها مسودة"
    const val sheetApprove = "اعتمد الصفحة"
    const val sheetBack = "رجّعها مسودة"
    const val accept = "قبول"
    const val giveBack = "إرجاع بسبب"
    const val reasonLabel = "اكتب السبب"
    const val send = "أرسل"
    const val cancel = "تراجع"
    const val reasonRequired = "اكتب السبب أول"
    const val done = "تم، واختفى من القائمة"
    const val sentBack = "رجعها المراجع لتعدّلها"
    const val nobody = "ما حدا استلمها"
    const val emptyWaiting = "ما في اشي بانتظارك"
    const val emptyWaitingHint = "لما حدا يطلب منك قرار بيطلع هون، وعلى «الشغل» بيظهر رقمه."
    const val emptyMine = "ما في طلبات مفتوحة منك"
    const val emptyMineHint = "الطلبات اللي بتطلبها وبتنتظر ردّ حدا بتطلع هون."
    fun by(name: String) = "من $name"
    fun waitingOn(name: String) = "بانتظار $name"
    fun takenBy(name: String) = "عند $name"
    fun version(n: Int) = "النسخة $n"
    fun more(n: Int) = "في $n كمان، افتحها من صفحتها"
    fun count(n: Int) = "$n بالانتظار"
    fun assignBanner(from: String) = "$from طلب منك تستلم هالمهمة"
    fun assignWaiting(to: String) = "طلبك إلى $to بانتظار الرد"

    /** A section's title (workreq.section.*), «طلباتي» has its own words. Pure (tested). */
    fun section(key: String, mine: Boolean): String = when (key) {
        "approvals" -> if (mine) "موافقات طلبتها" else "الموافقات"
        "assignments" -> if (mine) "طلبات إسناد أرسلتها" else "طلبات إسناد المهام"
        "tickets" -> if (mine) "تذاكر رفعتها" else "تذاكر أقسامي"
        "cards" -> if (mine) "بطاقات أرسلتها للمراجعة" else "بطاقات بانتظار المراجعة"
        "sheets" -> "صفحات منتجات بانتظار الاعتماد"
        // a section a newer site added: a plain word, never its key on screen
        else -> if (mine) "طلباتي" else "طلبات"
    }
}
