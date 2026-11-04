package io.zakiai.workspace;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * THE LIVE LINE. While the app is paired this service keeps one request open to the server (/api/device/stream, with the key of the pairing)
 * and shows what arrives: notifications and the ring of a call, even when the app is closed. It reconnects by itself (2 seconds, doubling
 * to a minute) and replays the notifications it missed while it was cut. A refused key (the phone was unpaired on the site) stops it.
 */
public class StreamService extends Service {
    private volatile boolean running;
    private volatile boolean greeted;
    private volatile HttpURLConnection connection;
    private Thread thread;

    static void start(Context c) {
        if (Config.token(c).isEmpty()) return;
        try {
            c.startForegroundService(new Intent(c, StreamService.class));
        } catch (RuntimeException e) {
            // the system refused a start from the background (battery limits): the next time the app opens it starts again
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notifier.channels(this);
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(Notifier.STATUS_ID, Notifier.status(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        } else {
            startForeground(Notifier.STATUS_ID, Notifier.status(this));
        }
        if (!running) {
            running = true;
            thread = new Thread(this::loop, "zaki-stream");
            thread.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        HttpURLConnection c = connection;
        if (c != null) c.disconnect();
        super.onDestroy();
    }

    private void loop() {
        long backoff = 2_000;
        while (running) {
            String token = Config.token(this);
            if (token.isEmpty()) break;
            greeted = false;
            int code = 0;
            try {
                code = connectOnce(token);
            } catch (IOException ignored) {
                // no network, a cut line: try again below
            }
            if (code == 401) {
                // the phone was unpaired on the site: forget the key and stop
                Config.clearToken(this);
                break;
            }
            if (greeted) backoff = 2_000;
            long wait = code == 404 ? 300_000 : backoff;
            try {
                Thread.sleep(wait);
            } catch (InterruptedException e) {
                break;
            }
            backoff = Math.min(backoff * 2, 60_000);
        }
        running = false;
        stopSelf();
    }

    private int connectOnce(String token) throws IOException {
        URL url = new URL(Config.BASE + "/api/device/stream?since=" + Config.since(this));
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        connection = c;
        try {
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("Accept", "text/event-stream");
            c.setConnectTimeout(15_000);
            // the server pings every 20 seconds: a silence of 75 means the line is dead
            c.setReadTimeout(75_000);
            int code = c.getResponseCode();
            if (code != 200) return code;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                String event = "";
                String data = "";
                String line;
                while (running && (line = r.readLine()) != null) {
                    if (line.startsWith("event:")) event = line.substring(6).trim();
                    else if (line.startsWith("data:")) data = line.substring(5).trim();
                    else if (line.isEmpty()) {
                        if (!event.isEmpty()) handle(event, data);
                        event = "";
                        data = "";
                    }
                }
            }
            return 200;
        } finally {
            c.disconnect();
            connection = null;
        }
    }

    private void handle(String event, String data) {
        try {
            JSONObject o = new JSONObject(data);
            if (event.equals("hello")) {
                greeted = true;
                return;
            }
            String title = o.optString("title");
            String body = o.optString("body");
            String path = o.optString("url");
            String tag = o.optString("tag");
            long at = o.optLong("at", 0);
            if (event.equals("ring")) {
                Notifier.ring(this, title, body, path);
            } else if (event.equals("missed")) {
                Notifier.cancelRing(this);
                Notifier.note(this, title, body, path, tag);
            } else if (event.equals("note")) {
                Notifier.note(this, title, body, path, tag);
                if (at > Config.since(this)) Config.setSince(this, at);
            }
        } catch (Exception ignored) {
            // a message the app cannot read is skipped; the line goes on
        }
    }
}
