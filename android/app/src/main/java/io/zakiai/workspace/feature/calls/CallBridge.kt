package io.zakiai.workspace.feature.calls

import android.content.Context
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent

/** The ring's Java pieces (CallActivity, DeclineReceiver) reach the call engine through here. */
object CallBridge {
    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface Entry { fun engine(): CallEngine }

    private val CALL = Regex("/calls/([A-Za-z0-9_-]+)/?(?:[?#].*)?$")

    /** The call id of a ring's address («…/calls/<id>»), or null. Pure (unit-tested). */
    @JvmStatic
    fun callIdOf(url: String?): String? = url?.let { CALL.find(it)?.groupValues?.get(1) }

    /** «رفض»: the site told (`POST /api/calls/[id]/decline`), so the caller stops ringing at once instead of ringing out. */
    @JvmStatic
    fun decline(context: Context, url: String?) {
        val id = callIdOf(url) ?: return
        runCatching { EntryPointAccessors.fromApplication(context.applicationContext, Entry::class.java).engine().decline(id) }
    }
}
