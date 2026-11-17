# zaki-ai-OSM — ordered prompt Q1.0 (the link to Zaki Workspace)

**Repository:** the orders system (`zaki-ai-OSM`). **Why:** Zaki Workspace (the team's chat and work app) reads this system's
products every five minutes to show a live price and the offers beside each product sheet, and reads the state of an order. This
file is executed HERE, by this system's own session — it is written in the Workspace repository and never run from there.
Everything below is small and additive, in this system's own style; nothing existing changes shape.

No secret, no private address and no customer value is in this file or may be put in the answers it asks for.

## The changes, in this order

### 1. A token preset «زاكي ووركسبيس»
Add a preset to the page where system tokens are issued, called «زاكي ووركسبيس», with exactly these three scopes:
`products.read`, `orders.read`, `orders.note`. A token made from it lives 90 days (as every system token does) and the page shows
the day it ends, so the owner can type that day in the Workspace and be warned 14 days before.

### 2. More fields on `GET /api/v1/products`, optional and additive
Keep the door exactly as it is. Add these to each product, in the door's own optional-fields style (`?fields=` or whatever the door
already uses to add fields), and leave every existing field and every existing caller untouched:

- `id` — this system's internal product id (a string).
- `store` — the store's name.
- `category` — the category's NAME (one of the nine the owner already uses).
- `images` — public image URLs, the main one first.
- on each offer: `free_quantity` (the gift units inside `quantity`, when the offer has any) and `delivery_included` (true/false).
- `link` — the product's shop page.

Do NOT add reviews. A review carries a customer's first name and city, and customer data never leaves this system for the
Workspace.

### 3. Reading an order by its NUMBER
Add `GET /api/v1/orders?number=<order number>` (scope `orders.read`). It answers the same four fields the door answers for an order
by its internal id — the order's number, its state, when it last moved, and the note count if there is one — plus `order_id` (the
internal id), the product's name and the quantity. Still no customer name, phone, address or city.

### 4. Publish the contract
Publish `contracts/oms-workspace.v1/` in THIS repository: a schema file and ONE example answer for each of the three doors the
Workspace uses (`GET /api/v1/products`, `GET /api/v1/orders/{id}` and `GET /api/v1/orders?number=`, and the body of
`POST /api/v1/orders/{id}/notes`). Its source is this repository. The owner copies it into the Workspace verbatim; the Workspace
never edits it. The example must use invented names, codes and prices only.

## Hand back
Reply with: the preset's name and scopes, the exact optional-field names of item 2, the route of item 3, and the path of the
contract folder. The Workspace's tests are then pointed at the real example.

## What the Workspace does until this lands
- It reads what the door gives today (code, name, price, offers) and keeps its snapshot beside each linked sheet.
- The category of a sheet is picked by hand from the company's category list.
- The price of one piece inside an offer is shown only when the gift units are known.
- The delivery line («توصيل مجاني · دفع عند الاستلام») is one sentence the owner sets in the knowledge settings.
- Until item 3 lands, an order is read by its internal id only.
