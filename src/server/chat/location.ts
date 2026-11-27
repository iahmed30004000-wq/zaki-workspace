import { z } from "zod";
import type { OrgAccessContext } from "@/server/auth";
import { assertFeatureOn } from "@/server/services/features";
import { sendMessage } from "@/server/chat/messages";
import type { MessageDto } from "@/server/chat/dto";
import { ACCURACY_MAX_M, roundPlace } from "@/lib/chat/location";
import { AR } from "@/lib/i18n/dict";

/**
 * «إرسال الموقع» — a person's place, sent by their own confirmation. It is an ordinary send (the same right to write, quota, reply, silent, idempotency and notifications:
 * `sendMessage`) of a CARD message: the coordinates and the accuracy are kept in `ChatMessage.card` and leave only through `presentMessage` to people who may read the
 * message. The BODY is the two words «📍 موقع» and no number: the bell, the push, the lists, the search, the digest and the assistant never see where the person is.
 * The server asks nobody anything: no map, no address lookup, no tile.
 */

const coordinate = (limit: number) => z.number({ invalid_type_error: "chatloc.e.bad", required_error: "chatloc.e.bad" }).finite("chatloc.e.bad").min(-limit, "chatloc.e.bad").max(limit, "chatloc.e.bad");

export const locationSendSchema = z
  .object({
    lat: coordinate(90),
    lng: coordinate(180),
    accuracy: z.number({ invalid_type_error: "chatloc.e.bad", required_error: "chatloc.e.bad" }).finite("chatloc.e.bad").min(0, "chatloc.e.bad").max(ACCURACY_MAX_M, "chatloc.e.bad"),
    replyToId: z.string().min(1).max(64).optional(),
    clientId: z.string().min(1).max(64).optional(),
    silent: z.boolean().optional(),
  })
  .strict();

export type LocationSendInput = z.infer<typeof locationSendSchema>;

export async function sendLocationMessage(ctx: OrgAccessContext, conversationId: string, input: LocationSendInput): Promise<MessageDto> {
  await assertFeatureOn(ctx.orgId, "chatLayoutV2");
  await assertFeatureOn(ctx.orgId, "chatLocation");
  const place = roundPlace(input);
  return sendMessage(
    ctx,
    conversationId,
    {
      body: AR["chatloc.body"]!,
      ...(input.replyToId ? { replyToId: input.replyToId } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.silent ? { silent: true } : {}),
    },
    { card: { type: "location", ...place } },
  );
}
