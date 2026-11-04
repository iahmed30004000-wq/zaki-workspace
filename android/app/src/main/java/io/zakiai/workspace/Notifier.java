package io.zakiai.workspace;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;

/** Everything the app shows: the quiet «connected» line, the notifications, and the ring of a call (full screen when the phone is locked). */
final class Notifier {
    static final String CH_STATUS = "status";
    static final String CH_NOTES = "notes";
    static final String CH_CALLS = "calls";
    static final int STATUS_ID = 1;
    static final int RING_ID = 4242;

    private Notifier() {}

    private static NotificationManager manager(Context c) {
        return (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    static void channels(Context c) {
        NotificationManager nm = manager(c);
        NotificationChannel status = new NotificationChannel(CH_STATUS, c.getString(R.string.channel_status), NotificationManager.IMPORTANCE_MIN);
        status.setShowBadge(false);
        nm.createNotificationChannel(status);

        NotificationChannel notes = new NotificationChannel(CH_NOTES, c.getString(R.string.channel_notes), NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(notes);

        NotificationChannel calls = new NotificationChannel(CH_CALLS, c.getString(R.string.channel_calls), NotificationManager.IMPORTANCE_HIGH);
        Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        calls.setSound(ring, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[] {0, 700, 500, 700, 500});
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(calls);
    }

    /** The line the phone shows while the app is connected (the system requires one for a service that keeps running). */
    static Notification status(Context c) {
        return new Notification.Builder(c, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(c.getString(R.string.status_title))
                .setContentIntent(open(c, Config.BASE + "/", 10))
                .setOngoing(true)
                .build();
    }

    /** A tap opens this page of the site in the app (MainActivity answers links of the site). */
    static PendingIntent open(Context c, String url, int requestCode) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).setClass(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void note(Context c, String title, String body, String path, String tag) {
        int id = 100 + (Math.abs((tag == null ? title : tag).hashCode()) % 1_000_000);
        Notification n = new Notification.Builder(c, CH_NOTES)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(open(c, Config.siteUrl(path), id))
                .setAutoCancel(true)
                .build();
        manager(c).notify(id, n);
    }

    /** A call is ringing: heads-up with «answer / decline» on an unlocked phone, the full-screen call screen on a locked one. */
    static void ring(Context c, String title, String body, String path) {
        String url = Config.siteUrl(path);
        Intent screen = new Intent(c, CallActivity.class)
                .putExtra("title", title).putExtra("body", body).putExtra("url", url)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        PendingIntent full = PendingIntent.getActivity(c, RING_ID, screen, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent answer = open(c, url, RING_ID + 1);
        PendingIntent decline = PendingIntent.getBroadcast(c, RING_ID + 2, new Intent(c, DeclineReceiver.class).setPackage(c.getPackageName()), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CH_CALLS)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true)
                .setAutoCancel(true)
                .setTimeoutAfter(45_000)
                .setFullScreenIntent(full, true)
                .setContentIntent(answer)
                .addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat), c.getString(R.string.call_answer), answer).build())
                .addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat), c.getString(R.string.call_decline), decline).build())
                .build();
        // the ring repeats until it is answered, declined or the 45 seconds of a ring pass
        n.flags |= Notification.FLAG_INSISTENT;
        manager(c).notify(RING_ID, n);
    }

    static void cancelRing(Context c) {
        manager(c).cancel(RING_ID);
    }
}
