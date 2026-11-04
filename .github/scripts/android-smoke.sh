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

# the sign-in screen must be there: dump the screen and look for its words
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/$1" >/dev/null 2>&1; }
dump ui-1.xml
if ! grep -q "تسجيل الدخول" "$OUT/ui-1.xml"; then
  echo "the sign-in screen did not appear"
  adb logcat -d > "$OUT/logcat.txt"
  exit 1
fi

# centre of the n-th text field and of the sign-in button, from the dump (python3 is on the runner)
centre() {
  python3 - "$OUT/$1" "$2" "$3" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8").read()
kind, n = sys.argv[2], int(sys.argv[3])
nodes = re.findall(r'<node [^>]*>', xml)
def box(node):
    m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
    x1, y1, x2, y2 = map(int, m.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2
if kind == "edit":
    hits = [box(x) for x in nodes if 'class="android.widget.EditText"' in x]
else:
    hits = [box(x) for x in nodes if 'text="دخول"' in x and 'clickable="true"' in x] or [box(x) for x in nodes if 'text="دخول"' in x]
print(f"{hits[n][0]} {hits[n][1]}")
PY
}

read -r X1 Y1 <<<"$(centre ui-1.xml edit 0)"
adb shell input tap "$X1" "$Y1"; sleep 1
adb shell input text "nobody@example.com"; sleep 1
read -r X2 Y2 <<<"$(centre ui-1.xml edit 1)"
adb shell input tap "$X2" "$Y2"; sleep 1
adb shell input text "wrong-password-123"; sleep 1
adb shell input keyevent 4   # closes the keyboard
sleep 1
dump ui-2.xml
read -r X3 Y3 <<<"$(centre ui-2.xml button 0)"
adb shell input tap "$X3" "$Y3"
sleep 8
adb exec-out screencap -p > "$OUT/2-wrong-password.png"
dump ui-3.xml
adb logcat -d > "$OUT/logcat.txt"

STATUS=0
# the round trip to the real server worked: it answered «wrong user name or password»
if ! grep -q "غير صحيحة" "$OUT/ui-3.xml"; then
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
