# T1 — How the team works today, what goes wrong, and what fixes it

> Source: an export of ONE operations group of the team's Telegram (sent by the owner on 2026-11-16), covering
> 2026-11-10 → 11-16. Measured with scripts that print counts only. **Nothing from the export is copied here** — no
> name, number, order or message text: the repository is public and the export holds customer data.
> This file is the reason behind `Q1-quick-recall-and-auto-tickets.md` and parts of `I1-integrations-and-fit.md`.

## 1. The work, as the messages show it

- **What is sold:** health and care products (creams, oils, drops) — and, per the owner, clothing too — cash on
  delivery, Syria and Jordan, through social pages and a website.
- **Who does what:** page moderators talk to customers on the pages and enter («ترفع») the order; confirmation agents
  call the customer and confirm; each group has a supervisor; one person holds shipping; management instructs through
  an AI assistant that writes the price lists, product cards and follow-up instructions, and a second bot that posts
  performance reports.
- **An order's outcomes:** confirmed · cancelled · duplicate · postponed / booked for a later day · no answer · wrong
  number · shipped · delivered · returned.
- **The systems:** the orders system (OMS, its own repository) holds orders, products, categories, offers, stock,
  reviews; Telegram holds everything people SAY about them.

## 2. The numbers (7 days, one group)

| Measure | Value |
|---|---|
| Messages | 1 002 = 468 written that week + 534 forwarded in from the old group |
| People writing | 12 (two of them AI bots); the top 3 write 57% |
| Busiest hours | 11:00, and 13:00 → 15:00 (15:00 alone = 21% of the week) |
| Topics created / used | 16 / 8 — the 9 empty ones include EVERY dedicated problem topic |
| Messages in two catch-all topics (coordination + general) | 337 of 468 = 72% |
| Messages carrying a customer's phone number | 105 (84 different numbers; 61 written that week) |
| Orders typed by hand as a text template (name, phone, province, address…) | 37 (18 that week) |
| Photos posted with no word of text | 34 of 42 |
| Different order numbers written | 46, in 41 messages; 10 of them written more than once |
| Messages that ping a person by @ | 72; 13 are a bare ping with no text |
| "Received / done / good morning" messages | 36 = 8% |
| Long instruction posts (300+ characters) written that week | 26 — 22 carry prices (product cards, corrections) |
| …of those, acknowledged by anybody within 12 hours | 5, each by ONE person |
| Price-correction posts in the week | 3 (each replacing the one before) |
| Product cards posted as chat messages | 16 |
| Explicit questions | 33 — 15 (45%) got a reply attached; median wait 17 min, a quarter over 52 min, a tenth over 110 min, the slowest about 3 hours |
| Posts in the reports topic that say only "the orders system asked for sign-in" | 2 of the 3 (both from the report bot) |

What the 424 short messages of the week are about (a message can match more than one):

| Kind | Messages |
|---|---|
| Enter / re-enter an order («ارفعي», «رفعناه تاني») | 33 |
| Price or offer | 31 |
| Cancelled | 30 |
| Shipping / courier | 27 |
| Duplicate order | 14 |
| Product information (ingredients, use, suitability) | 14 |
| Postponed / booked for a day | 12 |
| "What is this order's state?" | 8 |
| Wrong number / mistake | 8 |
| Returned | 7 |

## 3. The problems, and the fix for each

| # | Problem | Evidence | Fix | Plan step |
|---|---|---|---|---|
| 1 | **Nobody knows the current price for sure.** Prices live in long chat posts that replace each other; ready-to-send offer texts are typed by hand per product. | 22 price-carrying posts and 3 corrections in a week; the instruction itself says "the prices in the messages above are old". | Prices are READ live from the orders system's own offers (its door `GET /api/v1/products` exists for exactly this: "the price lives here and nowhere else"). The product sheet shows them and BUILDS the ready offer message from them; a change posts one notice. No price is ever typed in chat. | Q1.0, Q1.1 |
| 2 | **Instructions are not confirmed read.** | 26 instruction posts, 5 acknowledged, by one person each. | «لازم ينقرأ»: a post can require acknowledgement; each person taps «قرأت»; the author sees who has not; a reminder goes to them. Price changes use it automatically. | Q1.6 |
| 3 | **Product knowledge is a wall of text, buried in chat.** | 16 product cards as messages; the same card re-posted in parts. | One interactive sheet per product, shaped by its category (the orders system already keeps a list of questions per category), every part with a copy button, photos on top. | Q1.1 |
| 4 | **The same customer question is answered from memory.** | 14 product-information exchanges; a pinned list of "expected questions". | Approved questions and answers on the sheet, searchable, one tap to copy; an unanswered question goes to the supervisor and the approved answer is added. | Q1.1 |
| 5 | **There is no organised customer feedback to send.** | The feedback topic is empty. | A feedback gallery per product: pick, copy, download one by one, or merge several into one picture; identities covered, consent recorded. | Q1.2 |
| 6 | **Problems are written where people are, not where they belong.** | 72% of messages in two catch-all topics; all problem topics empty. | Do not ask people to choose a topic: a message that is a problem BECOMES a ticket by rule (order number + problem word, or the «مشكلة» button), wherever it is written. | Q1.5 |
| 7 | **A problem has no owner and no end.** | 33 questions, 18 with no reply attached; 13 bare pings; 10 order numbers written again. | The ticket has one assignee (the person @-mentioned, else the rule's supervisor), a status chip under the message, a reminder and an escalation when it waits, and «✅ انحلّت» posted back under the original message. One order = one ticket. | Q1.5 |
| 8 | **"What is this order's state?" needs a person.** | 8 status questions + the pings; the answer exists in the orders system. | «/طلب» + order numbers become chips: the state is read from the orders system's status door (no customer data in it). | Q1.4 |
| 9 | **Customer data sits in a chat app.** | 105 messages with phone numbers, 37 full order templates, 34 captionless screenshots — in a group that also has two AI bots as members. | The orders system already has a box that reads a pasted order text: the hint's button opens it, instead of the order being typed in chat. A problem that needs the customer's number keeps it in a protected ticket field (masked in lists and pushes, wiped after closing). ⚠️ Depending on their settings, the bots in the Telegram group can read those numbers today. ⚠️ In this system three switches (the chat assistant, translation, search by meaning — all off by default) send message text to a model after masking numbers; a customer's name cannot be masked. 🔧 They stay off, or point at the owner's own machine, wherever customer data is typed. | Q1.5, Q1.7 |
| 10 | **Postponed orders are tracked by hand.** | 12 messages; an instruction to "write the delivery day next to each order number". | The orders system already has a postponed-orders list with filters: the ticket «حجز موعد» opens it and only reminds its assignee that morning; the delivery day itself is set there, never here. | Q1.5 |
| 11 | **Duplicates and re-entered orders** take a third of the coordination. | 33 + 14 messages. | The orders system already flags a duplicate and a suspect number on a new order: the tickets «مكرر» and «رقم غلط» open it there; here they only carry the conversation and its end. | Q1.5 |
| 12 | **The report bot depends on signing in to a screen.** | 2 of the 3 posts in the reports topic. | The orders system emits signed order events with no customer data: confirmed, shipped, delivered, returned and cancelled for every order, "created" only for orders placed on the shop itself, and most without the product. The Workspace counts what they carry into a daily card; "new orders" and "per product" need one ordered prompt for that system. | I1.1 |
| 13 | **Acknowledgement and greeting noise.** | 36 messages. | Reactions and «قرأت» instead of messages; the chat's own read marks. | Q1.6, C2 |
| 14 | **The house rules are text, not doors.** "A question about an order goes to your supervisor", "no leaving without permission", "a site error needs a screen recording". | The pinned rules. | «اسألي مشرفتك» opens a ticket to the asker's supervisor; «طلب إذن» is an approval form of the existing approvals module; «مشكلة بالموقع» is a ticket that asks for the recording. | Q1.5 |

## 4. What the orders system already offers (checked in its repository, read-only)

The builder must USE these and never rebuild them here (AGENTS.md: work only in this repository; one ordered prompt per
other repository):

| Need | Already there in `zaki-ai-OSM` |
|---|---|
| Products with live prices and offers, stock as a word (in stock / low / out) | `GET /api/v1/products` — scope `products.read`; optional additions through `?fields=` |
| An order's state with no customer data | `GET /api/v1/orders/{id}` — scope `orders.read` (by id) |
| A note written onto an order | `POST /api/v1/orders/{id}/notes` — scope `orders.note` |
| Order events, signed, with no customer data | app events `order.created · confirmed · shipped · delivered · returned · cancelled` (contract `oms-app-events.v1`) |
| Categories, each with its own list of questions; a product's answers | `Category.attributeSchema`, `Product.attributes` (shown on the shop's product page) |
| Product photos, published reviews (stars, text, first name, city, consent) | `ProductImage`, `ProductReview` |
| Keys per consuming system with named scopes (a key lives 90 days) | system tokens (presets: replies, media buyer, landing) |
| A flag on a new order that repeats another, or whose number looks wrong | its intake filter |
| The list of postponed orders, with filters and search | its postponed list |
| Entering an order by pasting its text | its «الصق نص الطلب» box |

What is missing there and is asked for in ONE ordered prompt (the exact list is in Q1.0): a key preset for the
Workspace; optional `?fields=` additions to the products door (`id`, `store`, `category`, `images`, `free_quantity`,
`delivery_included`, `link` — never reviews, which carry first names and cities); reading an order by its NUMBER. And,
for the daily numbers of I1.1 only: order events for every way an order is entered, carrying the product name and
the quantity (a change of the events contract at its source), or a small daily-counts door.
