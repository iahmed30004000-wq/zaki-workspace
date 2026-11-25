package io.zakiai.workspace.feature.library

/** The words of «المكتبة» on screen: the site's own Arabic (src/lib/i18n/ar*.json, the keys beside each). */
object L {
    const val library = "المكتبة" // nav.place.library
    const val files = "مكتبة مساحة العمل" // nav.files
    const val documents = "المستندات" // nav.tab.documents
    const val knowledge = "المنتجات" // nav.tab.knowledge

    // files (files.* / spacelib.*)
    const val upload = "رفع ملف"
    const val empty = "لا ملفات بعد — ارفع أول ملف للفريق"
    const val download = "تنزيل"
    const val share = "شارك أو احفظ"
    const val delete = "حذف"
    const val deleteAsk = "حذف هذا الإصدار؟"
    const val deleted = "حُذف الملف"
    const val tooLarge = "الملف أكبر من 25 ميغابايت"
    const val uploaded = "انرفع الملف."
    const val uploading = "عم نرفع"
    const val search = "دوّر باسم الملف"
    const val noMatch = "ما في ملف بهالاسم بمكتبة هاي المساحة"
    const val hint = "كل مساحة إلها مكتبتها: بتشوف هون ملفات المساحة اللي إنت فيها بس."
    const val ofCompany = "ملفات الشركة"
    fun ofSpace(name: String) = "ملفات مساحة «$name»"
    fun version(n: Int) = "الإصدار $n"
    fun versionOf(n: Int, m: Int) = "الإصدار $n من $m"
    fun by(who: String) = "بواسطة $who"
    const val cancel = "إلغاء"

    /** ⚠️ / 🔧 of the storage (spacelib.warn.* / spacelib.fix.*): the server keeps the files while the Drive is not there. */
    fun storageWarn(reason: String): Pair<String, String>? = when (reason) {
        "not_configured" -> "⚠️ الدرايف مش مربوط؛ الملفات عم تنحفظ على السيرفر وممكن يمتلي" to "🔧 المالك بيدخل مفاتيح Google من «الأتمتة والتكاملات» وبيربط الدرايف، وبعدها الملفات الجديدة بتروح عالدرايف."
        "not_connected" -> "⚠️ الدرايف مش مربوط؛ الملفات عم تنحفظ على السيرفر وممكن يمتلي" to "🔧 المالك بيربط الدرايف من «الأتمتة والتكاملات»، وبعدها الملفات الجديدة بتروح عالدرايف."
        "needs_reconnect" -> "⚠️ ربط الدرايف قديم (قراءة بس)؛ الملفات عم تنحفظ على السيرفر وممكن يمتلي" to "🔧 المالك بيعيد الربط مرة وحدة من «الأتمتة والتكاملات»."
        "feature_off" -> "⚠️ حفظ الملفات على الدرايف مطفي من «الميزات»؛ الملفات عم تنحفظ على السيرفر وممكن يمتلي" to "🔧 المالك بيشغّل «المكتبة على Google Drive» من «الميزات»."
        "unavailable" -> "⚠️ الدرايف مش عم يرد هلق؛ الملفات عم تنحفظ مؤقتًا على السيرفر وممكن يمتلي" to "🔧 الدرايف بيرجع أول لما يرد (بنجرّبه كل دقيقة)، والمالك بينقل اللي انحفظ عالسيرفر للدرايف بعدين."
        else -> null
    }

    // documents (docs.*)
    const val newDoc = "مستند جديد"
    const val newDocTitle = "عنوان المستند الجديد"
    const val newDocHint = "مثلًا: خطة الإطلاق"
    const val docsEmpty = "ما في مستندات بهالمساحة لسا."
    const val docsEmptyHint = "اضغط «مستند جديد» وابدأ اكتب."
    const val sharedBadge = "مشترك مع الشركاء"
    const val noSpace = "ما في مساحة مفتوحة لعرض مستنداتها."
    fun updated(whenText: String) = "آخر تعديل $whenText"
    fun wroteBy(who: String) = "كتبه $who"
    const val modeWrite = "كتابة"
    const val modeRead = "عرض"
    const val bodyHint = "اكتب هون… واكتب @ وبعدها اسم زميل عشان تذكره."
    const val saving = "عم يحفظ…"
    const val saved = "انحفظ"
    const val unsaved = "في تعديلات لسا ما انحفظت"
    const val saveError = "ما انحفظ، رح نعيد المحاولة"
    const val readOnly = "للقراءة فقط"
    const val conflict = "غيرك حفظ نسخة أحدث من هالمستند."
    const val keepMine = "خلّي نسختي"
    const val takeTheirs = "خذ نسختهم"
    const val titleHint = "عنوان المستند"

    // «المنتجات» (knowledge.*)
    const val sheetsEmpty = "ما في كروت منتجات لسا"
    const val sheetsNoSpace = "لسا ما انحددت مساحة المنتجات"
    const val sheetsAskOwner = "اطلبي من المالك يحدّد مساحة المنتجات"
    const val sheetsSearch = "ابحثي بالاسم أو التصنيف"
    const val sheetsNoMatch = "ما في منتج بهالاسم"
    const val inStock = "متوفر"
    const val outOfStock = "نفد"
    const val badgeTest = "تيست"
    const val badgeNew = "جديد"
    const val noPriceShort = "بلا سعر"
    const val priceStale = "⚠️ السعر مش محدّث"
    const val missing = "مش موجود بنظام الطلبات"
    const val faq = "أسئلة الزباين"
    const val copy = "انسخي"
    const val copied = "انتسخ ✓"
    const val filterAll = "الكل"
    const val filterOut = "نفد"
    const val filterTest = "تيست"
}
