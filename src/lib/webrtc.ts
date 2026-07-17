"use client";

export type IceServer = RTCIceServer;

export async function fetchIceServers(): Promise<IceServer[]> {
  try {
    const res = await fetch("/api/ice");
    if (!res.ok) throw new Error("ice failed");
    const data = (await res.json()) as { iceServers: IceServer[] };
    return data.iceServers;
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

export function createPeerConnection(iceServers: IceServer[]) {
  return new RTCPeerConnection({ iceServers });
}
