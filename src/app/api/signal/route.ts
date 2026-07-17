import { NextResponse } from "next/server";
import { getCameraSession, publishRoomMessage } from "@/lib/matches";
import type { RoomServerMessage } from "@/lib/protocol";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      type: "SIGNAL";
      matchId: string;
      fromPlayerId: string;
      toPlayerId: string;
      fromRole: "desktop" | "camera";
      signal: {
        kind: "offer" | "answer" | "ice";
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit | null;
      };
      token?: string;
    };

    if (body.type !== "SIGNAL" || !body.matchId || !body.fromPlayerId) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Camera clients must present a valid token
    if (body.fromRole === "camera") {
      if (!body.token) {
        return NextResponse.json({ error: "token required" }, { status: 401 });
      }
      const session = await getCameraSession(body.token);
      if (!session || session.playerId !== body.fromPlayerId) {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
    }

    const out: RoomServerMessage = {
      type: "SIGNAL",
      matchId: body.matchId,
      fromPlayerId: body.fromPlayerId,
      toPlayerId: body.toPlayerId,
      fromRole: body.fromRole,
      signal: body.signal,
    };

    await publishRoomMessage(body.matchId, "SIGNAL", out);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
