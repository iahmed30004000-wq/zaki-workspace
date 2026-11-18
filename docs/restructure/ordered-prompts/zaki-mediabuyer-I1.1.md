# zaki-mediabuyer — ordered prompt I1.1 (a daily spend card in the management space)

**Repository:** the media buyer (`zaki-mediabuyer`), which already sends tasks to Zaki Workspace through the door `/api/v1`. **Why:** the team's management group used to
receive a daily performance report from a bot; the Workspace now takes the same report as a card in its reports topic through ONE new endpoint, `POST /api/v2/messages`
(`docs/contracts/workspace-door.v2.md` in the Workspace repository). This file is executed HERE, by this system's own session — it is written in the Workspace repository
and never run from there. Everything below is small and additive, beside the existing task door; nothing existing changes shape.

No secret, no ad token, no private address and no customer value is in this file or may be put in the card. The owner pastes the Workspace's address and the token
into this system's own settings.

## The changes, in this order

### 1. One setting, one token
Add a setting for the card's door: the Workspace's address and a **token** the owner makes in the Workspace («الأتمتة») with the permission `messages.write`, bound to the
management space. The token is stored the way the existing door token is stored (encrypted, never logged, never in an answer). The owner also gives the Workspace the
**door name** of the reports topic (for example `reports`) and, if the card should carry a button, the host it points at; both are set on the Workspace side.

### 2. The daily spend card
Once a day, at the hour this system already uses for its daily summary, send ONE request:

```
POST <workspace>/api/v2/messages
Authorization: Bearer <token>
Idempotency-Key: mb:daily-spend:<YYYY-MM-DD>
Content-Type: application/json

{ "topicKey": "reports",
  "card": { "title": "<one line: the day>",
            "lines": [ { "label": "<campaign group or metric>", "value": "<number with its unit>" } ],
            "status": "ok" | "warn" | "danger",
            "buttons": [ { "label": "<at most 24 characters>", "url": "https://<an allowed host>/..." } ] } }
```
- At most **8** lines, a title of at most **120** characters, at most **3** buttons. Use `warn` or `danger` for a day over the owner's thresholds.
- **No ad token, no account number, no customer data.** Numbers only: spend, results, cost per result, return on spend. The Workspace refuses a text that holds a run of
  seven digits or more (`422 door.customer_data_rejected`): ad account ids and campaign ids are NOT sent in a title, a label, a value or an address — use a short name.
- The same `Idempotency-Key` for every retry of the same day: a retry never posts a second card.

### 3. Failures
On `429` wait `Retry-After` seconds; on `5xx` retry with the same key; on any other `4xx` do **not** retry: log the `error.code` (never the card) and show it in this
system's own integration status. Never loop on a refused request.

### 4. Leave the task door as it is
Do not change how tasks are sent through `/api/v1`. The card door is a second, separate use of a second token.

## Hand back
Reply with: the name of the setting, the hour the card is sent, the exact lines it carries, and a sample card with invented numbers.

## What the Workspace does until this lands
Nothing: the reports topic is empty until the first card, and the existing task door keeps working.
