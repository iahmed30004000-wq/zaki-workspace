package io.zakiai.workspace.feature.mfg

import java.math.BigDecimal
import java.math.RoundingMode
import java.util.Locale

/** The site's sentence of [key] (generated from ar.manufacturing.json), its «{param}» filled. */
fun w(key: String, vararg params: Pair<String, Any?>): String = MfgWords.s(key, *params)

/**
 * The ledger's numbers as the site writes them (src/lib/manufacturing/shared.ts): a quantity is micro-units shown with a thousands comma
 * and its fraction trimmed («1,250.5»), money is minor units shown with its currency's decimals («12.500 دينار أردني»). Western digits
 * always (`Locale.ROOT`). Pure (MfgTest pins them).
 */
object Q8 {
    const val MICRO = 1_000_000L
    const val cancel = "إلغاء"
    const val edit = "تعديل"
    const val save = "حفظ"
    const val csvWarn = "⚠️ تنزيل الجداول كملف من الموقع بس."
    const val csvFix = "🔧 افتح «مخزون التصنيع» على الموقع ونزّل الملف من هناك؛ نفس الأرقام اللي هون."

    /** the decimals of a currency (`CURRENCIES`): the two dinars three, every other two */
    fun decimals(currency: String?) = if (currency == "JOD" || currency == "KWD") 3 else 2

    /** `formatQty`: a quantity of micro-units, grouped, the trailing zeros of the fraction dropped, no point for a whole number */
    fun qty(micro: Long): String = scaled(BigDecimal.valueOf(micro).movePointLeft(6))

    /** `formatMinor`: minor units with the currency's decimals always shown, grouped */
    fun money(minor: Long, currency: String?): String {
        val d = decimals(currency)
        val v = BigDecimal.valueOf(minor).movePointLeft(d).setScale(d, RoundingMode.UNNECESSARY)
        return String.format(Locale.ROOT, "%,." + d + "f", v)
    }

    /** the amount and the currency's Arabic name, as the site's `Money` writes it */
    fun moneyText(minor: Long, currency: String?): String = money(minor, currency) + (currency?.let { " " + (MfgWords.all["mfg.cur.$it"] ?: it) } ?: "")

    private fun scaled(v: BigDecimal): String {
        val s = v.stripTrailingZeros()
        val whole = s.setScale(0, RoundingMode.DOWN).abs().toBigInteger()
        val frac = s.abs().subtract(BigDecimal(whole)).stripTrailingZeros()
        val sign = if (s.signum() < 0) "-" else ""
        val grouped = String.format(Locale.ROOT, "%,d", whole)
        val fracText = if (frac.signum() == 0) "" else frac.toPlainString().removePrefix("0")
        return sign + grouped + fracText
    }

    /** a quantity with its unit, the number kept left-to-right inside the Arabic line */
    fun qtyUnit(micro: Long, unit: String) = "⁦${qty(micro)}⁩ $unit"

    /** the balance in another unit (`displayIn`): 1 unit = num/den base units, rounded half-up to 3 decimals, display only */
    fun inUnit(baseMicro: Long, num: Long, den: Long): String {
        if (num <= 0) return ""
        val v = BigDecimal.valueOf(baseMicro).multiply(BigDecimal.valueOf(den)).divide(BigDecimal.valueOf(num).multiply(BigDecimal.valueOf(MICRO)), 3, RoundingMode.HALF_UP)
        return scaled(v)
    }

    private val MONTHS = listOf("كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول")

    /** `fmtDMY`: «5 كانون الثاني 2026» from «YYYY-MM-DD» or an ISO instant */
    fun dmy(day: String?): String = runCatching { java.time.LocalDate.parse(day!!.take(10)) }.getOrNull()?.let { "${it.dayOfMonth} ${MONTHS[it.monthValue - 1]} ${it.year}" }.orEmpty()

    /** today as «YYYY-MM-DD» on this phone (the receive form's default, as the site's date field) */
    fun today(): String = java.time.LocalDate.now().toString()

    val CURRENCIES = listOf("JOD", "USD", "EUR", "GBP", "SAR", "AED", "KWD", "EGP", "ILS", "TRY", "SYP", "CNY")

    /** the precise refusal of a field when the site has a sentence for it, the general one otherwise */
    fun refusal(detail: String?, general: String): String = detail?.let { MfgWords.all[it] } ?: general
}
