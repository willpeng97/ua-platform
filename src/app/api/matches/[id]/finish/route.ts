import { NextResponse } from "next/server";
import { ensureUser } from "@/lib/auth";
import { finishMatch, getMatchDetail } from "@/lib/matches";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    const { userId } = await ensureUser();
    const { id } = await params;
    const body = (await req.json()) as { winnerId?: string };
    if (!body.winnerId) {
      return NextResponse.json({ error: "winnerId required" }, { status: 400 });
    }
    await finishMatch(id, userId, body.winnerId);
    const detail = await getMatchDetail(id, userId);
    return NextResponse.json({ match: detail });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return NextResponse.json({ error: "Failed to finish" }, { status: 500 });
  }
}
