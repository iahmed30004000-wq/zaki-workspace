import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { createTopicInGroup, groupTopicSchema } from "@/server/chat/groups";
import { structureRoute } from "@/server/door/structure-auth";

/** POST `{ title, emoji?, topicType?, postingPolicy? }`: a new topic born inside the group (for its people, when the group is restricted). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return structureRoute(req, () =>
    withApi(async () => {
      const input = await parseJson(groupTopicSchema, req);
      const ctx = await activeOrgCtx();
      return NextResponse.json(await createTopicInGroup(ctx, params.id, input), { status: 201 });
    }),
  );
}
