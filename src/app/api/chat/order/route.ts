import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parse, parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { listOrders, resetOrder, saveOrder } from "@/server/chat/order";
import { PINS_ORDER_SCOPE, saveOrderSchema, scopeSchema } from "@/lib/chat/order";
import { savePinsOrder } from "@/server/chat/read-state";

/** GET: the person's own saved orders of the chat list, `{ orders: { scope: [ids] } }`. Nobody else's. */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json({ orders: await listOrders(ctx) });
  });
}

/** PUT `{ scope, order }`: saves the person's order of one list (topics of a space, their private chats, or their own pins: `pins`). */
export async function PUT(req: Request) {
  return withApi(async () => {
    const input = await parseJson(saveOrderSchema, req);
    const ctx = await activeOrgCtx();
    const order = input.scope === PINS_ORDER_SCOPE ? await savePinsOrder(ctx, input.order) : await saveOrder(ctx, input.scope, input.order);
    return NextResponse.json({ scope: input.scope, order });
  });
}

/** DELETE `?scope=`: «رجّع الترتيب الأصلي» for one list. */
export async function DELETE(req: Request) {
  return withApi(async () => {
    const scope = parse(scopeSchema, new URL(req.url).searchParams.get("scope"));
    const ctx = await activeOrgCtx();
    await resetOrder(ctx, scope);
    return NextResponse.json({ scope, order: [] });
  });
}
