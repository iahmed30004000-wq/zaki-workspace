package io.zakiai.workspace.feature.accounts

import io.zakiai.workspace.core.net.ApiFailure
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import java.text.Normalizer
import java.time.Instant

/*
 * «الحسابات والصلاحيات» (M2 N6 batch 12) — the site's people screen (`OrgMembersView`, `/members` and the panel's «الحسابات») on the phone: the list
 * with its search and status filter (GET /api/organizations/[id]/members), one person's sheet as the server decides it
 * (GET /api/organizations/[id]/members/[userId]/sheet, the site's own functions), and the site's own routes for every change. What shows a temporary
 * password (a new account, a reset, a reactivation) stays the site's page, marked.
 */

/** the site's own words, `members.*` and the few named beside them */
fun w(key: String, vararg params: Pair<String, Any?>): String = AccountWords.s(key, *params)

@Serializable
data class MemberSpace(val id: String = "", val name: String = "", val role: String = "")

@Serializable
data class Member(
    val id: String = "",
    val name: String = "",
    val username: String? = null,
    val email: String? = null,
    val jobTitle: String? = null,
    val role: String = "GUEST",
    val status: String = "ACTIVE",
    val managerId: String? = null,
    val managerName: String? = null,
    val capabilities: List<String> = emptyList(),
    val revokedCapabilities: List<String> = emptyList(),
    val primaryOwner: Boolean? = null,
    val lastLoginAt: String? = null,
    val mustChangePassword: Boolean = false,
    val avatarUrl: String? = null,
    val openWork: Int = 0,
    val workspaces: List<MemberSpace> = emptyList(),
    val verified: Boolean? = null,
    val spaceOnly: Boolean? = null,
)

@Serializable
data class Roster(val members: List<Member> = emptyList(), val actorRole: String = "GUEST", val actorPrimaryOwner: Boolean = false)

@Serializable
data class Lists(val capabilities: List<String> = emptyList(), val revokedCapabilities: List<String> = emptyList())

/** a switch or a box of the grid: its state, why it is locked (null: it is not), and the lists a flip sends */
@Serializable
data class CapRow(
    val capability: String = "",
    val on: Boolean = false,
    val rankDefault: Boolean = false,
    val customized: Boolean = false,
    val locked: String? = null,
    val sensitive: Boolean = false,
    val needsView: Boolean = false,
    val next: Lists = Lists(),
)

@Serializable
data class GridRow(val section: String = "", val cells: List<CapRow?> = emptyList())

@Serializable
data class Area(val id: String = "", val on: Int = 0, val total: Int = 0, val grid: List<GridRow> = emptyList(), val rows: List<CapRow> = emptyList())

@Serializable
data class Why(val capability: String = "", val usable: Boolean = false, val why: String = "")

@Serializable
data class ExplainArea(val id: String = "", val rows: List<Why> = emptyList())

@Serializable
data class Acts(
    val isSelf: Boolean = false,
    val manageable: Boolean = false,
    val edit: Boolean = false,
    val rankChoices: List<String> = emptyList(),
    val capabilities: String = "readonly",
    val suspend: Boolean = false,
    val offboard: Boolean = false,
    val reactivate: Boolean = false,
    val resetPassword: Boolean = false,
    val logoutEverywhere: Boolean = false,
)

@Serializable
data class Pick(val id: String = "", val name: String = "", val role: String = "MEMBER", val primaryOwner: Boolean = false)

@Serializable
data class MemberSheet(
    val member: Member = Member(),
    val acts: Acts = Acts(),
    val ownerRank: Boolean = false,
    val roles: List<String> = emptyList(),
    val oversight: CapRow? = null,
    val areas: List<Area> = emptyList(),
    val explain: List<ExplainArea> = emptyList(),
    val reset: Lists? = null,
    val managers: List<Pick> = emptyList(),
    val receivers: List<Pick> = emptyList(),
)

@Serializable
data class StatusBody(val action: String, val transferToUserId: String? = null)

@Serializable
data class VerifiedBody(val verified: Boolean)

@Serializable
data class VerifiedAnswer(val verified: Boolean = false)

@Serializable
data class OpenCard(val id: String = "", val number: Int = 0, val title: String = "", val workspaceName: String = "", val columnName: String = "")

@Serializable
data class OpenCards(val count: Int = 0, val tasks: List<OpenCard> = emptyList())

@Serializable
data class BulkBody(val from: String, val to: String?, val workspaceId: String? = null)

@Serializable
data class Skipped(val id: String = "", val reason: String = "")

@Serializable
data class BulkResult(val moved: List<String> = emptyList(), val requested: List<String> = emptyList(), val skipped: List<Skipped> = emptyList())

@Serializable
data class DirUser(val id: String = "", val name: String = "")

@Serializable
data class DirPerson(val userId: String = "", val user: DirUser = DirUser())

@Serializable
data class Directory(val people: List<DirPerson> = emptyList())

interface AccountsApi {
    @GET("api/organizations/{org}/members")
    suspend fun roster(@Path("org") org: String, @Header("Cache-Control") cache: String = "no-store"): Roster

    @GET("api/organizations/{org}/members/{id}/sheet")
    suspend fun sheet(@Path("org") org: String, @Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): MemberSheet

    /** name, job title, rank, manager (a cleared manager travels as null), or the two capability lists */
    @PATCH("api/organizations/{org}/members/{id}")
    suspend fun patch(@Path("org") org: String, @Path("id") id: String, @Body body: JsonObject): JsonObject

    @PATCH("api/organizations/{org}/members/{id}")
    suspend fun lists(@Path("org") org: String, @Path("id") id: String, @Body body: Lists): JsonObject

    @POST("api/organizations/{org}/members/{id}/status")
    suspend fun status(@Path("org") org: String, @Path("id") id: String, @Body body: StatusBody): JsonObject

    @POST("api/organizations/{org}/members/{id}/logout")
    suspend fun logout(@Path("org") org: String, @Path("id") id: String): JsonObject

    @GET("api/organizations/{org}/members/{id}/verify")
    suspend fun verified(@Path("org") org: String, @Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): VerifiedAnswer

    @POST("api/organizations/{org}/members/{id}/verify")
    suspend fun verify(@Path("org") org: String, @Path("id") id: String, @Body body: VerifiedBody): VerifiedAnswer

    @GET("api/tasks/bulk-assign")
    suspend fun openCards(@Query("from") from: String, @Query("workspaceId") workspaceId: String? = null, @Header("Cache-Control") cache: String = "no-store"): OpenCards

    @POST("api/tasks/bulk-assign")
    suspend fun bulk(@Body body: BulkBody): BulkResult

    @GET("api/chat/directory")
    suspend fun directory(): Directory
}

/** Pure pieces (AccountsTest pins them): the site's `members-ui` words and rules the list draws. */
object A {
    const val addWarn = "⚠️ إضافة حساب جديد لسا من صفحة الموقع، لأنها بتطلّع كلمة سر مؤقتة مرة وحدة."
    const val addFix = "🔧 اضغط «إضافة شخص» وبيفتحلك نموذج الموقع جوّا التطبيق."
    const val secretWarn = "⚠️ تصفير كلمة السر وإرجاع الحساب لسا من صفحة الموقع، لأنهم بيطلّعوا كلمة سر مؤقتة مرة وحدة."
    const val secretFix = "🔧 اضغط الزر، بيفتحلك «الحسابات» على الموقع، واختار الشخص من القائمة."
    const val templateWarn = "⚠️ تطبيق «قالب صلاحيات» على الشخص لسا من صفحة الموقع."
    const val templateFix = "🔧 افتح «الحسابات» على الموقع، واختار القالب من ورقة الشخص."
    const val goSite = "افتح على الموقع"
    /** the site's people screen: it moves itself into the panel when the new panel is on */
    const val sitePath = "/members"
    const val addPath = "/members?new=person"

    val STATUSES = listOf("ALL", "ACTIVE", "SUSPENDED", "OFFBOARDED")

    /** «مالك»، «شريك»، «مشرف» …: an OWNER who is not the primary owner is a partner */
    fun role(role: String, primaryOwner: Boolean? = true): String =
        if (role == "OWNER" && primaryOwner == false) w("role.partner") else AccountWords.all["role." + role.lowercase()] ?: w("role.member")

    fun status(s: String): String = when (s) {
        "SUSPENDED" -> w("members.status_suspended")
        "OFFBOARDED" -> w("members.status_offboarded")
        "ALL" -> w("members.filter_all")
        else -> w("members.status_active")
    }

    /** the Arabic number form: one, two, 3-10, 11+ (`arabicPlural`) */
    fun plural(n: Int): String {
        if (n == 1) return "one"
        if (n == 2) return "two"
        val m = n % 100
        return if (m in 3..10) "few" else "many"
    }

    fun count(n: Int): String {
        val key = "members.count." + plural(n)
        return AccountWords.s(key, "n" to n)
    }

    /** «قبل 3 ساعات», «الآن», or «لم يسجّل دخولًا بعد» (`relativeTimeAr`) */
    fun ago(iso: String?, now: Long): String {
        val then = iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: return w("members.never_logged")
        val seconds = (now - then) / 1000
        if (seconds < 45) return w("members.ago.now")
        val (unit, n) = when {
            seconds < 3600 -> "minute" to maxOf(1L, seconds / 60)
            seconds < 86400 -> "hour" to seconds / 3600
            else -> {
                val days = seconds / 86400
                when {
                    days < 30 -> "day" to days
                    days < 365 -> "month" to days / 30
                    else -> "year" to days / 365
                }
            }
        }
        val key = "members.ago.$unit." + plural(n.toInt())
        return AccountWords.s(key, "n" to n)
    }

    fun lastLogin(iso: String?, now: Long): String {
        val known = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } != null
        return if (known) w("members.last_login", "when" to ago(iso, now)) else ago(iso, now)
    }

    /** lower case, no diacritics or tatweel, the spellings people type folded (`normalizeSearch`) */
    fun norm(input: String): String = Normalizer.normalize(input, Normalizer.Form.NFKC).lowercase()
        .replace(Regex("[\\u064B-\\u065F\\u0670\\u0640]"), "")
        .replace(Regex("[أإآٱ]"), "ا").replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
        .replace(Regex("\\s+"), " ").trim()

    /** every word of the search somewhere in the name, username, e-mail or job title (`filterMembers`) */
    fun filter(members: List<Member>, query: String, status: String): List<Member> {
        val words = norm(query).split(" ").filter { it.isNotEmpty() }
        return members.filter { m ->
            if (status != "ALL" && m.status != status) return@filter false
            if (words.isEmpty()) return@filter true
            val hay = listOfNotNull(m.name, m.username, m.email, m.jobTitle).joinToString("\n") { norm(it) }
            words.all { hay.contains(it) }
        }
    }

    fun counts(members: List<Member>): Map<String, Int> = STATUSES.associateWith { s -> if (s == "ALL") members.size else members.count { it.status == s } }

    /** «المقر، الشحن وغيرها (2)» (`spacesSummary`) */
    fun spaces(m: Member, max: Int = 3): String {
        if (m.role == "OWNER") return w("members.spaces_all")
        val names = m.workspaces.map { it.name }
        if (names.isEmpty()) return w("members.spaces_none")
        val shown = names.take(max).joinToString("، ")
        val rest = names.size - max
        return if (rest > 0) "$shown " + w("members.spaces_more", "n" to rest) else shown
    }

    fun identity(m: Member): String? = m.username?.let { "@$it" } ?: m.email

    /**
     * What «حفظ» sends: only what changed (`buildInfoPatch`); an empty job title clears it, no manager travels as null, and a guest has no manager.
     * Null when nothing changed.
     */
    fun infoBody(m: Member, name: String, jobTitle: String, role: String, managerId: String?): JsonObject? {
        val out = LinkedHashMap<String, kotlinx.serialization.json.JsonElement>()
        val n = name.trim()
        if (n != m.name) out["name"] = JsonPrimitive(n)
        val t = jobTitle.trim()
        if (t != (m.jobTitle ?: "")) out["jobTitle"] = JsonPrimitive(t)
        if (role != m.role) out["role"] = JsonPrimitive(role)
        val mgr = managerId?.takeIf { it.isNotEmpty() && role != "GUEST" }
        if (role != "GUEST" && mgr != m.managerId) out["managerId"] = mgr?.let(::JsonPrimitive) ?: JsonNull
        return if (out.isEmpty()) null else JsonObject(out)
    }

    /** «حسب الرتبة», or what the owner changed: «أُضيف فوق الرتبة» / «سُحب من الرتبة» */
    fun tag(r: CapRow): String = if (!r.customized) w("members.caps_default") else if (r.on) w("members.caps_added") else w("members.caps_removed")

    /** the second line worth having: you cannot hand this out, or it is a sensitive extra */
    fun note(r: CapRow): String? = when {
        r.locked == "actor_lacks" -> w("members.caps_locked_actor")
        r.sensitive && r.on && !r.rankDefault -> w("members.caps_sensitive")
        else -> null
    }

    fun capTitle(c: String): String = AccountWords.all["members.cap.$c.title"] ?: c
    fun capHint(c: String): String? = AccountWords.all["members.cap.$c.hint"]
    fun area(id: String): String = AccountWords.all["perm.area.$id"] ?: id
    fun section(id: String): String = AccountWords.all["members.section.$id"] ?: id
    val ACTIONS = listOf("view", "edit", "delete")
    fun action(a: String): String = AccountWords.all["members.action.$a"] ?: a

    /** the server's refusal in the site's own sentence (a key it does not know: what the server said) */
    fun refusal(f: ApiFailure): String = (f.detail ?: f.key)?.let { AccountWords.all[it] } ?: f.message

    /** «منصور — مشرف» (the receiver of a leaver's open work) */
    fun pickLabel(p: Pick): String = p.name + " — " + role(p.role, p.primaryOwner)
}
