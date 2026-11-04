package io.zakiai.workspace;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Receives the key of the pairing (the site opens intent://pair?token=… for THIS app only, by its package name, so no other app can
 * catch the key), keeps it, starts the live line, and asks for the three things a ringing phone needs: notifications, the full-screen
 * call screen, and to be left running in the background. Each button is shown only while that permission is still missing.
 */
public class PairActivity extends Activity {
    private LinearLayout column;
    private Button notificationsButton;
    private Button fullScreenButton;
    private Button batteryButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        build();
        accept(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        accept(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    private void accept(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        String token = data == null ? null : data.getQueryParameter("token");
        if (token != null && token.startsWith("zk_") && token.length() < 200) {
            Config.setToken(this, token);
            StreamService.start(this);
        }
    }

    private void build() {
        column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);
        column.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        column.setBackgroundColor(getColor(R.color.zk_surface));
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        column.setPadding(pad, pad * 2, pad, pad);

        TextView title = text(R.string.pair_title, 24, true);
        TextView intro = text(R.string.pair_intro, 16, false);
        column.addView(title);
        column.addView(intro);

        notificationsButton = button(R.string.pair_notifications, v -> {
            if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1);
        });
        fullScreenButton = button(R.string.pair_fullscreen, v -> {
            if (Build.VERSION.SDK_INT >= 34) startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName())));
        });
        batteryButton = button(R.string.pair_battery, v ->
                startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()))));
        Button open = button(R.string.pair_open, v -> {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(Config.BASE + "/")).setClass(this, MainActivity.class));
            finish();
        });
        column.addView(notificationsButton);
        column.addView(fullScreenButton);
        column.addView(batteryButton);
        column.addView(open);
        setContentView(column);
    }

    private TextView text(int res, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(res);
        t.setTextSize(sp);
        t.setTextColor(0xFFFFFFFF);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        t.setPadding(0, 0, 0, (int) (16 * getResources().getDisplayMetrics().density));
        return t;
    }

    private Button button(int res, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(res);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = (int) (12 * getResources().getDisplayMetrics().density);
        b.setLayoutParams(p);
        return b;
    }

    private void refresh() {
        boolean notifications = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        boolean fullScreen = Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent();
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        boolean battery = pm.isIgnoringBatteryOptimizations(getPackageName());
        notificationsButton.setVisibility(notifications ? View.GONE : View.VISIBLE);
        fullScreenButton.setVisibility(fullScreen ? View.GONE : View.VISIBLE);
        batteryButton.setVisibility(battery ? View.GONE : View.VISIBLE);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        refresh();
    }
}
