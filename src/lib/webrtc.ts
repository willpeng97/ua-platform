"use client";

export type IceServer = RTCIceServer;

export type IceConfig = {
  iceServers: IceServer[];
  /** Prefer TURN relay for reliable phone↔desktop media */
  iceTransportPolicy: RTCIceTransportPolicy;
  hasTurn: boolean;
};

function hasTurnServer(servers: IceServer[]) {
  return servers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => typeof u === "string" && u.includes("turn:"));
  });
}

export async function fetchIceConfig(
  policy: RTCIceTransportPolicy = "relay",
): Promise<IceConfig> {
  try {
    const res = await fetch("/api/ice");
    if (!res.ok) throw new Error("ice failed");
    const data = (await res.json()) as { iceServers: IceServer[] };
    const iceServers = data.iceServers;
    const turn = hasTurnServer(iceServers);
    return {
      iceServers,
      // Only force relay when TURN is actually available
      iceTransportPolicy: turn ? policy : "all",
      hasTurn: turn,
    };
  } catch {
    return {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      iceTransportPolicy: "all",
      hasTurn: false,
    };
  }
}

/** @deprecated use fetchIceConfig */
export async function fetchIceServers(): Promise<IceServer[]> {
  const cfg = await fetchIceConfig();
  return cfg.iceServers;
}

export function createPeerConnection(cfg: IceConfig | IceServer[]) {
  if (Array.isArray(cfg)) {
    return new RTCPeerConnection({
      iceServers: cfg,
      iceCandidatePoolSize: 10,
    });
  }
  return new RTCPeerConnection({
    iceServers: cfg.iceServers,
    iceTransportPolicy: cfg.iceTransportPolicy,
    iceCandidatePoolSize: 10,
  });
}

export async function getMediaDebug(pc: RTCPeerConnection) {
  const stats = await pc.getStats();
  let bytesReceived = 0;
  let framesDecoded = 0;
  let dtlsState: string | undefined;
  let selectedPair: string | undefined;
  stats.forEach((r) => {
    if (r.type === "transport") {
      dtlsState = (r as RTCStats & { dtlsState?: string }).dtlsState;
      selectedPair = (r as RTCStats & { selectedCandidatePairId?: string })
        .selectedCandidatePairId;
    }
    if (r.type === "inbound-rtp" && (r as { kind?: string }).kind === "video") {
      bytesReceived += (r as { bytesReceived?: number }).bytesReceived ?? 0;
      framesDecoded += (r as { framesDecoded?: number }).framesDecoded ?? 0;
    }
    if (r.type === "candidate-pair" && (r as { selected?: boolean }).selected) {
      bytesReceived += (r as { bytesReceived?: number }).bytesReceived ?? 0;
    }
  });
  return {
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    signalingState: pc.signalingState,
    dtlsState,
    selectedPair,
    bytesReceived,
    framesDecoded,
  };
}
