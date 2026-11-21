# B5 — عجلة التبويبات، النافذة الصغيرة بتروح وين ما بدك، وزر «جديد» فيه المجموعة والموضوع

Branch `feat/wheel-tabs-and-moves`. No schema, no migration, no company feature switch (the three wheel choices are the person's own, kept on the device). The owner asked for these on 2026-11-21.

## What changed
- **Tabs as a wheel (phone only).** The strip under the place's name («مهامي · المشاريع · الطلبات …») snaps like the alarm's picker turned on its side: the tab in the middle is the chosen one, the ones beside it shrink and fade, and when the strip stops the page follows the tab in the middle. Tapping a tab glides it to the middle. A computer, and «ترتيب» (reorder), keep the plain strip.
- **Three choices** in «الإعدادات ← المظهر واللغة ← شريط التبويبات»: the wheel (off: the plain strip), the motion, the tick. The tick (a very short soft click and a 5 ms buzz when a tab reaches the middle) is OFF until asked for. They live in `localStorage` key `zk-tab-wheel` and apply at once.
- **The small call window goes where it is dropped** (phone finger or laptop mouse), not only to a corner. It is remembered as two fractions of the room (`zk-mini-call-spot`), so a turned phone or a resized window keeps it on screen; the notch and the home bar stay clear. Until it is moved it sits in the bottom corner as before. A tap still returns to the call.
- **«جديد» is one menu:** the phone's round pencil and the computer's pencil open «رسالة جديدة · مجموعة جديدة · موضوع جديد · اجتماع جديد». «موضوع جديد» shows only inside one space for somebody who may open topics there (the server decides again); «مجموعة جديدة» is a new dialog (a name plus the colleagues) over the group door that was already there (`POST /api/chat/conversations` `{ kind: "GROUP" }`).
- **Key names in English** on the shortcut lists and the formatting tooltips: Ctrl, Alt, Shift, Esc (the owner: «حطهم إنجليزي»). The allow-list in `tests/arabic-ui.test.ts` grew by two on his word.

## جرّب
1. على الموبايل: افتح «الشغل» واسحب شريط التبويبات يمين وشمال. اللي بالنص هو المختار، والصفحة بتتبدّل لما يوقف. اضغط تبويب بعيد: بيجي للنص.
2. «الإعدادات ← المظهر واللغة»: شغّل «صوت» واسحب الشريط (بتسمع طقّة خفيفة). طفّي «حركة» أو «عجلة التبويبات» وشوف الفرق.
3. صغّر مكالمة جارية وسحب النافذة الصغيرة بإصبعك (موبايل) أو بالماوس (لابتوب) لأي مكان: بتضل مكان ما تركتها حتى لو سكّرت الصفحة ورجعت.
4. من قائمة المحادثات: زر القلم (تحت ع الموبايل، فوق ع اللابتوب) فيه «مجموعة جديدة»: اكتب اسم، اختار ناس، «أنشئ المجموعة». وجوّا مساحة وحدك مدير فيها: «موضوع جديد».
5. «الإعدادات ← الاختصارات»: المفاتيح مكتوبة Ctrl / Alt / Shift / Esc.

## Decisions and limits
- The wheel is phone-wide only (`max-width: 767px`); on a computer the strip stays as it is. If the owner wants the wheel on the computer too it is the same code with a width cap.
- Not checked on a real phone from here: the feel of the snap and the glide, the tick and the buzz (a browser wakes audio only after a touch; the first touch on the strip does that), and the drag of the call window under a thumb.
- «موضوع جديد» is not offered in the company-wide list (no space on screen to put it in), and a guest sees neither the group nor the topic entry.
- Android's own app keeps its own call window; this is the web app.
