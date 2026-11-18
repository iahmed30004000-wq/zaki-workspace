# Workspace door — v2

> «باب الرسائل»: how another system (the media buyer, n8n, the owner's own AI manager) posts a **card** into one topic of Zaki Workspace.
> Machine to machine, no session, no cookie. **One endpoint:** `POST /api/v2/messages`.
>
> This is a NEW file. `docs/contracts/workspace-door.v1.md` is **frozen** and is not touched: every v1 route answers exactly as it did, with
> its own switch (`apiDoor`), its own limit (60 a minute) and its own permissions. v2 adds one permission and one endpoint and changes nothing of v1.
> Published contract: **a v2 field never changes meaning**; inside `data` an optional field may be added, anything else is `v3`.
>
> Code: `src/app/api/v2/messages/route.ts` · `src/server/door/messages.ts` · `src/server/door/message-payload.ts` · `src/server/chat/door-message.ts` ·
> tests: `tests/db/door-messages.test.ts`.

## 1. What it is, and what it is not

| | |
|---|---|
| Direction | **into** Workspace only. |
| Who may call | a holder of a **token** that the company's owner (or anybody holding «الربط والأتمتة», `integrations.manage`) made on the «الأتمتة» screen, with the permission `messages.write`. The token is v1's token: the same `zws_…` shape, the same single company, the same single space. |
| What it may do | `POST /api/v2/messages`. Nothing else: it cannot read a message, a topic, a person or a file, and it cannot name a space. |
| Where it writes | one **topic** of the token's space, named by `topicKey`. |
| Off by default | the company's switch `doorMessages` («باب الرسائل») is **off** until the owner turns it on, and v1's master switch `apiDoor` («باب الربط الخارجي») must be on too (one kill switch for every door). Either off: the route answers `404 door.not_found` for every token. |
| Transport | HTTPS only. The token is a bearer secret: whoever holds it can post cards as the person who made it. |

## 2. Authentication and the author

```
Authorization: Bearer <token>
```

Exactly v1's rules (section 3 of `workspace-door.v1.md`): a token dies at once, with the same `401 door.unauthorized` and no hint why, when it is revoked or expired,
or when the person who made it is no longer an ACTIVE member holding «الربط والأتمتة» or no longer in the token's space. All of it is read from the database on every request.

- **The author is the token's person.** The card appears as a message written by the person who made the token, so revoking the person revokes the token and every
  rule of the app that applies to that person applies to the token: they must be able to read the topic and to post in it, with no exception for anyone. The owner, who reads silently
  everywhere, posts only where he has «joined» the topic: a token of his that names a topic he has not joined is refused `403 door.forbidden`.
- **The bubble says who really sent it.** The message carries `viaApp` = the token's name, and its words start with that name: «عبر <اسم المفتاح>» (like Telegram's «via @bot»).
- **Permission** — a new token holds none:

| Permission | Allows |
|---|---|
| `messages.write` | `POST /api/v2/messages` |

  A missing permission is `403 door.forbidden`. A token of v1 (`ideas.*`, `tasks.*`) cannot post a card, and a token holding only `messages.write` cannot call v1.

## 3. The topic: `topicKey`

A topic is reachable by the door only when a manager of its space gave it a **door name** (`Conversation.doorKey`: letters, digits and `. _ : -`, up to 64, unique inside the
space). `topicKey` is that name. The sender never sees or sends a topic id.

A name that no topic of **the token's own space and company** has — another space's topic with the same name, another company's, a direct message, a topic nobody opened to
the door — is one and the same `404 door.topic_not_found`. A closed or archived topic takes nothing: `409 door.topic_closed`.

## 4. Request

```
POST /api/v2/messages
Authorization: Bearer <token>
Idempotency-Key: <8–128 characters: letters, digits, . _ : ->
Content-Type: application/json
```

```json
{
  "topicKey": "reports",
  "card": {
    "title": "Daily ad spend",
    "lines": [ { "label": "Spend", "value": "1250" }, { "label": "Campaigns", "value": "7" } ],
    "status": "ok",
    "ref": "ZK-2026-000123",
    "buttons": [ { "label": "Open the report", "url": "https://reports.example.com/daily" } ]
  },
  "mustRead": false
}
```

| Field | Rule |
|---|---|
| `topicKey` | required, the door name of a topic (section 3) |
| `card.title` | required, 1–120 characters |
| `card.lines` | optional, at most **8** of `{ label (1–40), value (1–200) }` |
| `card.status` | optional: `info` · `ok` · `warn` · `danger` |
| `card.ref` | optional, an **order number in the orders system's own shape** (`[A-Z0-9]{2,10}-[0-9]{4}-[0-9]{4,8}` with a letter in its first part): shown as the order chip. The one field that is not scanned for a phone number |
| `card.buttons` | optional, at most **3** of `{ label (1–24), url }`; `url` is **https**, with no user name or password, no port, and a host the owner allowed **on this token** (an exact host name; a token with no host accepts no button) |
| `mustRead` | optional, `true` marks the card «لازم ينقرأ» (Q1.6): honoured only while that switch is on and the token's person may mark messages, else `403 door.forbidden` |

**No other field is accepted** (`422 door.validation_failed`). A NUL character in any text is refused.

## 5. Privacy: no customer data crosses it

This follows the repository rule «no customer data crosses a contract», with the same two layers as v1 and one more:

1. **A field whose NAME says customer data is refused first**, at any depth, with `422 door.customer_data_rejected` and the key paths (v1's rule, section 2 of the v1 file).
2. **Every text of the card except `ref` is checked with the phone pattern of the chat filter** (`PHONE_PATTERN` in `src/server/ai/redact.ts`: seven digits or more with at most two separators
   between them; Arabic-Indic digits count as digits; a percent-escaped number in an address is found too): the title, each line's label and value, each button's label **and address**.
   A hit is `422 door.customer_data_rejected` with `details: { "keys": ["card.title", "card.lines.0.value"] }` — paths only, never the value.
   ⚠️ A long run of digits in an address (`/orders/12345678`) is refused too, and an order number written in the title (`ZK-2026-000123` has ten digits) looks like a phone number.
   🔧 Send an order number as `card.ref`; send addresses without personal numbers in them.
3. Nothing is stored for a refused request.

The guard stops numbers, not names: ⚠️ a customer's name typed into a title is not found. 🔧 The sender must never put a customer's name, address or e-mail in any text; send opaque ids.

## 6. Answer

`201`:

```json
{ "data": { "id": "ckm1…", "topicKey": "reports", "createdAt": "2026-11-20T10:00:00.000Z" } }
```

Never the author's name or id, the space, the company or the token. The envelope, the error shape, `X-Request-Id` and `Cache-Control: no-store` are v1's.

## 7. Idempotency

`Idempotency-Key` is **required** (v1's rules, section 6 of the v1 file): the same key with the same body is the same answer (`Idempotent-Replayed: true`) and posts nothing; the same
key with another body is `409 door.idempotency_conflict`; a failed request stores nothing; two identical requests at once post one card. The stored key starts with the company, then
the token: `<organizationId>:<tokenId>:message.create:<your key>`. The card, its audit row and the record of the answer are written in **one transaction**. A key is kept 48 hours.

## 8. Limits

| | |
|---|---|
| Requests per token | **120 per minute** → `429 door.rate_limited` + `Retry-After` |
| Cards per token | **2000 per 24 hours** (counted from the stored answers, so a restart does not forget it; a replay is not a new card) → `429 door.daily_cap` + `Retry-After` |
| Refused tokens per address | v1's: 20 per 10 minutes |
| Body | 32 KiB |

## 9. Errors

v1's envelope and codes (section 5 of the v1 file) apply. The ones this endpoint adds or narrows:

| HTTP | `code` | When |
|---|---|---|
| 401 | `door.unauthorized` | as v1 |
| 403 | `door.forbidden` | no `messages.write`; `mustRead` not allowed; the token's person may not post in that topic |
| 404 | `door.not_found` | either switch is off |
| 404 | `door.topic_not_found` | section 3 |
| 409 | `door.topic_closed` | the topic is closed or archived |
| 409 | `door.idempotency_conflict` | as v1 |
| 422 | `door.validation_failed` | a bad value, an unknown field, a button host not allowed on this token (`details`: `[{ path, message }]`) |
| 422 | `door.customer_data_rejected` | section 5 |
| 429 | `door.rate_limited` · `door.daily_cap` | section 8 |

## 10. What Workspace records

- One audit row per card (`door.message.posted`): the person, the token, the topic name, the request id. **Never the words of the card.**
- Every refusal after the token was accepted is a FAILED row under «التكاملات» (`IntegrationEvent`, type `door.message`): the **code only** — no text, no payload, no token. A rate-limit refusal is
  written once a minute per token.
- `door.refused` lines in the server log for refused tokens (the reason, never the token).

## 11. What the owner sets, on the Workspace side

| | |
|---|---|
| The token | made on «الأتمتة» with `messages.write`, one space, an expiry (90 days recommended) |
| The hosts a button may use | per token, exact host names (`ApiToken.buttonHosts`) |
| The topic's door name | per topic, by a manager of the space (`Conversation.doorKey`) |
| The two switches | `apiDoor` and `doorMessages`, in «الميزات» |

## 12. Changing this contract

`v2` is frozen once published. An optional field inside `data` is allowed and a sender must ignore fields it does not know. Anything else is `v3`.
