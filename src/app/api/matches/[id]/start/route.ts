import { NextResponse } from "next/server";
import { ensureUser } from "@/lib/auth";
import { getMatchDetail, startMatch } from "@/lib/matches";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const { userId } = await ensureUser();
    const { id } = await params;
    await startMatch(id, userId);
    const detail = await getMatchDetail(id, userId);
    return NextResponse.json({ match: detail });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return NextResponse.json({ error: "Failed to start" }, { status: 500 });
  }
}
