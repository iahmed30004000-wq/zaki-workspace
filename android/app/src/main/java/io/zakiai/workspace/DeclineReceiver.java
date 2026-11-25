package io.zakiai.workspace;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** «Decline» on the ring notification: the ring stops. */
public class DeclineReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Notifier.cancelRing(context);
        // the site is told, so the caller stops ringing at once (M2 N5)
        io.zakiai.workspace.feature.calls.CallBridge.decline(context, intent.getStringExtra("url"));
    }
}
