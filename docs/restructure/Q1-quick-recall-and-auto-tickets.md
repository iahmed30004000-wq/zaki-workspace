# Q1 — Product sheets, quick recall, feedback pictures, automatic tickets, must-read

> **Order:** right after F0, on TODAY's chat screen (C2 restyles it later; C1 and C2 list what they must carry over).
> Why first: `T1-team-work-analysis.md` — it is what the team needs all day.
> **The owner's words (2026-11-16):** «ميزات استدعاء سريعة مثل مواصفات المنتج أو آراء العملاء، والمشاكل تتحول لتيكيت بشكل
> تلقائي» · «مواصفات المنتج شرح جامد؛ لازم يكون تفاعلي، أسئلة وأجوبة ومكونات، بس بدون عجقة» · «التنبيه اختياري لأنو في
> منتجات ملابس» · «عندي كاتوجري» · «صور المنتج وين؟ والفيدباك بدنا نسخ صورة أو تحميل، أو خيار يجمع صور الفيدباك بصورة
> وينزّلها، أو صورة صورة» · «آلية الاستخدام، آلية عمل المنتج، المشاكل، وزر نسخ للبيانات حتى زر نسخ للمكونات».
> Decisions: D-Q1 … D-Q12 in `DECISIONS.md` (D-Q5, D-Q6 and D-Q11 are already answered).
> Files marked NEW below do not exist yet; everything else was checked in the code.

## 1. Who owns which fact (checked live on 2026-11-16 and in the orders system's repository, read-only)

| Fact | Owner | State today |
|---|---|---|
| Product name and code, category, price, offers, stock word, shop page | the orders system (`zaki-ai-OSM`) | 44 active products in 9 categories (one is clothing); 26 have offers; 33 have no photo; 2 have no category; none has its category's questions answered |
| Duplicate and suspect-number flags on a new order; the list of postponed orders; a box that reads a pasted order text | the orders system — these EXIST there already | the team still does all three by hand in chat |
| Published text reviews (stars, text, first name, city) | the orders system; they never cross to this system (customer data) | — |
| Selling knowledge: what it is for, how it works, how to use it, ingredients / sizes, customer questions and answers, an optional caution, ready messages | **this system** (new: the product sheet) | exists only as chat messages (16 product cards posted in Telegram) |
| Selling photos and feedback PICTURES to send to customers | **this system** (the sheet's gallery); the orders system's own product photos are shown too when its door gives them | scattered on phones and in chats |
| An order's state, order events | the orders system | a status door and signed events exist there |

Rules: a price is NEVER typed, stored as truth or edited here — the orders system's own door says "the price lives here
and nowhere else"; this system keeps a snapshot for display and refreshes it. What the orders system already does
(duplicates, postponed orders, pasting an order) is USED through a button that opens it, never rebuilt here.

## 2. How it is used («آلية الاستخدام») — one day, by role

**Page moderator** (talks to customers on the pages): opens «المنتجات», types part of the name → the sheet. Taps
«انسخي رسالة العرض» and pastes it to the customer. The customer asks "does it burn?" → types «بيحرق» in the sheet's
questions → «انسخي الرد». The customer hesitates → «آراء الزباين» → picks three → «اعمليهم صورة وحدة» → «شاركيها»
(WhatsApp / Messenger). The customer's number is wrong → «مشكلة» on her own message → a ticket goes to the right person.

**Confirmation agent** (on the phone with the customer): same sheet for the price and the usage steps; an order number
in the chat is a chip that shows the order's state; a customer who wants delivery next week → the order is postponed
in the orders system (its own list), and a ticket «حجز موعد» reminds her to call that morning.

**Supervisor:** fills and approves sheets (or pastes an old Telegram card and lets the editor split it); answers
«اسألي مشرفتك» tickets — the approved answer is added to the sheet for everybody; sees her queue of tickets with what
is late; posts an instruction with «لازم ينقرأ» and sees who has not read it.

**Owner:** changes a price in the orders system → every sheet and offer message changes, one «تغيّر السعر» notice goes
out with «لازم ينقرأ»; sees which sheets are incomplete, which answers are copied most, which problems repeat.

## 3. Steps

### Q1.0 The link to the orders system — `feat/oms-link` (switch `omsLink`)

- [ ] 🔧 Owner action in the orders system: issue a system token for this system with the scopes `products.read`,
      `orders.read`, `orders.note`; paste it in «التكاملات». Stored encrypted (`Integration.secretEnc`,
      `src/server/crypto.ts`), never returned. ⚠️ Such a token lives 90 days. 🔧 The integration card shows the day it
      ends and warns 14 days before; the owner issues a new one.
- [x] Migration, alone in its own folder (AGENTS.md: a new enum value is a migration of its own):
      `ALTER TYPE "IntegrationType" ADD VALUE 'OMS';`. Non-secret settings in `Integration.config` (base URL, the person
      who connected it); the last sync in the existing `Integration.lastSyncAt`.
- [x] Client (NEW) `src/server/integrations/oms.ts`: `listProducts()` → `GET /api/v1/products`; `orderStatus(orderId)` →
      `GET /api/v1/orders/{id}` (the orders system's INTERNAL id); `addOrderNote(orderId, text)` →
      `POST /api/v1/orders/{id}/notes` with an `Idempotency-Key` header and the body `{ note }`. Bearer token, base URL
      checked by `src/server/net-guard.ts` (public https), 5 s timeout, no redirects; failures written as
      `IntegrationEvent` rows (FAILED) and shown as ⚠️ with 🔧 on the integration card. Never logs a response body.
- [x] The snapshot is kept OUTSIDE the versioned sheet: `Card.external JSONB NULL` (additive), written only by the sync,
      never through `saveCardEdit` — a refreshed price must not create a `CardRevision`. Shape:
      `{ id?, code, name, store?, category?, price, currency, offers: [{ title, quantity, freeQuantity?, price, expiresAt? }],
      stockStatus, deliveryIncluded?, link?, fetchedAt }`.
- [x] Sync job in `src/server/jobs/` (the in-app runner, every 5 minutes, idempotent): reads the products; writes
      `Card.external` of each linked sheet; creates a DRAFT sheet for a product that has none; marks a sheet whose product
      disappeared as «مش موجود بنظام الطلبات» (never deletes). A row made by a job is authored by the person who connected
      the integration (if no longer ACTIVE: the primary owner).
- [ ] Linking a sheet to a product: by the product's `id` once the door gives it; until then by `code` + name. ⚠️ The
      code is unique per STORE only. 🔧 When two products share a code the sync links nothing by itself and lists both
      for the editor to choose.
- [ ] **A stale price is never sent:** every price chip shows «آخر تحديث قبل …» once the snapshot is older than 30
      minutes; «انسخي رسالة العرض», `/منتج` and the price part of «انسخي الكل» then show «⚠️ السعر مش محدّث» with 🔧
      «حدّثي هلّق» (runs the sync now) instead of copying.
- [ ] **The price notice:** when the price or the offers of an APPROVED sheet differ from the previous snapshot (never
      on the first sync of a product), ONE notice goes to the knowledge space's announcements topic, with «لازم ينقرأ»
      (Q1.6). It is a CARD that points at the sheet (Q1.3): no price is written into a message.
- [x] ONE ordered prompt for the orders system's repository (written in the PR, never executed from here):
      (1) a token preset «زاكي ووركسبيس» with the three scopes; (2) optional `?fields=` additions to `GET /api/v1/products`,
      in that door's own additive style: `id`, `store`, `category` (name), `images` (public URLs, the main one first),
      `free_quantity` and `delivery_included` on each offer, `link` (the product's shop page) — and NOT reviews (first
      names and cities are customer data); (3) reading an order by its NUMBER (`GET /api/v1/orders?number=`): the same
      four fields plus `order_id`, the product name and the quantity, still no customer data; (4) publishing
      `contracts/oms-workspace.v1/` (schema + example) whose source is that repository; it is copied here verbatim and
      never edited here.
- [ ] Until (2) lands: the category of a sheet is picked by hand from the company's category list; the price of one
      piece inside an offer is shown only when the gift units are known; the delivery line («توصيل مجاني · دفع عند
      الاستلام») is one sentence the owner sets in the knowledge settings.
- [x] Tests: contract test against the copied example; the token never in a response, a log or an error; the sync is
      idempotent and creates no revision; two products with one code are not linked; an unreachable orders system leaves
      the last snapshot and a visible ⚠️; a stale snapshot refuses to build an offer message.

### Q1.1 The product sheet — `feat/product-sheets` (switch `knowledgeCards`)

**How a sheet works («آلية عمل الكرت»):** ONE screen per product. The top is read from the orders system (name, category,
price chips, stock word); the rest is the team's knowledge, laid out by the product's CATEGORY; every part has a copy
button; nothing is a wall of text.

```
┌───────────────────────────────────────────────────────────┐
│ [ photo ‹ › ]  thumbnails            [انسخي الصورة] [نزّليها] [شاركيها] │  Q1.2
│ حراك  [العناية بالبشرة والجسم] [متوفر] [تيست]                           │  name · category · stock word · badges
│ زيت مساج دافي بالكركم والزنجبيل                                         │  ONE line (≤ 120)
│ [عبوة 20$] [عبوتين + هدية 40$ · العبوة 13.3$] [توصيل مجاني]              │  from the orders system, never typed
│ [انسخي رسالة العرض]  [انسخي الكل ▾]  [ابعتيه بالمحادثة]                  │
│ (تنبيه للفريق — optional, only when somebody added one)                 │
│ ▾ أسئلة الزباين   [ابحثي…]                      each answer [انسخي]     │  open
│ ▸ لشو بينفع                                     [انسخي]                │  ┐ the sections of this
│ ▸ كيف بيشتغل                                    [انسخي]                │  │ product's CATEGORY
│ ▸ طريقة الاستعمال                               [انسخي]                │  │ (clothing shows sizes,
│ ▸ المكونات                                      [انسخي]                │  ┘ fabric, colours, washing)
│ ▸ آراء الزباين (6)                                                     │  Q1.2
└───────────────────────────────────────────────────────────┘
```

**Categories** (D-Q6, answered: «عندي كاتوجري»). The category NAME comes from the orders system (today: أجهزة العناية
والليزر · أجهزة منزلية وتدفئة · إلكترونيات · الصحة والعلاجات · العناية بالبشرة والجسم · العناية بالشعر · صحة وأعشاب · مستلزمات
منزلية · ملابس). What a category's sheet contains is a TEMPLATE kept here (`Organization.settings.productTemplates`,
keyed by category name; defaults in NEW `src/lib/cards/product-templates.ts`, editable by the owner in the knowledge
settings):

| Template | Sections (title · kind) | Unit word |
|---|---|---|
| health and care (الصحة والعلاجات، العناية بالبشرة والجسم، العناية بالشعر، صحة وأعشاب) | «لشو بينفع» chips · «كيف بيشتغل» text · «طريقة الاستعمال» steps · «المكونات» chips | عبوة |
| clothing (ملابس) | «المقاسات» chips · «الخامة» text · «الألوان» chips · «العناية والغسيل» steps | قطعة |
| devices (أجهزة العناية والليزر، أجهزة منزلية وتدفئة، إلكترونيات) | «لشو بينفع» chips · «كيف بيشتغل» text · «طريقة التشغيل» steps · «المواصفات» chips · «الكفالة» text | قطعة |
| anything else / no category | «لشو بينفع» chips · «طريقة الاستعمال» steps · «المواصفات» chips | قطعة |

«لشو بينفع» is the owner's «المشاكل» (the problems the product is for — and, as a second line, what it is NOT for;
D-Q10); «كيف بيشتغل» is «آلية عمل المنتج»; «طريقة الاستعمال» / «طريقة التشغيل» is «آلية الاستخدام». A template has at most
8 sections; the owner renames, adds or removes them.

**The caution is optional** (D-Q5, answered: clothing has none). No category adds one by itself. In the editor «أضيفي
تنبيه للفريق» offers a suggested sentence for health templates; a sheet without one shows nothing. It is a note for the
TEAM (what not to promise): it is never part of any text copied for a customer.

**Copy buttons everywhere** (D-Q11, answered: «زر نسخ للبيانات حتى زر نسخ للمكونات»):
- every section (chips copy as one line joined with «، », steps as numbered lines, with the section title first);
- every answer of «أسئلة الزباين»;
- «انسخي رسالة العرض»: built from a template (per category, editable: `{الاسم}` `{الوصف}` `{سعر_الواحدة}` `{العروض}`
  `{سعر_القطعة_بالعرض}` `{التوصيل}`) and the LIVE prices; with no price in the orders system the button is replaced by
  «⚠️ ما في سعر بنظام الطلبات» + 🔧 «عبّيه هناك»;
- «انسخي الكل ▾»: tick which parts (description, what it is for, how it works, usage, ingredients, price and offer); the
  choice is remembered per person;
- «انسخي رابط المنتج» when the orders system gives the shop link;
- NEW `src/lib/cards/copy-text.ts` builds every copied text (pure: plain text, no markup, Western digits, right-to-left
  safe; unit tests); the copy itself uses the EXISTING `copyText()` of `src/lib/cards/clipboard.ts` (clipboard API with
  its field fallback); a small «انتسخ ✓» confirms; each copy is counted in the card log so the owner sees what is used
  most.

**Questions and answers:** search with the Arabic folding of `src/lib/search/arabic.ts`; no match → «ما في سؤال متل هاد —
اسألي مشرفتك» opens a ticket to the supervisor (Q1.5); the approved answer is added to the sheet.

**No clutter («بدون عجقة»):** the one line ≤ 120 characters, a step ≤ 80, a text section ≤ 400, an answer ≤ 300, chips ≤
20 of ≤ 60 each; the editor counts and refuses longer text with «قصّريه — الزبون بدو جملة». Only «أسئلة الزباين» is open by
default; the rest opens on tap.

**Who sees the selling price** (D-Q12): every STAFF member who may read the sheet — it is the price she quotes to the
customer all day, and it is public on the shop. NOT the capability `prices.view` (the MEMBER rank does not hold it; it
keeps guarding customers' deal values). An external partner (guest) never: the price is cut on the server for a guest
and in every conversation that has one.

Data (extend `Card`; no new table):
- [ ] `CARD_KINDS` (`src/lib/cards/shared.ts`) gains `PRODUCT` and `REPLY` (a general approved answer, e.g. delivery and
      payment). `Card.category` (exists) holds the category name. `Card.data` for PRODUCT, validated in NEW
      `src/lib/cards/knowledge.ts` (and `cleanCardData`): `{ tagline, badges: ("test"|"new")[], sections: [{ key, title,
      kind: "text"|"steps"|"chips", text?, items? }] (≤ 8), faq: [{ q, a, keywords? }] (≤ 30), caution?: { text (≤ 200) },
      testNote? (≤ 120), offerMessageTemplate? (≤ 600) }`. The orders system's facts are in `Card.external` (Q1.0).
- [ ] `Card.approvedVersion INT NULL` (additive): a reader who is not an editor always gets the last APPROVED knowledge
      (the card itself when `version == approvedVersion`, else that `CardRevision`) together with the LIVE
      `Card.external`; an edit by somebody who may approve stays approved, by another editor waits in REVIEW while the
      old version keeps being served (existing status flow, `src/server/services/card-status.ts`). A sheet never
      approved is invisible to non-editors.
- [ ] Where sheets live: ONE knowledge space per company (`Organization.settings.knowledgeSpaceId`), an ordinary
      (STANDARD-layout) space so it has topics for the notices. PRODUCT and REPLY cards are listed at «المنتجات» and are
      left out of the space's ordinary cards lists.
- [ ] Who writes: today any staff member of a space writes its cards (`assertWrite` in `src/server/services/cards.ts`).
      For PRODUCT and REPLY the service adds its own rule: the space's managers and the people named as editors
      (`Organization.settings.knowledgeEditorIds`) write; who approves is D-Q4. Agents are members of the space and read.
      Guests never (the space rule is unchanged).
- [ ] «المنتجات»: a page `/knowledge` (grid by category, search, chips «نفد» «تيست», and for editors «ناقص معلومات») and the
      sheet `/knowledge/[cardId]`; opened as a sheet over the conversation (`src/components/ui/sheet.tsx`) from a chat
      card. Nav: a third tab «المنتجات» in the library place of `src/lib/nav/places.ts` (staff only, feature
      `knowledgeCards`; update `tests/nav-places.test.ts` and `tests/db/guest-internal-pages.test.ts`); N1 keeps it.
- [ ] Editors see what each sheet lacks («ناقص: صورة · لشو بينفع · أسئلة») and a list «كروت ناقصة» (live today: 33 products
      without a photo, none with knowledge). «الصقي كرت قديم»: paste an old Telegram product card and the editor splits it
      into the fields by its markers (a pure parser with unit tests) — the 16 existing cards move in minutes.
- [ ] Tests: zod limits; a sheet with no caution renders none; a guest gets no price and a MEMBER does; a non-editor
      cannot write a PRODUCT card and never reads an unapproved one; approved-version serving with the live snapshot; the
      copy-text builder; the old-card parser.

### Q1.2 Photos and feedback pictures — `feat/product-media` (switch `knowledgeCards`)

- [ ] Storage: a card's gallery today LINKS library files of its space (`src/server/services/card-attachments.ts`), and
      the library lists them to everybody holding the files box. Product media must not be listed there: they are
      uploaded through the sheet's own route with `ingest` (Drive first) and `StoredFile.purpose = "KNOWLEDGE"` (a text
      column; the library lists only `LIBRARY`). `assertMayReadFile` (`src/server/services/files.ts`) learns the rule: a
      KNOWLEDGE file is read by whoever may read its sheet — and a FEEDBACK item only once approved with consent
      (editors always). Bytes are served by the existing `/api/files/[id]/raw`, with a download header on request.
- [ ] Additive: `CardAttachment.role TEXT NOT NULL DEFAULT 'GALLERY'` (GALLERY | FEEDBACK) and `CardAttachment.meta JSONB
      NULL` (`{ kind: "image"|"video"|"voice", consent, covered, approvedById?, approvedAt?, source? }`). The existing cap
      of 30 attachments per card (`LIMITS.attachments`) stays for GALLERY; FEEDBACK has its own cap of 60.
- [ ] **Product photos:** on top of the sheet, swipeable, the cover first. The orders system's photos (when its door
      gives them): each address through `net-guard`, images only, bytes sniffed, at most 5 MB each, stored as KNOWLEDGE
      files tagged with their source — so every picture is served from this system's own address.
- [ ] **On any picture:** «انسخي الصورة» (Clipboard API, PNG; when the browser cannot, it downloads instead and says so),
      «نزّليها», «شاركيها» (the phone's share sheet with the file), «ابعتيها بالمحادثة».
- [ ] **Feedback («آراء الزباين»):** a gallery of approved items. Tap to select several, then:
      «نزّلي صورة صورة» (each file; on a phone the share sheet with all the files at once), or
      «اعمليهم صورة وحدة» → a preview → «نزّلي» · «انسخي» · «شاركي» · «ابعتيها بالمحادثة».
- [ ] **One picture from many** — built in the browser, nothing uploaded: 2 to 9 pictures; NEVER cropped (a screenshot
      must stay readable): 2 columns for 2–4 pictures, 3 for 5–9, each picture scaled to the column width and placed in
      the shortest column; white background, 12 px gaps; an optional caption line (product name); JPEG 0.9, 1080 px wide
      (1440 px with 3 columns); a result taller than 4096 px is split into two pictures; file name «آراء-<اسم المنتج>».
      The layout is a pure function (NEW `src/lib/cards/collage-layout.ts`) with unit tests. Video and voice feedback are
      downloaded or shared one by one, never merged.
- [ ] **Adding a feedback item** (editors): choose the picture → a cover tool IN THE BROWSER (drag rectangles over the
      name, the number and the profile picture; the rectangles are painted into the picture before anything is sent) →
      only the covered picture is uploaded; the original never leaves the phone → tick «الزبون موافق ننشرها» → an
      approver approves. Without consent and approval the item is never offered for copying, sharing or merging.
      ⚠️ A feedback screenshot is somebody's private chat (the orders system keeps its own proof pictures private for
      this reason). 🔧 Cover + consent + approval before it can be sent to anybody (D-Q7).
- [ ] **Sending a picture into a chat** makes a COPY as a chat attachment (a chat's files belong to their conversation:
      a purge removes them, and the attachment service refuses a file that is not a chat upload of the sender).
- [ ] **The Android app** (`android/`, the sheet opens in its web view, which cannot copy a picture, download or share a
      file by itself): three bridges in `WebHost.kt` — `ZakiNative.copyText(text)`, `ZakiNative.saveImage(dataOrUrl,
      name)`, `ZakiNative.shareImages(dataOrUrls[], text?)` (a picture built in the browser is passed as data; a stored
      one by its address on this site, fetched with the session) — each refuses unless the page shown is this site's
      own, caps the size (10 MB a file), and cleans the file name; plus a download listener. The web code calls them
      when present. Ships as a new APK: P0.6 must be done first. (M1b later restyles the app; it keeps these.)
- [ ] Tests: the layout function (counts, columns, split); a KNOWLEDGE file is not in the library list; an item without
      consent or approval is never returned to an agent; a download answers the right header; guests get nothing.

### Q1.3 «/» in the composer — `feat/quick-recall` (switch `quickRecall`)

- [ ] Typing `/` at the start of today's composer (`src/components/chat/composer/chat-composer.tsx`) opens a menu,
      keyboard-first; on the phone a «⚡» button opens it as a sheet: «/منتج» · «/آراء» · «/رد» · «/طلب» · «/مشكلة» ·
      «/مشرفتي» · «/إعلان» (each only when its switch is on and the person may use it).
- [ ] `/منتج حراك` → live results → «ابعت» posts a CARD message; «افتح الكرت» on it opens the sheet (people outside the
      knowledge space see the card only).
- [ ] **The CARD message** (additive; I1.1 reuses it): `ChatMessage.kind = "CARD"`, `ChatMessage.card JSONB NULL`,
      `ChatMessage.viaApp TEXT NULL`. For a product it stores ONLY `{ type: "product", cardId }`; `body` is a readable
      line WITHOUT a price («كرت منتج: حراك») — the old native Android chat prints an unknown kind as its body. Name,
      photo, the one line and the price chips are resolved for each VIEWER when the message is read (a guest never gets a
      price; a forward is resolved again for its new readers). Rendered in
      `src/components/chat/message/message-item.tsx` today.
- [ ] `/آراء حراك` → the feedback gallery → pick → sent as pictures (copies, Q1.2).
- [ ] `/رد` → search approved answers (sheet questions and REPLY cards) → INSERTS the text in the composer, editable;
      never sends by itself.
- [ ] API: `GET /api/chat/recall?q=&kind=&conversationId=` and `POST /api/chat/conversations/[id]/recall`. Service: a NEW
      function `recallToConversation` beside `sendCard` in `src/server/services/cards.ts`; it checks: may post in the
      conversation, may read the sheet, the sheet is approved. `sendCard` itself (words only, into a topic of the card's
      own space — pinned by `tests/db/cards.test.ts`) is NOT changed. Recent and frequent picks first.
- [ ] Tests (`tests/db/`): recall refused where the person may not post or may not read the sheet; the stored message
      holds no price; a guest reading the conversation gets none; an unapproved sheet cannot be sent.

### Q1.4 An order's state — `feat/order-status` (switch `orderStatus`)

- [ ] An order number is recognised with the orders system's own shape, copied as a constant with its source named:
      `^[A-Z0-9]{2,10}-[0-9]{4}-[0-9]{4,8}$` (its `src/lib/order-ref.ts`).
- [ ] `/طلب <رقم>` posts a small status card (confirmation state, shipping state, when it last moved; product and
      quantity when the orders system gives them) with «افتح بنظام الطلبات». No customer data exists in that answer.
- [ ] An order number typed in any message becomes a chip; tapping it shows the same card to people who may read the
      conversation.
- [ ] A small cache, NEW table `OmsOrderState` (`orgId`, `orderId`, `orderNumber` unique per org, the two states,
      `productName?`, `quantity?`, `updatedAt`): written by a lookup (kept 60 seconds fresh) and later by the events of
      I1.1; it also gives Q1.5 the internal id a note needs. No existing table holds another system's order state.
- [ ] Reading by NUMBER needs item (3) of the ordered prompt; until then a chip says «حالة الطلب بتتفعّل بعد تحديث نظام
      الطلبات».
- [ ] States are shown through an Arabic map in `src/lib/i18n/ar.quick-recall.json`; an unknown state shows «حالة غير
      معروفة», never a raw word.
- [ ] Tests: the pattern (accepts the two known shapes, refuses a phone number); the cache never stores a field the
      door does not send; a person who cannot read the conversation gets nothing.

### Q1.5 Problems become tickets — `feat/auto-tickets` (switch `autoTickets`)

What the week's messages show (`T1-team-work-analysis.md`): problems are written in the catch-all topics, pinged by @,
and 18 of 33 questions had no reply attached. So the ticket is made where the message is.

- [ ] **Kinds** (`Organization.settings.ticketKinds`, editable; defaults from the real week): رقم غلط أو ما في واتساب ·
      مكرر · ملغي وبدو يرجع يطلب · تأجيل أو حجز موعد · مرتجع · شو وضع الطلب · تعديل طلب · الزبون ما بيرد · مشكلة شحن ·
      مشكلة بالموقع · سؤال عن منتج · غير ذلك. Each kind: default department or person, hours before a reminder, «بدها
      يوم متابعة» (حجز), «بدها تسجيل شاشة» (الموقع).
- [ ] **Rules for the space** (space settings; `Organization.settings.autoTicketRules`): by TOPIC (every new human
      message of topic X); by CONTENT anywhere in the space (an order number AND a problem word from an editable list);
      by HAND («🎫 مشكلة» in the message menu, `/مشكلة`; today's «اعمل تذكرة» keeps working). Mode «اقترح» (a chip «بدك
      تعمليها تذكرة؟», one tap) or «تلقائي»; default «اقترح» for content rules, «تلقائي» for topic rules (D-Q1).
- [ ] **Who gets it, and through which existing door:** exactly one person @-mentioned in the message → an «تذكرة
      فورية» handed to that person (`createInstantTicket`); else the kind's department (`createTicket(ctx, departmentId,
      …)`); else the rule's supervisor (instant). From a message it goes through `messageToTicket`
      (`src/server/chat/make-work.ts`, which sets `sourceMessageId`), extended to take the kind and an instant target.
      The creator is the message's author, in both modes. «/مشرفتي» and «اسألي مشرفتك» → the asker's supervisor
      (`OrganizationMember.managerId`); an empty supervisor field means the owner in this system, and the house rule is
      "never to management", so with none it goes to the space's manager.
- [ ] Additive columns on `Ticket`: `externalRef TEXT NULL` (the order number), `kindKey TEXT NULL`, `followUpAt
      TIMESTAMP(3) NULL`, `customerRefCipher TEXT NULL`, `customerRefHash TEXT NULL`; indexes `("orgId","externalRef")`
      and `("orgId","customerRefHash")`.
- [ ] **One problem, one ticket:** a new message with the order number (or the same customer number) of an OPEN ticket
      becomes a comment on it (`TicketComment`), and the chip says so.
- [ ] **A customer's number** (61 messages of the week carried one): the ticket form asks for the order number first,
      then offers «ما في رقم طلب؟ رقم الزبون». Found with the EXISTING phone pattern of `src/server/ai/redact.ts`
      (exported, not re-written), after order numbers are taken out. Normalised (digits only, the country code folded to
      a leading zero), stored encrypted (`src/server/crypto.ts`) with a keyed hash for matching; read only by the
      ticket's own readers (as `src/server/services/tickets.ts` decides today: creator, assignee, the department's
      people, admins); masked everywhere else (09••••••12) — in the ticket's title and text, in notifications and in
      pushes, through ONE helper; wiped 30 days after `resolvedAt` by a job (D-Q8 sets the days). The chat message
      itself stays as typed unless Q1.7's hint is used.
- [ ] **Back in the chat:** a live chip under the message «🎫 T-45 · مفتوحة · مع فلانة» (a new realtime kind
      `ticket.changed`, added to `REALTIME_KINDS`); on RESOLVED the system replies to the original message «✅ انحلّت: <ملاحظة
      الحل>». With `orders.note` and a known order id (Q1.4), the same two lines are written as a note on the order.
- [ ] **What the orders system already does is opened, not rebuilt:** a «مكرر» or «رقم غلط» ticket and a «حجز موعد» ticket
      carry «افتح بنظام الطلبات» (its duplicate and suspect-number flags, its postponed-orders list). `followUpAt` is "remind
      ME that morning" (listed under «مواعيد اليوم»); the day the customer receives the order is set in the orders
      system only.
- [ ] **The house rules as doors:** «اسألي مشرفتك» (above); «مشكلة بالموقع» asks for the screen recording before it can be
      sent; «طلب إذن» is an approval form template of the existing approvals module (`FormTemplate`, switch `approvals`),
      answered by the supervisor.
- [ ] **Waiting:** the kind's hours pass (counted inside the company's working hours — a setting, default 09:00–18:00 in
      the organization's time zone, Saturday to Thursday) → a reminder to the assignee, then to the department lead or
      the assignee's manager, skipping anybody not ACTIVE (PHASE0-AUDIT R13). Who edits rules, kinds and hours: the
      capability `escalation.configure` (checked nowhere today — wire it here and update PHASE0-AUDIT R12).
- [ ] **Privacy:** content rules run on OPEN topics only; in a private topic or a DM only by hand, with P0.3's warning.
- [ ] Lists: the department desk (`/tickets`) today; «الطلبات» (W1.4) and the Today card when they exist.
- [ ] Tests (`tests/db/`): each rule and mode; instant ticket from one mention; one ticket per order and per customer
      number; the number is never returned outside the ticket's readers, never in a push, and is wiped by the job; the
      chip and the «✅» reply; no automatic ticket from a private topic; escalation skips a suspended manager.

### Q1.6 «لازم ينقرأ» — `feat/must-read` (switch `mustRead`)

The week had 26 instruction posts; 5 were acknowledged, by one person each (D-Q9).

- [ ] Additive: `ChatMessage.ackRequired BOOLEAN NOT NULL DEFAULT false` and `ChatMessage.ackMeta JSONB NULL` (who was
      reminded and when — a reaction row has no time of its own). Who may set it: topic moderators and holders of
      `announce.send` (checked nowhere today — wire it here, PHASE0-AUDIT R12).
- [ ] Each person the topic reaches (staff, not the author, not a silent oversight reader) sees «قرأت ✓» under the
      message; tapping writes a ✅ reaction (the existing `ChatReaction` table — no new table). The author and the
      moderators see «قرأ 7 من 10» and the list of who has not.
- [ ] A job reminds the people who have not, after 3 working hours and again the next working morning (the working
      hours of Q1.5); the list of late readers goes to the author once a day.
- [ ] The «تغيّر السعر» notice (Q1.0) and a message sent with «/إعلان» use it.
- [ ] Tests: who counts; a guest and an oversight reader never count; each reminder once; removing the reaction
      un-reads.

### Q1.7 Customer data out of the open chat — `feat/customer-data-hints` (switch `orderTemplateHint`)

- [ ] A message shaped like the hand-typed order template (name, number, province, address… — 18 in the week) gets,
      for its author and the moderators, «⚠️ هاي بيانات زبون — مكانها نظام الطلبات» with 🔧 «افتحي إدخال الطلب» (opens the
      orders system's own "paste the order text" box, which exists; nothing is copied by the program and no customer
      data goes into an address) and, for moderators, «خبّيها من الموضوع».
- [ ] A message with a phone-shaped number outside a ticket gets «🔧 حطّيها بتذكرة — بتنحفظ محمية» (one tap moves it into a
      ticket of Q1.5 and, with the author's consent, edits the message to show a masked number). The edit goes through
      the ordinary edit path: ⚠️ the original text stays in the owner's archive (`MessageRevision`), as for every edit —
      🔧 the hint says so («بيضل بأرشيف المالك»); removing numbers from the archive is a separate decision of the owner,
      never done by this step.
- [ ] ⚠️ Three company switches send the text of messages to a model after masking numbers, e-mails and links — but a
      customer's NAME has no shape a program can find: «@المساعد» (`chatAssistant`), «ترجم» (`messageTranslate`) and
      «بحث بالمعنى» (`semanticSearch`); all three are off by default. 🔧 While automatic tickets are on, the «الميزات»
      screen shows this warning beside each of the three, with the fix: keep it off, or point it at the owner's own
      machine (`docs/LOCAL-MODEL.md`).
- [ ] Nothing is blocked: the hints teach the path.
- [ ] Tests: the template and the phone detector (true and false cases, an order number is not a phone); the hint is
      shown to the author and moderators only; the masked edit leaves one revision.

### Q1.8 Product answers from the assistant (optional, D-Q3; switch `productAssistant`, OFF)

The chat assistant exists («@المساعد», switch `chatAssistant`, `src/server/services/chat-assistant.ts`). This step adds
ONE mode to it, not a second assistant: when the question is about a product, it answers ONLY from approved sheets and
names the sheet; the question passes the existing redaction first; it never invents a price or a claim; with no sheet
it says so.

## 4. Switches, strings, acceptance

Switches: `omsLink`, `knowledgeCards`, `quickRecall`, `orderStatus`, `autoTickets`, `mustRead`, `orderTemplateHint`,
`productAssistant` (OFF). Strings: `src/lib/i18n/ar.quick-recall.json` (Western digits; Latin only what the allow-lists
of `tests/arabic-ui.test.ts` already hold). In the examples of this file, an order number, a ticket key, a size letter
and a price with its currency sign are VALUES printed at run time (through `src/lib/format.ts` where it is a number or
money) — never words of a dictionary string.

- [ ] Typing three letters of a product shows its sheet in under a second; every part copies with one tap; a clothing
      sheet shows sizes and no caution; a health sheet shows a caution only if somebody added one.
- [ ] A price changed in the orders system shows on the sheet and in the offer message within 5 minutes, with one
      must-read notice; a stale price cannot be copied or sent.
- [ ] Six feedback pictures merge into one readable picture without cropping, downloadable, copyable and shareable on
      a phone (browser and Android app); an item without consent and approval is never offered; nothing of it is in the
      file library.
- [ ] A message with an order number and «مرتجع» makes exactly one ticket for the mentioned person; a second message
      joins it; resolving posts «✅ انحلّت» under the first message; a late ticket escalates once to an ACTIVE person.
- [ ] A customer's number in a ticket is unreadable outside its readers, absent from every push, and gone 30 days after
      it was resolved.
- [ ] Privacy matrix rows added (recall from a space I am not in → nothing; a sheet's price for a guest → absent; a
      feedback picture without consent → absent; an automatic ticket from a private topic → never).
