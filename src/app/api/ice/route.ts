import { NextResponse } from "next/server";

export async function GET() {
  const apiKey =
    process.env.UA_ICE_API_KEY ||
    process.env.METERED_TURN_API_KEY ||
    process.env.TURN_API_KEY;
  const apiUrl =
    process.env.UA_ICE_API_URL ||
    process.env.METERED_TURN_API_URL ||
    process.env.TURN_API_URL;

  if (apiKey && apiUrl) {
    try {
      const url = new URL(apiUrl);
      url.searchParams.set("apiKey", apiKey);
      const res = await fetch(url.toString(), { next: { revalidate: 300 } });
      if (res.ok) {
        const iceServers = await res.json();
        return NextResponse.json({ iceServers });
      }
    } catch (err) {
      console.error("Metered ICE fetch failed", err);
    }
  }

  // Fallback STUN-only for local prototype without Metered keys
  return NextResponse.json({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    warning: apiKey
      ? "Metered request failed; using STUN only"
      : "METERED_TURN_API_KEY not set; using STUN only",
  });
}
