"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomServerMessage } from "@/lib/protocol";
import { useRoomSocket } from "@/lib/use-room-socket";
import { createPeerConnection, fetchIceConfig } from "@/lib/webrtc";

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
  const makingOffer = useRef(false);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const signalChain = useRef(Promise.resolve());
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

  const flushIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingIce.current.splice(0);
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* ignore */
      }
    }
  }, []);

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
        await localVideoRef.current.play().catch(() => undefined);
      }

      const ice = await fetchIceConfig("relay");
      const pc = createPeerConnection(ice);
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

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setNote("已連線，對手應可看到畫面");
        } else if (pc.connectionState === "failed") {
          setNote("連線失敗，重新建立中…");
          pcRef.current?.close();
          pcRef.current = null;
          void startPublish(sess);
        }
      };

      const sendOffer = async (iceRestart = false) => {
        if (makingOffer.current) return;
        if (pc.connectionState === "connected") return;
        if (pc.signalingState !== "stable") return;
        makingOffer.current = true;
        try {
          const offer = await pc.createOffer({ iceRestart });
          await pc.setLocalDescription(offer);
          await publishSignalRef.current({
            type: "SIGNAL",
            matchId: sess.matchId,
            fromPlayerId: sess.playerId,
            toPlayerId: sess.opponentId!,
            fromRole: "camera",
            token: sess.token,
            signal: {
              kind: "offer",
              sdp: pc.localDescription?.toJSON() ?? offer,
            },
          });
          setNote(
            ice.hasTurn
              ? "已送出視訊（TURN relay），請看對手桌機"
              : "已送出視訊連線，請看對手桌機",
          );
        } catch (err) {
          console.error(err);
          setNote("建立 offer 失敗");
        } finally {
          makingOffer.current = false;
        }
      };

      pc.onnegotiationneeded = () => {
        void sendOffer(false);
      };

      let retries = 0;
      const retry = window.setInterval(() => {
        if (!pcRef.current || pcRef.current !== pc) {
          window.clearInterval(retry);
          return;
        }
        if (pc.connectionState === "connected") {
          window.clearInterval(retry);
          return;
        }
        if (retries >= 5) {
          window.clearInterval(retry);
          return;
        }
        if (pc.signalingState === "stable") {
          retries += 1;
          // After first couple tries, force ICE restart via relay
          void sendOffer(retries >= 2);
        }
      }, 6000);

      setNote(
        ice.hasTurn
          ? "攝影機已開，經 TURN 連線中…"
          : "攝影機已開，連線中…",
      );
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
    (msg: RoomServerMessage) => {
      if (!session) return;

      if (msg.type === "PLAYER_JOINED" || msg.type === "MATCH_UPDATED") {
        void (async () => {
          const res = await fetch(`/api/camera/${token}`);
          if (res.ok) {
            const data = await res.json();
            setSession(data.session);
            if (data.session.opponentId && !pcRef.current) {
              void startPublish(data.session);
            }
          }
        })();
        return;
      }

      if (msg.type !== "SIGNAL" || msg.toPlayerId !== session.playerId) return;
      if (msg.fromRole !== "desktop") return;

      signalChain.current = signalChain.current.then(async () => {
        const pc = pcRef.current;
        if (!pc) return;
        const { signal } = msg;

        try {
          if (signal.kind === "answer" && signal.sdp) {
            if (pc.signalingState !== "have-local-offer") return;
            await pc.setRemoteDescription(signal.sdp);
            await flushIce(pc);
            setNote("對手桌機已接通，傳輸中…");
          } else if (signal.kind === "ice" && signal.candidate) {
            if (!pc.remoteDescription) {
              pendingIce.current.push(signal.candidate);
            } else {
              try {
                await pc.addIceCandidate(signal.candidate);
              } catch {
                /* ignore */
              }
            }
          }
        } catch (err) {
          console.error("camera signal error", err);
        }
      });
    },
    [flushIce, session, startPublish, token],
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
      pcRef.current = null;
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
          {connected ? "即時通道已連線" : "即時通道連線中…"} · 請將鏡頭對準牌桌 ·
          請保持此頁在前景
        </p>
      </div>
    </div>
  );
}
