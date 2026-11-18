# n8n and the owner's AI manager — ordered prompt I1.1 (bot posts become cards)

**Where:** the owner's own n8n workflows and the AI manager he runs (not a repository of this organisation: his own workflows). **Why:** every Telegram-bot post that is NOT
customer data (a report, a reminder, an instruction to the team, a link) can become a card in a topic of Zaki Workspace through ONE endpoint,
`POST /api/v2/messages` (`docs/contracts/workspace-door.v2.md` in the Workspace repository). This file is executed THERE, by the owner or his own session — it is written in the
Workspace repository and never run from here, and nothing in this repository edits a workflow.

No secret, no token and no private address is in this file. The token is pasted into the workflow's credential store by the owner.

## Before the first workflow
In the Workspace («الأتمتة»): make ONE token per workflow family with the permission `messages.write`, bound to the space that holds the destination topics. Name it after
the family (it is shown in the bubble as «عبر <الاسم>»). Give each destination topic a **door name**, and list the hosts a button may point at on the token. The owner sets
these in the Workspace; the workflow only knows the token and the door names.

## The changes, in this order

### 1. One HTTP node that posts a card
`POST <workspace>/api/v2/messages` with the header `Authorization: Bearer <token>`, a header `Idempotency-Key` that is the same for every retry of the same post (for example
`n8n:<workflow id>:<execution id>`), and the body of the contract: `{ topicKey, card: { title, lines, status, ref, buttons }, mustRead }`. Limits: a title of at most 120
characters, at most 8 lines, at most 3 buttons, a 32 KiB body.

### 2. Which post goes where
Map each Telegram destination (group and topic) to a `topicKey`; keep the map in one place of the workflow (not repeated in every node). Move only posts that carry **no
customer data**: a name, a phone number, an address or an e-mail of a customer never goes in a card. The Workspace refuses a text with a run of seven digits or more
(`422 door.customer_data_rejected`); an order number goes in `card.ref`, never in the title.

### 3. Instructions that must be read
An instruction to the team (a new rule, a changed process) is sent with `"mustRead": true`: each person it reaches taps «قرأت ✓» and the author sees who has not. This works only
while the Workspace's switch «لازم ينقرأ» is on and the token's person may mark messages; otherwise the Workspace answers `403 door.forbidden` — then send it without the flag.

### 4. Failures
On `429` wait `Retry-After`; on `5xx` retry with the same key; on `404 door.not_found` the owner has not turned the door on; on `404 door.topic_not_found` the topic has no door name;
on any other `4xx` stop and put the `error.code` (never the card) in the workflow's error notification. Never loop on a refused request.

### 5. The AI manager
When the AI manager writes a report or an alert, it posts it the same way. It must send only text it produced from non-customer data: if its source holds customer data, it summarises
counts and ids, never the customer's fields.

## Hand back
Reply with: the list of destinations and their door names, the families of tokens and their names, and one sample card with invented numbers.

## What the Workspace does until this lands
Nothing: the Telegram posts keep going where they go today.
