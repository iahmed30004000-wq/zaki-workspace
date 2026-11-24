package io.zakiai.workspace;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The one address the app talks to, and what it remembers on the phone (the key of its pairing and the time of the last notification it showed).
 * The address is the flavor's (app/build.gradle.kts): https://workspace.zakiai.io for the real app, the local copy for «staging».
 */
public final class Config {
    public static final String BASE = BuildConfig.BASE_URL;

    private Config() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("zaki", Context.MODE_PRIVATE);
    }

    public static String token(Context c) {
        return prefs(c).getString("token", "");
    }

    public static void setToken(Context c, String token, String deviceId) {
        prefs(c).edit().putString("token", token).putString("deviceId", deviceId).putLong("since", System.currentTimeMillis()).apply();
    }

    public static String deviceId(Context c) {
        return prefs(c).getString("deviceId", "");
    }

    public static void clearToken(Context c) {
        prefs(c).edit().remove("token").remove("deviceId").apply();
    }

    public static long since(Context c) {
        return prefs(c).getLong("since", 0);
    }

    public static void setSince(Context c, long at) {
        prefs(c).edit().putLong("since", at).apply();
    }

    /** A path of the site ("/chat/abc") out of what the server sent; anything else opens the home page. Never another address. */
    public static String siteUrl(String path) {
        if (path == null || !path.startsWith("/") || path.startsWith("//") || path.length() > 2000) return BASE + "/";
        return BASE + path;
    }
}
