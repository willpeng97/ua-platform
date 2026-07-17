import { NextResponse } from "next/server";
import { ensureUser } from "@/lib/auth";
import { incrementScore } from "@/lib/matches";

export async function POST(req: Request) {
  try {
    const { userId } = await ensureUser();
    const body = (await req.json()) as { matchId?: string };
    if (!body.matchId) {
      return NextResponse.json({ error: "matchId required" }, { status: 400 });
    }
    const scores = await incrementScore(body.matchId, userId);
    return NextResponse.json({ scores });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return NextResponse.json({ error: "Failed to update score" }, { status: 500 });
  }
}
