import { NextResponse } from "next/server";
import { ensureUser } from "@/lib/auth";
import { createMatch, getMatchDetail } from "@/lib/matches";

export async function POST() {
  try {
    const { userId } = await ensureUser();
    const { match, cameraToken } = await createMatch(userId);
    const detail = await getMatchDetail(match.id, userId);
    return NextResponse.json({ match: detail, cameraToken });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return NextResponse.json({ error: "Failed to create match" }, { status: 500 });
  }
}
