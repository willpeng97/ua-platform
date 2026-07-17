import { NextResponse } from "next/server";
import { listRoomMessages } from "@/lib/matches";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get("matchId");
  const after = searchParams.get("after") ?? undefined;
  if (!matchId) {
    return NextResponse.json({ error: "matchId required" }, { status: 400 });
  }

  const messages = await listRoomMessages(matchId, after);
  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      type: m.type,
      payload: m.payload,
      createdAt: m.createdAt,
    })),
  });
}
