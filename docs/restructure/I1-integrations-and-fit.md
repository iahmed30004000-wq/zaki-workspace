# I1 — Fit to how the team really works: bots, spaces like the Telegram groups, money in the right place

> Prerequisites: Q1.0 and Q1.3 (the link to the orders system and the CARD message). I1.1(a) can run right after Q1 on
> today's screen; I1.3 needs W1.4. The owner (2026-11-16): «بدي إياه فعّال 100٪، أكفأ وأعمَلي
> ويناسب شغلنا». The team works today in Telegram forum groups (seen on the owner's screenshot; names kept out of
> this public file): an operations group where an order bot posts each order number into an "unconfirmed" topic; a
> video-production group (links, downloads, general); one group per product line (coordination); a management group
> (reports and performance, ideas, an AI report bot); a cash-boxes group (one topic per country); an office-expenses
> group. The orders system is a separate product (`iahmed30004000-wq/zaki-ai-OSM`: orders,
> confirmation, customers, inventory, manufacturing, finance, products, campaigns) and the media buyer another
> (`zaki-mediabuyer`, already sending tasks through the Workspace door).
>
> Rules that bind this phase (AGENTS.md): no customer data crosses a contract (opaque ids + links only); no financial
> approval from Telegram; a Telegram bot has one job; each system changes only in its own repo (this phase writes the
> Workspace side and ONE ordered prompt per other repo — never edits them from here).

## I1.1 Bot cards in topics (the replacement for the Telegram bots)

Two ways in. **(a)** uses what the orders system already sends; **(b)** is for every other sender.

**(a) Receive the orders system's own events** — `feat/oms-events` (switch `omsEvents`):
- [ ] The contract `oms-app-events.v1` (schema, one example per event, a signed-delivery example) has its source in the
      replies system's repository (`MKory18/AIresponse`); copy it verbatim into `docs/contracts/oms-app-events.v1/` —
      never edited here. Fields: order id and number, the two states and the previous one, tracking number, total,
      currency, and (on some events only) product id and name, quantity, items, pieces, source, store, city.
- [ ] **What the events really cover** (read in the orders system's code): `order.confirmed`, `order.shipped`,
      `order.delivered`, `order.returned` and `order.cancelled` fire for every order; `order.created` fires ONLY for an
      order placed on the shop itself (not for one entered by staff); most events carry no product and no quantity.
- [ ] Receiver `POST /api/integrations/oms/events/[receiverId]` — the opaque id in the address names the company (a
      delivery carries no tenant of its own). It verifies with the EXISTING `verifyZakiSignature`
      (`src/server/webhook-signing.ts`: HMAC over `timestamp.body` with the raw body, constant time, 5-minute window,
      seconds or milliseconds); a delivery with no signature is REFUSED (that system signs only when a secret is set);
      the body is capped at 64 KiB and the raw body is never stored. `total`, `currency` and `city` are DROPPED at the
      door; what is kept: the order's id and number, the states, the product name and the quantity when present
      (into `OmsOrderState`, Q1.4).
- [ ] Each delivery once: NEW table `InboundDelivery` (`orgId`, `source`, `deliveryId`, `receivedAt`; unique on the
      three) keyed by `X-Zaki-Delivery`. `IdempotencyRecord` cannot hold it (its `tokenId` is required and points at an
      API token). The same table closes PHASE0-AUDIT R2 for the n8n inbound webhook — update that row.
- [ ] 🔧 Owner action: add this system as a receiver in the orders system («التطبيقات»). That system creates the secret
      and shows it ONCE: paste it here (stored encrypted beside the token of Q1.0). If its screen cannot add a custom
      receiver, that is one ordered prompt for its repository.
- [ ] Rules per space (which event → which topic): a CARD in the topic («تأكّد طلب», «مرتجع», «انلغى» — with the order
      number as a chip of Q1.4) and «افتح بنظام الطلبات»; `order.returned` and `order.cancelled` may open a ticket: this
      step adds a fourth rule kind to Q1.5's `autoTicketRules` — by EVENT (event name → ticket kind, department or
      person), the ticket created by the person who connected the integration; every event refreshes `OmsOrderState`.
- [ ] **Daily numbers card** — replaces the report bot that failed on a sign-in screen: at an hour the owner sets, one
      card in the reports topic counted from the received events: confirmed, cancelled, shipped, delivered, returned.
      No money, no customer data. ⚠️ "New orders" and "per product" cannot be counted from today's events (see above).
      🔧 One ordered prompt for the orders system: events for every way an order is entered, with the product name and
      the quantity (a change of the contract at its source), or a small daily-counts door. Until then the card shows
      the five counts and says what is missing.
- [ ] Tests: the copied signed example verifies; an unsigned delivery, a wrong signature, an old timestamp, a replayed
      delivery and an oversized body are refused; `total` and `city` never reach the database (DB test reads the rows).

**(b) A door for other senders** (the media buyer, n8n, the owner's own AI manager) — `feat/door-messages` (switch
`doorMessages`):
- [ ] `docs/contracts/workspace-door.v1.md` is FROZEN and lists exactly what v1 may do: it is not touched. A NEW
      contract `docs/contracts/workspace-door.v2.md` adds ONE endpoint, `POST /api/v2/messages`, with v1's own
      conventions: a Bearer token of one organization bound to one space, the `Idempotency-Key` header (the existing
      `IdempotencyRecord`), v1's error envelope and codes (customer data → `door.customer_data_rejected`), off until
      the owner turns the switch on. A new token permission `messages.write` joins `DOOR_PERMISSIONS`
      (`src/server/door/tokens.ts`). Body: `{ topicKey, card: { title ≤ 120, lines: [{ label, value }] ≤ 8, status?:
      "info"|"ok"|"warn"|"danger", ref?: an order number in the shape of Q1.4, buttons: [{ label ≤ 24, url (https,
      hosts allow-listed per token) }] ≤ 3 }, mustRead?: boolean }`.
- [ ] It posts the CARD message added by Q1.3 (reused, not re-made). The author is the token's person (revoking the
      person revokes the token); the bubble says «عبر <اسم المفتاح>» (`viaApp`), like Telegram's «via @bot».
- [ ] Server-side guard: every card text except `ref` is checked with the EXISTING phone pattern of
      `src/server/ai/redact.ts` and refused with `door.customer_data_rejected`.
- [ ] `topicKey`: a new nullable `Conversation.doorKey TEXT` with its unique index `(spaceId, doorKey)` created IN THE
      SAME migration as the column (born NULL, so the migration linter's review tier accepts it).
- [ ] Rate limit per token (120 a minute) and a daily cap; failures visible in «التكاملات» (`IntegrationEvent` rows).
- [ ] Tests: permission, idempotency, tenant isolation, the customer-data guard, v1 answers unchanged.

**Ordered prompts for the other repositories (written into the PR, never executed here):**
1. Orders system (`zaki-ai-OSM`): the daily-numbers item above; adding a custom receiver if its screen cannot.
2. Media buyer (`zaki-mediabuyer`): a daily spend summary card into the management space's reports topic (no ad
   tokens, no customer data), beside its existing task door.
3. n8n and the owner's AI manager: any Telegram-bot post that is not customer data moves to `POST /api/v2/messages`
   (an instruction can be sent with `mustRead`, Q1.6).

## I1.2 Space templates that mirror the Telegram groups — `feat/space-templates`

- [ ] «مساحة جديدة» offers templates (pure data `src/lib/spaces/templates.ts`, applied by the existing create service +
      `space-topics.ts`): «عمليات الطلبات» (topics: غير مؤكد · مؤكد · مرتجع · شكاوى · عام), «إنتاج المحتوى» (روابط ·
      تحميل · سكربتات · عام + a project «خط الإنتاج» with stages فكرة → سكربت → تصوير → مونتاج → جاهز → منشور),
      «الإدارة» (تقارير وأداء · أفكار · قرارات · إعلانات), «منتج / براند» (تنسيق · إعلانات · محتوى · مشاكل), «فاضية».
- [ ] A one-page guide «من تيليجرام لزاكي» in the guide: which Telegram group becomes which space, who joins, which bot
      becomes which card.

## I1.3 Money stays in the app, never in chat — `feat/expense-requests`

- [ ] Office expenses and the cash boxes are money: no approval by a chat message (AGENTS.md). Provide approval FORM templates
      (existing `FormTemplate` + `ApprovalRequest`, which already carry an amount): «طلب مصروف» (amount, currency,
      reason, receipt photo, which box) and «تحويل بين الصناديق» — approved in «الطلبات» (W1.4), the decision posted as a
      card into the space's topic for visibility.
- [ ] The amounts are shown only to people holding `prices.view` / the future `cash.view` (wire `cash.view` here — it is
      one of the capabilities wired to nothing today (Q1 wires `announce.send` and `escalation.configure`); A1.2 shows it
      again once wired).
- [ ] ⚠️ The OMS owns wallets and cash balances. 🔧 These requests are internal office spending only; anything about
      order money stays in the OMS (one ordered prompt to the OMS repo if a link is wanted later).

## I1.4 Decisions log («قرارات») — `feat/decisions` (optional, D-I1)

The owner keeps a topic «قرارات المالك» by hand («قرار 5 — تم ✅ …»). Optional feature: a topic type DECISIONS where each
new message gets a running number and a status chip «جديد / قيد التنفيذ / تم» changed by the author or a moderator
(additive: `ChatMessage.decisionNo INT NULL`, `ChatMessage.decisionStatus TEXT NULL`), a list view of open decisions,
and «اعمل مهمة» from a decision. Build only if the owner says yes.

## I1.5 Telegram bridge for the move (optional, D-I2)

The Workspace already has its own Telegram bot integration (`TelegramChat`, `TelegramMessage`,
`src/app/api/integrations/telegram/**`). During a move period a Telegram group's topic could be mirrored one-way into a
Workspace topic (read-only cards «من تيليجرام: فلان: …») so nothing is lost while people switch. ⚠️ Telegram messages
may contain customer data: it stays inside the Workspace: for a bridged topic the three switches that send message text to a model (Q1.7)
stay off, or point at the owner's own machine. Build only if the owner wants a gradual move; otherwise announce a switch day.

Strings: `src/lib/i18n/ar.integrations-fit.json`. Switches: `omsEvents` (I1.1a), `doorMessages` (I1.1b), `spaceTemplates` (I1.2),
`expenseForms` (I1.3), `decisionsLog` (I1.4), `telegramBridge` (I1.5).

## Acceptance

- [ ] An OMS event appears as a card in the right topic within 2 s, with a working «افتح الطلب» button, no customer
      data in the stored row (DB test reads the row).
- [ ] A new space from a template has its topics and pipeline project ready.
- [ ] An office expense goes request → approval → card in the topic, amount visible only to the allowed people.
