import { NextResponse } from "next/server";
import { getCameraSession } from "@/lib/matches";

type Params = { params: Promise<{ token: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { token } = await params;
  const session = await getCameraSession(token);
  if (!session) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
  }
  return NextResponse.json({ session });
}
