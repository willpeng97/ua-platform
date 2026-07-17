import { NextResponse } from "next/server";
import { ensureUser } from "@/lib/auth";
import { getMatchDetail } from "@/lib/matches";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { userId } = await ensureUser();
    const { id } = await params;
    const detail = await getMatchDetail(id, userId);
    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (detail.player1Id !== userId && detail.player2Id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ match: detail });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
