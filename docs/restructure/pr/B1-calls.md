# B1 — «المكالمات زي تيليجرام»

Branch `feat/calls-telegram`. No schema, no migration, no feature switch. The owner approved the plan on 2026-11-21.

## What changed
- The caller no longer hears the incoming ringtone: his own soft two-note ringback plays only in a private call where somebody was really rung.
- A topic or group call rings nobody unless «رنّ على الكل» is ticked (private calls always ring); a person who muted the conversation is never rung.
- The bar under the header shows up to three faces and «٣ بالمكالمة» to people outside the call; people who join a topic's call enter with the microphone off.
- A private call: full-screen ring on phones, «رفض» tells the caller, no answer ends it as «مكالمة فايتة», answering on one device closes the card on the others.
- «اطلع» is one tap straight back to the chat; «إنهاء للكل» is an item in a small menu; the small window drags, snaps to a corner and remembers it.
- Connect and end sounds, three ringtones (chosen in «الإشعارات»), one tab rings, the phone vibrates; «اجتماع جديد» is in the pencil button's menu.

## New doors
`POST /api/calls/[id]/decline` (the person rung says no; a private call ends for both), `POST /api/calls/[id]/joined` (the browser really connected),
`POST /api/calls/[id]/token` accepts `{ prefetch: true }` (a ringing phone warming its line: not answering).

## جرّب
1. من حسابين: اتصل بواحد من محادثة خاصة. الثاني بيشوف شاشة كاملة (ردّ / رفض)، والمتصل بيسمع نغمة هادية مختلفة عن نغمة الرنين.
2. ارفض: المتصل بيشوف «رفض المكالمة» وبترجع المحادثة، وبالمحادثة سطر «مكالمة فايتة». كمان جرّب ما تردّ 35 ثانية.
3. من موضوع: اضغط مكالمة، «رنّ على الكل» مطفي وما حدا بيرنّ عليه. اللي بيفوت من الشريط الأخضر بيدخل والمايك مسكّر.
4. اضغط «اطلع» مرة وحدة وبترجع للمحادثة. صغّر المكالمة وجرّب تسحب النافذة الصغيرة لأي زاوية: بتلزق وبتتذكر مكانها.
5. من إعدادات «الإشعارات»: اختار نغمة المكالمات (ثلاث نغمات)، ومن زر القلم بالموبايل: «اجتماع جديد».

## Decisions and limits
- A declined private call is logged in the chat as «مكالمة فايتة» (no separate «declined» line); the person who declined is not sent a missed-call push.
- A muted PRIVATE chat still rings (a call there is deliberate); only topics and groups skip the muted.
- A joiner of a meeting by link enters muted unless he started it (the rule is «private call or the starter»).
- The Android app's native button still sends `ring: true` for every call (`android/.../Models.kt`): left alone, so a topic call from the app still rings the space.
- No LiveKit webhook exists: calls still end lazily (at leave time, when somebody looks at them, and when the same conversation calls again), now with short grace times
  (`EMPTY_GRACE_MS` 20 s, `STALE_EMPTY_MS` 8 s, `NO_ANSWER_MS` 35 s in `src/server/calls/calls.ts`).
