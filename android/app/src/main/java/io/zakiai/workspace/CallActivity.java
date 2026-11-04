package io.zakiai.workspace;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The call screen: over the lock screen, the screen switched on, who is calling and two big buttons. «Answer» opens the call in the site;
 * «Decline» only stops the ring (the caller sees it ring out). It closes by itself when the 45 seconds of a ring pass.
 */
public class CallActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setShowWhenLocked(true);
        setTurnScreenOn(true);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        final String title = getIntent().getStringExtra("title");
        final String body = getIntent().getStringExtra("body");
        final String url = Config.siteUrl(pathOf(getIntent().getStringExtra("url")));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setBackgroundColor(getColor(R.color.zk_surface));
        int pad = (int) (32 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        TextView name = new TextView(this);
        name.setText(title == null ? getString(R.string.call_incoming) : title);
        name.setTextColor(Color.WHITE);
        name.setTextSize(28);
        name.setTypeface(name.getTypeface(), Typeface.BOLD);
        name.setGravity(Gravity.CENTER);
        TextView what = new TextView(this);
        what.setText(body == null ? "" : body);
        what.setTextColor(0xFFB8C4D6);
        what.setTextSize(18);
        what.setGravity(Gravity.CENTER);
        what.setPadding(0, pad / 2, 0, pad);

        Button answer = new Button(this);
        answer.setText(R.string.call_answer);
        answer.setBackgroundColor(0xFF1F9D55);
        answer.setTextColor(Color.WHITE);
        answer.setOnClickListener(v -> {
            Notifier.cancelRing(this);
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).setClass(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
            finish();
        });
        Button decline = new Button(this);
        decline.setText(R.string.call_decline);
        decline.setBackgroundColor(0xFFC0392B);
        decline.setTextColor(Color.WHITE);
        decline.setOnClickListener(v -> {
            Notifier.cancelRing(this);
            finish();
        });
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (int) (64 * getResources().getDisplayMetrics().density));
        p.topMargin = pad / 2;
        root.addView(name);
        root.addView(what);
        root.addView(answer, p);
        root.addView(decline, p);
        setContentView(root);

        handler.postDelayed(this::finish, 45_000);
    }

    /** The path of the site inside the full address the notification carried ("" when it is not one of ours). */
    private static String pathOf(String url) {
        if (url == null || !url.startsWith(Config.BASE)) return "/";
        return url.substring(Config.BASE.length());
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
