# Workspace door — v1

> «الباب»: how another Zaki system (System 7, first) sends **ideas** and **tasks** into Zaki Workspace.
> Machine to machine, no session, no cookie. Published contract: **a v1 field never changes meaning**.
> Inside `data` an *optional* field may be added; removing, renaming or retyping a field, or a new field
> in the envelope, is `v2` (`/api/v2/...`). This file is the original; copies in other repositories are never edited.
>
> Code: `src/app/api/v1/**` · `src/server/services/api-door.ts` · `src/server/door/*` ·
> tests: `tests/db/api-door.test.ts`, `tests/api-door-*.test.ts`.

## 1. What it is, and what it is not

| | |
|---|---|
| Direction | **into** Workspace only. Workspace's own outbound, signed deliveries (`X-Zaki-Signature`) are a different channel and are not part of this contract. |
| Who may call | a holder of a **token** that the company's owner (or anybody holding «الربط والأتمتة», `integrations.manage`) made on the «الأتمتة» screen. |
| What it may do | `POST /api/v1/ideas`, `GET /api/v1/ideas`, `GET /api/v1/boards`, `POST /api/v1/tasks`, `GET /api/v1/tasks`, `GET /api/v1/tasks/{id}`. Nothing else: no reading of the company's own work, no people, no files, no chat. |
| Where it writes | **one space** — the one chosen when the token was made. The sender never names the space. |
| Off by default | the company's feature switch `apiDoor` («باب الربط الخارجي») is **off** until the owner turns it on. Off: **every** `/api/v1` route answers `404 door.not_found` (for a valid token too). |
| Transport | HTTPS only (the production proxy terminates TLS). The token is a bearer secret: anybody who holds it holds the door. |

## 2. Privacy: no customer data crosses it

This follows the repository rule «no customer data crosses a contract».

- **Identifiers are opaque.** `externalRef` is the sender's own reference (an order id, a conversation id, a uuid) — letters, digits and `. _ : - /`, at most 128 characters, **no spaces, no `@`**, so a name or an e-mail cannot ride in it.
- **A field whose NAME says customer data is refused** with its own code, `422 door.customer_data_rejected`, **before anything else is looked at and before anything is stored**, at any depth of the body. A key is customer data when one of its words (split at camelCase, `_`, `-`, `.`) is one of: `name`, `fullName`, `firstName`, `lastName`, `phone`, `mobile`, `whatsapp`, `tel`, `address`, `street`, `city`, `email`, `customer`, `client`, `buyer`, `recipient`, `price`, `amount`, `total`, `cost`, `balance`, `iban`, `cod` … or when a one-word key contains `customer`, `phone`, `address`, `email`, `price`, … (`customername`). The answer lists the offending key paths and never their values.
- **The body is strict.** A field this contract does not declare is `422 door.validation_failed` — never ignored, never stored.
- **`title` and `description` are free text. The SENDER is responsible for what it writes there**; the door does not read them for names or numbers. Do not put a customer in them.
- **Prices:** the door neither takes nor returns a price, an amount, a reward or a CRM value. A task made through it is a plain task (no reward, no assignee).
- **What a token can read back is only what that token sent**: its own ideas, its own tasks. Never another token's, a person's, or another company's — those answer `404`, identical to "does not exist".
- **What the answers never contain:** the author's name or id, the company id, the space id, the token id, any other person. (`source` is the token's own name, chosen by the owner.)

## 3. Authentication

```
Authorization: Bearer <token>
```

- A token looks like `zws_<12 hex>.<43 base64url>` (256 random bits). It is shown **once**, when the owner makes it. Workspace stores only a SHA-256 hash and compares in constant time; a lost token is replaced, never recovered.
- A token belongs to **one company**, holds **named permissions**, writes to **one space**, and acts **in the name of the person who made it** (that person appears as the author of what it sends, inside Workspace only).
- **Permissions** — a new token is read-only until the owner switches writes on:

| Permission | Allows |
|---|---|
| `ideas.write` | `POST /api/v1/ideas` (and, implied, reading the ideas this token sent) |
| `tasks.write` | `POST /api/v1/tasks` (and, implied, reading the tasks this token created) |
| `ideas.read` | `GET /api/v1/ideas` |
| `tasks.read` | `GET /api/v1/boards`, `GET /api/v1/tasks`, `GET /api/v1/tasks/{id}` |

  A token with no permission can read nothing and write nothing. A missing permission is `403 door.forbidden`.
- **A token dies immediately** (`401 door.unauthorized`, the same answer as for an unknown token — the sender learns nothing about why) when:
  - it is **revoked** on the screen (one click, for good);
  - it **expires** (the owner picks 30 / 90 / 365 days, or "never");
  - the person who made it is **suspended or offboarded** — their tokens are revoked in the same commit, and reactivating the person does **not** bring them back;
  - the person who made it is no longer an ACTIVE member, was made an external partner, no longer holds «الربط والأتمتة», or is no longer in the token's space (all read from the database on every request).
- ⚠️ A token writes into the company from outside. 🔧 Make it from an account that stays at work, give it only the permissions it needs, set an expiry, and revoke it the moment it leaks.

## 4. Envelope

Success:

```json
{ "data": { "...": "..." } }
```

A list:

```json
{ "data": [ { "...": "..." } ], "nextCursor": "ckx…" }
```

`nextCursor` is `null` on the last page; pass it back as `?cursor=` (and `?limit=`, 1–100, default 50). Newest first.

Failure — **always** this shape, never a stack trace:

```json
{ "error": { "code": "door.validation_failed", "message": "The request body is not valid.", "details": [ { "path": "title", "message": "..." } ] } }
```

`code` is stable and machine-readable; `message` is a short English sentence for developers and may be reworded; `details` is present only where noted.
Every answer (success or failure) carries `X-Request-Id` (a uuid). Quote it when talking to the owner: it is in the server log and in the audit trail's `meta.requestId`.
Responses are `Cache-Control: no-store`.

## 5. Errors

| HTTP | `code` | When |
|---|---|---|
| 400 | `door.bad_json` | the body is not a JSON object |
| 400 | `door.idempotency_key_required` | a write without `Idempotency-Key` |
| 400 | `door.idempotency_key_invalid` | the key is not 8–128 characters of letters, digits and `. _ : -` |
| 401 | `door.unauthorized` | no / malformed / unknown / wrong / revoked / expired token, or the person it acts for is no longer allowed. Carries `WWW-Authenticate: Bearer`. |
| 403 | `door.forbidden` | the token lacks the permission, or the person it acts for may no longer add ideas / tasks (their section switches in Workspace). `message` says which. |
| 404 | `door.not_found` | the switch is off; the id is not a task this token created; or it does not exist (all identical) |
| 404 | `door.board_not_found` | the `boardId` is not a board of the space this token writes to (another space's or another company's board is the same answer) |
| 409 | `door.idempotency_conflict` | the same `Idempotency-Key` was already used with a **different** body |
| 413 | `door.body_too_large` | the body is over 32 KiB |
| 415 | `door.unsupported_media_type` | `Content-Type` is not `application/json` |
| 422 | `door.validation_failed` | a bad value, or a field this contract does not declare. `details`: `[{ path, message }]` |
| 422 | `door.customer_data_rejected` | a field name says customer data (section 2). `details`: `{ "keys": ["customerPhone"] }` |
| 429 | `door.rate_limited` | over the limits below. Carries `Retry-After` (seconds). |
| 500 | `door.internal` | our fault; retry with the **same** `Idempotency-Key` |

## 6. Idempotency

Every `POST` **requires** `Idempotency-Key: <8–128 characters: letters, digits, . _ : ->`.

- The same key with the same body returns **the same answer** (same status, same `data`) and creates **nothing** — the answer carries `Idempotent-Replayed: true`. "Same body" means the same fields and values, in any order.
- The same key with a different body is `409 door.idempotency_conflict`; nothing is created.
- Two identical requests arriving at the same moment create one thing; both get its answer.
- A key is remembered for **48 hours**, then forgotten.
- A failed request (4xx, 5xx) stores nothing: retry it freely, with the same key.
- **The stored key always starts with the company**: `<organizationId>:<tokenId>:<kind>:<your key>`. One company's retry can never replace another's, and two tokens of one company never share keys. The thing, its audit row and the record of the answer are written in **one transaction**.
- Use a fresh key per logical operation (a uuid, or `s7:<your own id>`), and the same key for every retry of that operation.

## 7. Limits

| | |
|---|---|
| Requests per token | **60 per minute**, reads and writes together → `429` + `Retry-After` |
| Refused tokens per address | **20 per 10 minutes** → that address gets `429` for the rest of the window (a revoked token still looping counts) |
| Body | 32 KiB |
| `title` | idea 3–140 characters · task 1–280 |
| `description` | idea ≤ 2000 · task ≤ 10 000 |
| `tags` | ≤ 10, each 1–32 letters / digits / `_` / `-` (Arabic allowed), repeats dropped |

## 8. Endpoints

### `POST /api/v1/ideas` — permission `ideas.write`

Request:

```json
{
  "title": "Offer a bundle for the first-order customers",
  "description": "Optional. Free text. No customer data.",
  "tags": ["offers", "q4"],
  "externalRef": "s7:idea/42"
}
```

`title` required. Everything else optional. **No other field is accepted.**

`201`:

```json
{
  "data": {
    "id": "ckx9…",
    "title": "Offer a bundle for the first-order customers",
    "description": "Optional. Free text. No customer data.",
    "status": "NEW",
    "tags": ["offers", "q4"],
    "externalRef": "s7:idea/42",
    "source": "System 7 - production",
    "createdAt": "2026-11-03T10:00:00.000Z",
    "updatedAt": "2026-11-03T10:00:00.000Z"
  }
}
```

The idea appears in the token's space, written in the name of the person who made the token, marked with its source. `status` is the idea's **current** status, moved along by the team: `NEW → UNDER_REVIEW → PLANNING → LAUNCHED`, or `REJECTED`.

### `GET /api/v1/ideas?limit=&cursor=` — permission `ideas.read` (or `ideas.write`)

The ideas **this token** sent, newest first: `{ "data": [ <idea> ], "nextCursor": … }`.

### `GET /api/v1/boards` — permission `tasks.read` (or `tasks.write`)

The boards a task may be sent to: the open boards of the token's space that the person the token acts for sees (a team's project only if they are in the team).

```json
{ "data": [ { "id": "ckb1…", "name": "Board", "project": "Weekly reports" } ] }
```

### `POST /api/v1/tasks` — permission `tasks.write`

Request:

```json
{
  "title": "Prepare the weekly report",
  "description": "Optional.",
  "boardId": "ckb1…",
  "priority": "HIGH",
  "dueDate": "2026-11-20",
  "externalRef": "s7:task/9"
}
```

`title` and `boardId` required. `priority`: `URGENT | HIGH | NORMAL | LOW | NONE` (default `NORMAL`). `dueDate`: `YYYY-MM-DD` (noon in the company's time zone) or a full ISO instant with an offset. **No assignee, space, project, column or reward is accepted**: the token decides the space; the task lands in the **first column** of the named board, unassigned. Find the `boardId` with `GET /api/v1/boards`.

`201`:

```json
{
  "data": {
    "id": "ckt1…",
    "number": 128,
    "title": "Prepare the weekly report",
    "description": "Optional.",
    "boardId": "ckb1…",
    "status": "open",
    "column": { "id": "ckc1…", "name": "To do" },
    "priority": "HIGH",
    "dueDate": "2026-11-20T10:00:00.000Z",
    "finishedAt": null,
    "externalRef": "s7:task/9",
    "createdAt": "2026-11-03T10:00:00.000Z",
    "updatedAt": "2026-11-03T10:00:00.000Z"
  }
}
```

The task is made by the same `createTask` rules as any task of the app (numbering, the project chain, teams, the section switches of the person the token acts for).

### `GET /api/v1/tasks/{id}` — permission `tasks.read` (or `tasks.write`)

The status of a task **this token created**: the same `data` as above. `status` is `open`, or `done` when the task sits in a finished column (`finishedAt` then says when). Any other id is `404 door.not_found`.

### `GET /api/v1/tasks?limit=&cursor=` — permission `tasks.read` (or `tasks.write`)

The tasks this token created, newest first.

## 9. Examples

```bash
curl -sS -X POST "$WORKSPACE/api/v1/ideas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: s7-idea-42-v1" \
  -H "Content-Type: application/json" \
  -d '{"title":"Offer a bundle for the first-order customers","tags":["offers"],"externalRef":"s7:idea/42"}'
```

The same command sent again (a retry) returns the same `201` body with `Idempotent-Replayed: true` and creates nothing.

```bash
curl -sS "$WORKSPACE/api/v1/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN"
```

A refused customer field:

```
POST /api/v1/ideas   {"title":"Call back","customerPhone":"..."}
422 {"error":{"code":"door.customer_data_rejected","message":"The payload names customer data. The door takes opaque identifiers only.","details":{"keys":["customerPhone"]}}}
```

## 10. What Workspace records

- The token's creation and revocation (who, when, why: `manual`, `person_suspended`, `person_offboarded`), shown on the owner's screen with the last use.
- One audit row per idea / task made through the door (`door.idea.created`, `door.task.created`): the person it acted for, the token, the sender's `externalRef`, the request id. **Never the title or the description.**
- `door.refused` lines in the server log (the reason, never the token) for refused tokens.

## 11. Changing this contract

`v1` is frozen. A new optional field inside `data` is allowed and a sender must ignore fields it does not know. Anything else — removing, renaming or retyping a field, a new field at the envelope level, a new required request field — is `v2`.
