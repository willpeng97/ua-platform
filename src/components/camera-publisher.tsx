"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomServerMessage } from "@/lib/protocol";
import { useRoomSocket } from "@/lib/use-room-socket";
import { createPeerConnection, fetchIceServers } from "@/lib/webrtc";

type Session = {
  token: string;
  matchId: string;
  playerId: string;
  opponentId: string | null;
  status: string;
};

export function CameraPublisher({ token }: { token: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("初始化中…");
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const publishSignalRef = useRef<
    (msg: {
      type: "SIGNAL";
      matchId: string;
      fromPlayerId: string;
      toPlayerId: string;
      fromRole: "desktop" | "camera";
      signal: {
        kind: "offer" | "answer" | "ice";
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit | null;
      };
      token?: string;
    }) => Promise<void>
  >(async () => undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/camera/${token}`);
      const data = await res.json();
      if (!res.ok) {
        if (!cancelled) setError(data.error || "Invalid token");
        return;
      }
      if (!cancelled) setSession(data.session);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const startPublish = useCallback(async (sess: Session) => {
    if (!sess.opponentId) {
      setNote("等待對手加入後開始推流…");
      return;
    }
    if (pcRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const iceServers = await fetchIceServers();
      const pc = createPeerConnection(iceServers);
      pcRef.current = pc;

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      pc.onicecandidate = (ev) => {
        if (!ev.candidate || !sess.opponentId) return;
        void publishSignalRef.current({
          type: "SIGNAL",
          matchId: sess.matchId,
          fromPlayerId: sess.playerId,
          toPlayerId: sess.opponentId,
          fromRole: "camera",
          token: sess.token,
          signal: { kind: "ice", candidate: ev.candidate.toJSON() },
        });
      };

      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await publishSignalRef.current({
            type: "SIGNAL",
            matchId: sess.matchId,
            fromPlayerId: sess.playerId,
            toPlayerId: sess.opponentId!,
            fromRole: "camera",
            token: sess.token,
            signal: { kind: "offer", sdp: offer },
          });
          setNote("已送出視訊連線，請確認對手桌機畫面");
        } catch (err) {
          console.error(err);
          setNote("建立 offer 失敗");
        }
      };

      setNote("攝影機已開啟，連線中…");
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "無法開啟攝影機（請允許相機權限）",
      );
    }
  }, []);

  const onMessage = useCallback(
    async (msg: RoomServerMessage) => {
      if (!session) return;

      if (msg.type === "PLAYER_JOINED" || msg.type === "MATCH_UPDATED") {
        const res = await fetch(`/api/camera/${token}`);
        if (res.ok) {
          const data = await res.json();
          setSession(data.session);
          if (data.session.opponentId && !pcRef.current) {
            void startPublish(data.session);
          }
        }
        return;
      }

      if (msg.type !== "SIGNAL" || msg.toPlayerId !== session.playerId) return;
      if (msg.fromRole !== "desktop") return;

      const pc = pcRef.current;
      if (!pc) return;
      const { signal } = msg;

      try {
        if (signal.kind === "answer" && signal.sdp) {
          await pc.setRemoteDescription(signal.sdp);
          setNote("對手桌機已接通");
        } else if (signal.kind === "ice" && signal.candidate) {
          try {
            await pc.addIceCandidate(signal.candidate);
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        console.error("camera signal error", err);
      }
    },
    [session, startPublish, token],
  );

  const { connected, publishSignal } = useRoomSocket({
    matchId: session?.matchId ?? "",
    role: "camera",
    playerId: session?.playerId ?? "",
    token,
    enabled: !!session,
    onMessage,
  });

  useEffect(() => {
    publishSignalRef.current = async (msg) => {
      await publishSignal(msg);
    };
  }, [publishSignal]);

  useEffect(() => {
    if (session?.opponentId) {
      void startPublish(session);
    }
  }, [session, startPublish]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
    };
  }, []);

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black px-4 text-center text-red-400">
        {error}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black text-zinc-300">
        載入攝影機工作階段…
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh bg-black text-white">
      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        className="h-dvh w-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
        <p className="text-sm font-medium">{note}</p>
        <p className="mt-1 text-xs text-zinc-400">
          {connected ? "即時通道已連線" : "即時通道連線中…"} · 請將鏡頭對準牌桌
        </p>
      </div>
    </div>
  );
}
