package io.zakiai.workspace;

import android.content.Context;
import android.content.SharedPreferences;

/** The one address the app talks to, and what it remembers on the phone (the key of its pairing and the time of the last notification it showed). */
final class Config {
    static final String BASE = "https://workspace.zakiai.io";

    private Config() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("zaki", Context.MODE_PRIVATE);
    }

    static String token(Context c) {
        return prefs(c).getString("token", "");
    }

    static void setToken(Context c, String token, String deviceId) {
        prefs(c).edit().putString("token", token).putString("deviceId", deviceId).putLong("since", System.currentTimeMillis()).apply();
    }

    static String deviceId(Context c) {
        return prefs(c).getString("deviceId", "");
    }

    static void clearToken(Context c) {
        prefs(c).edit().remove("token").remove("deviceId").apply();
    }

    static long since(Context c) {
        return prefs(c).getLong("since", 0);
    }

    static void setSince(Context c, long at) {
        prefs(c).edit().putLong("since", at).apply();
    }

    /** A path of the site ("/chat/abc") out of what the server sent; anything else opens the home page. Never another address. */
    static String siteUrl(String path) {
        if (path == null || !path.startsWith("/") || path.startsWith("//") || path.length() > 2000) return BASE + "/";
        return BASE + path;
    }
}
