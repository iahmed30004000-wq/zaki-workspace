package io.zakiai.workspace;

import android.net.Uri;
import android.os.Bundle;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * The door of the app: the site in the phone's Chrome, full screen (a Trusted Web Activity), so every web feature works as in the browser.
 * Around it the app is native: opening it starts the live line when the phone is paired, answers a tapped notification or call, and the first
 * time (no pairing yet) it opens the site's pairing page so the person links this phone with one tap.
 */
public class MainActivity extends LauncherActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // a ring that was answered by opening the app stops ringing
        Notifier.cancelRing(this);
        StreamService.start(this);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected Uri getLaunchingUrl() {
        Uri url = super.getLaunchingUrl();
        boolean plainLaunch = getIntent() == null || getIntent().getData() == null;
        if (plainLaunch && Config.token(this).isEmpty()) return Uri.parse(Config.BASE + "/app-link?app=1");
        return url;
    }
}
