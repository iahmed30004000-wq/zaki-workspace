#!/usr/bin/env bash
# Runs INSIDE the emulator job (.github/workflows/android-smoke.yml): installs the app, opens it, tries a wrong sign-in, saves screenshots + log.
set -u
OUT=smoke-out
mkdir -p "$OUT"
APK=android/app/build/outputs/apk/debug/app-debug.apk
PKG=io.zakiai.workspace

adb install -r "$APK" || { echo "install failed"; exit 1; }
adb logcat -c
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
adb shell am start -n "$PKG/.MainActivity"
sleep 12
adb exec-out screencap -p > "$OUT/1-opened.png"

# the screen's words, read from an accessibility dump (it is retried: the system sometimes says «could not get idle state»)
dump() {
  for i in 1 2 3 4 5 6; do
    if adb shell uiautomator dump /sdcard/ui.xml 2>&1 | grep -q "dumped to"; then adb pull /sdcard/ui.xml "$OUT/$1" >/dev/null 2>&1 && return 0; fi
    sleep 2
  done
  return 1
}
dump ui-1.xml || echo "no dump of the first screen"
if [ -f "$OUT/ui-1.xml" ] && ! grep -q "تسجيل الدخول" "$OUT/ui-1.xml"; then
  echo "the sign-in screen did not appear"
  adb logcat -d > "$OUT/logcat.txt"
  exit 1
fi

# the Pixel 6 screen is 1080x2400: the two fields and the button sit where the first screenshot shows them
adb shell input tap 540 1270; sleep 1
adb shell input text "nobody@example.com"; sleep 1
adb shell input keyevent 61; sleep 1   # TAB: the next field (the keyboard moved the screen, a tap would miss)
adb shell input text "wrong-password-123"; sleep 1
adb exec-out screencap -p > "$OUT/1b-typed.png"
adb shell input keyevent 4   # closes the keyboard
sleep 1
adb shell input tap 540 1665
sleep 8
adb exec-out screencap -p > "$OUT/2-wrong-password.png"
dump ui-3.xml || echo "no dump of the last screen"
adb logcat -d > "$OUT/logcat.txt"

STATUS=0
# the round trip to the real server worked: it answered «wrong user name or password»
if [ ! -f "$OUT/ui-3.xml" ] || ! grep -q "غير صحيحة" "$OUT/ui-3.xml"; then
  echo "the app did not show the server's answer to a wrong password"
  STATUS=1
fi
# the app must not have crashed
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt" && grep -A3 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG"; then
  echo "the app crashed"
  grep -B1 -A12 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -60
  STATUS=1
fi
exit $STATUS
