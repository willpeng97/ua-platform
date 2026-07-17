import { NextResponse } from "next/server";
import { ensureUser } from "@/lib/auth";
import { getMatchDetail, joinMatch } from "@/lib/matches";

export async function POST(req: Request) {
  try {
    const { userId } = await ensureUser();
    const body = (await req.json()) as { joinCode?: string };
    if (!body.joinCode) {
      return NextResponse.json({ error: "joinCode required" }, { status: 400 });
    }
    const match = await joinMatch(body.joinCode, userId);
    const detail = await getMatchDetail(match.id, userId);
    return NextResponse.json({ match: detail });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return NextResponse.json({ error: "Failed to join match" }, { status: 500 });
  }
}
