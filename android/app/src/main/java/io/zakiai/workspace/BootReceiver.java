package io.zakiai.workspace;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After the phone starts, or the app is updated, the live line comes back by itself when the phone is paired. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        StreamService.start(context);
    }
}
