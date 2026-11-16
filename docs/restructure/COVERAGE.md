# Coverage — every request of the owner, and where the plan answers it

> Built by re-reading the whole planning conversation of 2026-11-16, request by request, in order. A request with no
> row here is a defect of the plan: add the row and the step. The builder ticks «done» when the named steps are merged.

| # | What the owner asked (his words, shortened) | Where the plan answers it | Open point |
|---|---|---|---|
| 1 | «نحوّل الدردشة لشبيه التيليجرام 100% بالشكل» | `C2-chat-ui.md` (list + conversation + info panel, rows, bubbles, menus, phone screens), `D1-design-system.md` | D-C1, D-D1 |
| 2 | «…والسلاسة» | `C1-chat-engine.md` (cache, deltas instead of refetch, virtual list, optimistic send), C2 §9 motion | — |
| 3 | «…وقوة الاتصال» | `F0-connection-hotfixes.md` (listener cursor, closing dead lines, visible heartbeat, resume), C1.3 | — |
| 4 | «…وسرعة الأداء» | C1, `F1-platform-speed.md` | D-F1 |
| 5 | «…والإعدادات» | `C4-settings.md` («إعداداتي»: account, notifications, privacy, chat, folders, data, devices) | — |
| 6 | «من غير ما نشيل ميزاتنا» | `telegram-parity.md` §6 (EXTRA: message → task/ticket, remind, notes, translate, transcript, image text, whiteboard, watch, digest, archive, polls, outbox); README R7 | — |
| 7 | «وإذا في شي ناقص ضيف» | `telegram-parity.md` (every ADD row), `C3-chat-features.md` | — |
| 8 | «الشغل» | `W1-work.md` (one «مهامي», task inbox, stages, «الطلبات», project page, duplicates marked, simpler Today, honest tabs, old-task sweep) | D-W2, D-W3, D-W4 |
| 9 | «الصلاحيات» | `A1-permissions-and-panels.md` §2 (templates, clear sheet, «شو بيقدر يعمل؟», consistency, grouped switches) | D-A1, D-A2, D-A4, D-A5 |
| 10 | «لوحات التحكم» | `A1-permissions-and-panels.md` §3 (one control panel, one settings page per space, one meaning of "my team") | D-A3, D-A6 |
| 11 | «السايت مش مفهوم — حلّله» | `00-findings.md`, `N1-navigation.md` (rail/drawer, max 4 tabs, visible space, one name per thing, breadcrumbs) | D-N1…D-N5 |
| 12 | «اكتب خطة إعادة هيكلة شاملة ووقّف عند التطبيق» · «اللي رح يكمل البناء سونيت» | this folder; `README.md` (order, rules, prompt template, checklist); nothing was built | — |
| 13 | «في شغلات مش منطقية وبئات» | `00-findings.md` (confirmed defects), `P0-privacy.md`, `F0-connection-hotfixes.md` | — |
| 14 | «ما بتحسها معزولة: لو أعطيت مهام لموظف بتظهر عند الجميع» | P0.2 (private tasks, applied to every read), P0.0 (too many owner-rank accounts) | D-P0, D-P2, D-P3, D-P4 |
| 15 | «التوبيكس حتى لو حطيت خصوصية ما في خصوصية» | P0.0 (who holds the OWNER rank), P0.1 (oversight follows the permission, and the missing switch for it is added), P0.3, P0.4 (privacy shown on screen), P0.5 (test matrix) | D-P0, D-P1 |
| 16 | «ادخل من كروم حلّل» · «ادخل ع السايت وشيّك» | done read-only on 2026-11-16: `00-findings.md` «The live visit» | — |
| 17 | «حتى الشكل بدي أغيّره والأزرار — إعادة هيكلة 100%» | `D1-design-system.md` (two new looks, button set, primitives, wallpapers) | D-D1 |
| 18 | «لما ينزّلوا نسخة كروم كتطبيق تكون شبه التلي 100%، وبتحط وركسبيس» | `M1-mobile-app.md` (M1a the installed site, M1b the Android app; drawer with the spaces) | D-M1, D-N1 |
| 19 | «ضيف خانة شيك ليست» | C3c.1 (a checklist inside the chat that becomes a task with steps); the plan's own checklist in `README.md` and in the owner's summary | D-C4 |
| 20 | «فعّال 100%، أكفأ وأعمَلي ويناسب شغلنا» | `T1-team-work-analysis.md` (the work, the numbers, problem → fix), `Q1-…md`, `I1-integrations-and-fit.md` | — |
| 21 | «شوف تيليجرام تبعي، كل مجموعات الشغل» | one group was analysed from the export he sent (`T1`); the other groups were NOT read (the desktop app could not be opened from the planning session) | ⚠️ the other groups (production, management, cash boxes, expenses) are covered only from his screenshot: I1.2, I1.3 |
| 22 | «وموقع نظام الطلبات» | its repository was read and its product screen visited read-only: `T1` §4, Q1 §1, Q1.0, I1.1 | — |
| 23 | «ميزات استدعاء سريعة مثل مواصفات المنتج أو آراء العملاء» | Q1.1 (sheet), Q1.2 (feedback), Q1.3 («/» in the composer) | D-Q2, D-Q4 |
| 24 | «المشاكل تتحوّل لتيكيت بشكل تلقائي» | Q1.5 (rules, kinds, one ticket per order, chip, «✅ انحلّت», escalation) | D-Q1, D-Q8 |
| 25 | «تفهم طبيعة شغلي وتشوف شو الأنسب إلي» | `T1` §1–§3; Q1 §2 (a day by role); the order of phases puts Q1 right after the urgent fixes | — |
| 26 | «مواصفات المنتج: تفاعلي، أسئلة وأجوبة ومكونات، بدون عجقة» | Q1.1 (sections that open, searchable questions, length limits) | — |
| 27 | «التنبيه اختياري لأنو في منتجات ملابس» | Q1.1 «The caution is optional» (D-Q5, answered) | — |
| 28 | «عندي كاتوجري» | Q1.1 «Categories»: the orders system's 9 categories, a sheet template per category group (D-Q6, answered). Until that system's door sends the category, it is picked by hand on the sheet | D-Q2 |
| 29 | «صور المنتج وين» | Q1.2: photos on top of the sheet, added here by the editors; the orders system's own photos join by themselves once its door sends them | 33 of 44 products have no photo anywhere today |
| 30 | «الفيدباك: نسخ صورة أو تحميل، أو يجمعهم بصورة وينزّلها، أو صورة صورة» | Q1.2: copy, download, share, one by one, or merged into one picture — in the browser, and in the Android app through its three bridges (a new APK) | D-Q7 |
| 31 | «ارجع حلّل مشاكل الشغل بالتيليجرام وحل وابنِ الخطة» | `T1-team-work-analysis.md` §2–§3: 14 problems with numbers. Ten get a step here; three (duplicates, postponed orders, pasting an order) already have their tool in the orders system and get a button that opens it; the daily report gets five counts now and the rest after one ordered prompt | — |
| 32 | «آلية الاستخدام» | Q1 §2 (a day by role); in the sheet: «طريقة الاستعمال» (health and care), «طريقة التشغيل» (devices), «العناية والغسيل» (clothing) | D-Q10 |
| 33 | «آلية عمل المنتج» | Q1.1 «How a sheet works»; in the sheet: «كيف بيشتغل» (health, care and device templates; the owner can add it to any template) | D-Q10 |
| 34 | «المشاكل» | in the sheet: «لشو بينفع» and what it is not for (every template but clothing, which the owner can change); for order problems: Q1.5; for the team's work problems: `T1` §3 | D-Q10 |
| 35 | «زر نسخ للبيانات حتى زر نسخ للمكونات» | Q1.1 «Copy buttons everywhere» | — |
| 36 | «حلّل كل المحادثة… واعطيني الخطة النهائية» | this file; `README.md`; the owner's summary (Word + PDF, handed to him, outside git) | the decisions in `DECISIONS.md` |

## What the plan cannot promise

- **"100%"**: the plan was checked against the code, the live site and an independent review, and every request above
  has a step. It is still a plan: each step proves itself with a test that fails first, and the owner checks the live
  result at seven stops (README «Order»).
- **Telegram's name, logo, artwork and sounds** are not copied (`telegram-parity.md`): the layout and behaviour are.
- **Other systems** (the orders system, the media buyer) are never edited from this repository: the plan writes one
  ordered prompt per repository.
