# zaki-ai-OSM — ordered prompt I1.1 (events and daily numbers for Zaki Workspace)

**Repository:** the orders system (`zaki-ai-OSM`). **Why:** Zaki Workspace now has a receiver for this system's own signed order events: each event
refreshes the order's state there, may post a card into the team's topic and may open a ticket, and one card a day counts the events. This file is
executed HERE, by this system's own session — it is written in the Workspace repository and never run from there. Everything below is small and
additive, in this system's own style; nothing existing changes shape.

No secret, no private address and no customer value is in this file or may be put in the answers it asks for. The Workspace's own address and the
receiver's address are typed by the owner on this system's screen; they are not written in any tracked file.

## The changes, in this order

### 1. Adding a custom receiver on the «التطبيقات» screen
The owner adds Zaki Workspace as a receiver: its address (typed by him, an `https` address of the Workspace ending in an opaque id), the events to send
(all five below), and a secret. If the screen already supports a custom receiver with a signing secret, change nothing and say so. If it cannot add a custom
receiver, add that and nothing more:
- the secret is made by this system and shown to the owner **once**, so he can paste it into the Workspace (the Workspace stores it encrypted; it also
  accepts a secret it made itself if this system can take one);
- every delivery is **signed** with it and an **unsigned delivery is never sent**: today a receiver without a secret receives unsigned requests, and the
  Workspace refuses them.

### 2. The deliveries, as they are signed today (keep this exact)
Headers `X-Zaki-Event`, `X-Zaki-Delivery` (unique per delivery, a uuid), `X-Zaki-Timestamp`, `X-Zaki-Signature: sha256=<HMAC-SHA256(secret, "<timestamp>.<raw body>")>`;
the timestamp text is exactly what was signed (milliseconds are fine, the Workspace accepts seconds and milliseconds); the body is `{ event, at, data }`.
A retry of the same delivery keeps the same `X-Zaki-Delivery`.

### 3. The daily-numbers gap — choose ONE of these two and tell the Workspace which
The Workspace counts, from the events it receives, how many orders were **confirmed, cancelled, shipped, delivered and returned** in the last 24 hours. It
cannot count **new orders** or **orders per product**: `order.created` fires only for an order placed on the shop itself, and most events carry no product.
Either:
- **(a) events for every way an order is entered:** `order.created` for an order entered by staff too, and `product_name` and `quantity` on every order event
  (when the order has one product; a short list otherwise). A change of the contract at its source: it stays inside `data` as optional fields; or
- **(b) a small daily-counts door:** `GET /api/v1/daily-counts?date=YYYY-MM-DD` (scope `orders.read`): the day's counts of new, confirmed, cancelled, shipped,
  delivered and returned orders, and a list of `{ product_id, product_name, count }`. **Counts only: no money, no customer name, phone, address or city, no
  order list.**
Until one of them lands, the Workspace's card shows the five counts and says what is missing.

### 4. Publish the contract
Publish `contracts/oms-app-events.v1/` in THIS repository: a schema file, ONE example for each event (`order.created`, `order.confirmed`, `order.shipped`,
`order.delivered`, `order.returned`, `order.cancelled`) and ONE signed delivery (the raw body, the headers, the secret used to sign it — an invented one — and
the resulting signature). Its source is this repository. The owner copies it into the Workspace verbatim; the Workspace never edits it. The example must
use invented order numbers, ids, product names and prices only. The Workspace's tests are pointed at it when it arrives (they use a provisional file until then).

## Hand back
Reply with: whether item 1 already existed, the exact names of the fields of `data` (the order id, the order number, the states and the previous one, the
tracking number, the product name and quantity), which of (a) or (b) was built and its route, and the path of the contract folder.

## What the Workspace does until this lands
- It keeps only the order's id and number, its states, the product name and the quantity when the event carries them; it drops the total, the currency and the
  city at the door and never stores a delivery's body.
- The daily card shows the five counts and the note about what cannot be counted.
- The field names it reads are provisional; they are replaced by the real example when the owner copies the contract folder in.
