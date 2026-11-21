# P2.3 — «مهامي» على التلفون: شريط الإضافة، شارة الموعد، صفوف الأدوات

Branch `fix/my-tasks-phone`. Layout and wording of the date only: no behaviour change, no switch, no schema change, no migration, no new dictionary string.

## What changed
- **Date chip** (`components/work/my-tasks/due-chip.tsx`, new; words in `lib/work/due-label.ts`, new): the row and the side panel no longer draw the browser's own `<input type="date">` (`mm/dd/yyyy` on a phone). They draw a short Arabic label — «اليوم» «بكرا» «أمس», any other day as «23 تشرين الثاني» (with the year only when it is not this year), «بدون موعد» when there is none — and lay the real date input over it, invisible (`absolute inset-0 opacity-0`). A tap lands on the input, so the phone's own picker opens; on a desktop the tap calls `showPicker()` (inside `try/catch`). The value that goes to the server is still the company's `YYYY-MM-DD`. An overdue open task keeps the danger colour (now on the label). Touch target: 36px high, at least 44px wide.
- **Quick-add bar** (`quick-add.tsx`): the form is `w-full min-w-0`, the title box `min-w-0 flex-1 text-ellipsis` (a long placeholder ends with … instead of pushing the bar past the screen), the button and the plus `shrink-0`, the box 40px high on a phone.
- **Toolbar** (`toolbar.tsx`): on a phone each of the three rows is ONE strip that slides sideways with no scrollbar (the existing `.strip-scroll` class) and runs to the edge of the screen (`max-md:-mx-4 max-md:px-4`) instead of being cut at the page margin: (1) views + scopes, (2) the quick chips, (3) stage / sort / grouping selects. The search box and «مهام قديمة» get their own full-width line. Nothing inside a strip can shrink (`[&>*]:shrink-0`). On a desktop (`md:`) the layout is the same as before (`md:contents` keeps the first row as one wrapping row, `md:flex-wrap` on the strips).
- Tests: `tests/work-my-tasks-phone.test.ts` (new, 14) was written first (it imported `due-chip` and `due-label`, which did not exist, so it was red); `tests/work-my-tasks-render.test.ts` only moves two `text-danger` expectations from the date input to its label.

## Owner actions «جرّب: ...»
- جرّب: افتح «مهامي» من التلفون (عرض ~390)، شريط «مهمة جديدة» لازم يبين كامل من الطرفين، والكلام الطويل بينتهي بـ … بدل ما يطلع برا الشاشة.
- جرّب: كل مهمة لازم يكون موعدها «اليوم» أو «بكرا» أو «٢٣ تشرين الثاني» (أو «بدون موعد»)، ما في أي `mm/dd/yyyy`. اضغط عليه بيفتح تقويم التلفون، اختار يوم والمهمة بتتغير.
- جرّب: صفوف «قائمة · لوحة · تقويم / أنا · المساحة · مشروع» والفلاتر (اليوم · متأخرة …) والمراحل والترتيب والتجميع: كل صف بينسحب لجنب بإصبعك بدون شريط تمرير، وبدون ما ينقص شي بنص الشاشة.
- جرّب: افتح مهمة (اللوحة الجانبية) وغيّر موعدها من نفس الشارة.
- جرّب: على الكمبيوتر الشاشة نفسها متل قبل.

## Not verified on a real phone
- Checked in the browser pane at 390px and 1100px on a static page (the real components rendered to HTML with the project's Tailwind build, the «day» theme, system fonts instead of IBM Plex): no horizontal page overflow, the three strips scroll with no bar, the date chips draw the Arabic labels, and the desktop row is unchanged. NOT run: the real app with a signed-in session.
- NOT checked on an iPhone or Android: that a tap on the invisible date input opens the system picker (it is the standard way and `showPicker()` is a harmless extra), the Android/iOS look of the picker, and the safe-area edges with the PWA installed.
- I could not reproduce a cut quick-add bar in the static page (at 390px it fitted): the fix hardens it against a long placeholder or a wider real font (`min-w-0`, ellipsis, `shrink-0`). If the owner still sees it cut, a screenshot of that screen is needed.
- The date picker's calendar popup language follows the phone's language setting, not the app.
