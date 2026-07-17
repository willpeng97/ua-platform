import { NextResponse } from "next/server";
import { ensureUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await ensureUser();
    return NextResponse.json({ user });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
