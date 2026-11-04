package io.zakiai.workspace;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** «Decline» on the ring notification: the ring stops. */
public class DeclineReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Notifier.cancelRing(context);
    }
}
