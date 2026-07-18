"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraQr } from "@/components/camera-qr";
import type { MatchDetail } from "@/lib/types";
import type { RoomServerMessage } from "@/lib/protocol";
import { useRoomSocket } from "@/lib/use-room-socket";
import {
  createPeerConnection,
  fetchIceConfig,
  getMediaDebug,
} from "@/lib/webrtc";

type Props = {
  initialMatch: MatchDetail;
  userId: string;
  appUrl: string;
};

export function MatchRoom({ initialMatch, userId, appUrl }: Props) {
  const [match, setMatch] = useState(initialMatch);
  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState("");
  const [videoReady, setVideoReady] = useState(false);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const signalChain = useRef(Promise.resolve());
  const answering = useRef(false);
  const hasAnswered = useRef(false);
  const answeredAt = useRef<number>(0);
  const recoverTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const opponentId =
    match.player1Id === userId ? match.player2Id : match.player1Id;
  const opponentIdRef = useRef(opponentId);
  opponentIdRef.current = opponentId;

  const scoreFor = (pid: string) =>
    match.scores.find((s) => s.playerId === pid)?.score ?? 0;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/matches/${match.id}`);
    if (!res.ok) return;
    const data = await res.json();
    setMatch(data.match);
  }, [match.id]);

  const attachStream = useCallback(async (stream: MediaStream) => {
    remoteStreamRef.current = stream;
    const el = remoteVideoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    try {
      if (!el.paused && el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        setVideoReady(true);
        return;
      }
      await el.play();
      setVideoReady(true);
      setStatusNote("視訊播放中");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      el.muted = true;
      try {
        await el.play();
        setVideoReady(true);
        setStatusNote("視訊播放中");
      } catch (err2) {
        if (err2 instanceof DOMException && err2.name === "AbortError") return;
        setStatusNote("已連線但瀏覽器阻擋播放，請點一下畫面");
      }
    }
  }, []);

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

  const resetPeer = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    pendingIce.current = [];
    answering.current = false;
    hasAnswered.current = false;
    answeredAt.current = 0;
    remoteStreamRef.current = null;
    setVideoReady(false);
    const el = remoteVideoRef.current;
    if (el) el.srcObject = null;
  }, []);

  const ensurePc = useCallback(async () => {
    if (pcRef.current) return pcRef.current;
    const ice = await fetchIceConfig("relay");
    const pc = createPeerConnection(ice);
    pcRef.current = pc;

    pc.ontrack = (ev) => {
      let stream = ev.streams[0];
      if (!stream) {
        stream = remoteStreamRef.current ?? new MediaStream();
        if (!stream.getTracks().includes(ev.track)) {
          stream.addTrack(ev.track);
        }
      }
      ev.track.onunmute = () => {
        void attachStream(stream!);
      };
      void attachStream(stream);
    };

    pc.onicecandidate = (ev) => {
      const to = opponentIdRef.current;
      if (!ev.candidate || !to) return;
      void publishSignalRef.current({
        type: "SIGNAL",
        matchId: match.id,
        fromPlayerId: userId,
        toPlayerId: to,
        fromRole: "desktop",
        signal: { kind: "ice", candidate: ev.candidate.toJSON() },
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatusNote((n) =>
          n.includes("播放") ? n : "WebRTC 已連線，等待畫面…",
        );
      } else if (pc.connectionState === "failed") {
        setStatusNote("WebRTC 失敗，正在重置等待手機重連…");
        resetPeer();
      }
    };

    setStatusNote(
      ice.hasTurn
        ? "使用 TURN relay 連線中…"
        : "無 TURN，改用直連（可能不穩）…",
    );

    return pc;
  }, [attachStream, match.id, resetPeer, userId]);

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
    }) => Promise<boolean>
  >(async () => false);

  const handleSignal = useCallback(
    async (msg: Extract<RoomServerMessage, { type: "SIGNAL" }>) => {
      if (msg.toPlayerId !== userId || msg.fromRole !== "camera") return;
      const to = opponentIdRef.current;
      if (!to || msg.fromPlayerId !== to) return;

      const pc = await ensurePc();
      const { signal } = msg;

      if (signal.kind === "ice" && signal.candidate) {
        if (!pc.remoteDescription) {
          pendingIce.current.push(signal.candidate);
        } else {
          try {
            await pc.addIceCandidate(signal.candidate);
          } catch {
            /* ignore */
          }
        }
        return;
      }

      if (signal.kind !== "offer" || !signal.sdp) return;

      if (hasAnswered.current && pc.connectionState !== "failed") {
        return;
      }
      if (answering.current) return;
      let signaling = pc.signalingState;
      if (signaling !== "stable") return;

      answering.current = true;
      try {
        await pc.setRemoteDescription(signal.sdp);
        await flushIce(pc);
        signaling = pc.signalingState;
        if (signaling !== "have-remote-offer") return;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        hasAnswered.current = true;
        answeredAt.current = Date.now();
        await publishSignalRef.current({
          type: "SIGNAL",
          matchId: match.id,
          fromPlayerId: userId,
          toPlayerId: to,
          fromRole: "desktop",
          signal: {
            kind: "answer",
            sdp: pc.localDescription?.toJSON() ?? answer,
          },
        });
        setStatusNote("已收到對手攝影機連線，等待畫面…");
      } catch (err) {
        console.error("desktop signal error", err);
        if (
          !(err instanceof DOMException && err.name === "InvalidStateError")
        ) {
          setStatusNote(
            err instanceof Error ? err.message : "處理視訊訊號失敗",
          );
        }
      } finally {
        answering.current = false;
      }
    },
    [ensurePc, flushIce, match.id, userId],
  );

  const onMessage = useCallback(
    (msg: RoomServerMessage) => {
      if (msg.type === "SCORE_UPDATED") {
        setMatch((m) => ({ ...m, scores: msg.scores }));
        return;
      }
      if (msg.type === "MATCH_UPDATED") {
        setMatch((m) => ({
          ...m,
          status: msg.status as MatchDetail["status"],
        }));
        void refresh();
        return;
      }
      if (msg.type === "MATCH_FINISHED") {
        setMatch((m) => ({
          ...m,
          status: "FINISHED",
          winnerId: msg.winnerId,
        }));
        void refresh();
        return;
      }
      if (msg.type === "PLAYER_JOINED") {
        void refresh();
        return;
      }
      if (msg.type === "SIGNAL") {
        signalChain.current = signalChain.current
          .then(() => handleSignal(msg))
          .catch((err) => console.error(err));
      }
    },
    [handleSignal, refresh],
  );

  const { connected, publishSignal } = useRoomSocket({
    matchId: match.id,
    role: "desktop",
    playerId: userId,
    onMessage,
  });

  useEffect(() => {
    publishSignalRef.current = publishSignal;
  }, [publishSignal]);

  useEffect(() => {
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Detect DTLS stuck: ICE up but no media bytes → reset and wait for new offer
  useEffect(() => {
    recoverTimer.current = setInterval(() => {
      const pc = pcRef.current;
      if (!pc || !hasAnswered.current) return;
      void (async () => {
        try {
          const dbg = await getMediaDebug(pc);
          if (dbg.framesDecoded > 0 || dbg.bytesReceived > 1000) {
            if (remoteVideoRef.current && remoteVideoRef.current.videoWidth > 0) {
              setVideoReady(true);
              setStatusNote("視訊播放中");
            }
            return;
          }
          if (
            answeredAt.current &&
            Date.now() - answeredAt.current > 10000 &&
            (dbg.connectionState === "connecting" ||
              dbg.dtlsState === "connecting" ||
              dbg.iceConnectionState === "connected") &&
            dbg.bytesReceived === 0
          ) {
            setStatusNote(
              "媒體通道卡住（DTLS/無影格），重置中…請保持手機相機頁開啟",
            );
            resetPeer();
          }
        } catch {
          /* ignore */
        }
      })();
    }, 6000);
    return () => {
      if (recoverTimer.current) clearInterval(recoverTimer.current);
    };
  }, [resetPeer]);

  useEffect(() => {
    return () => {
      resetPeer();
    };
  }, [resetPeer]);

  async function bumpScore() {
    setBusy(true);
    try {
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Score failed");
      setMatch((m) => ({ ...m, scores: data.scores, status: "PLAYING" }));
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : "Score failed");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      const res = await fetch(`/api/matches/${match.id}/start`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Start failed");
      setMatch(data.match);
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : "Start failed");
    } finally {
      setBusy(false);
    }
  }

  async function finish(winnerId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/matches/${match.id}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Finish failed");
      setMatch(data.match);
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : "Finish failed");
    } finally {
      setBusy(false);
    }
  }

  const camUrl = match.cameraToken
    ? `${appUrl}/cam/${match.cameraToken}`
    : "";

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 lg:grid-cols-2">
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">比賽房間</h1>
            <p className="text-sm text-zinc-400">
              房間碼{" "}
              <span className="font-mono text-lg tracking-widest text-emerald-400">
                {match.joinCode}
              </span>{" "}
              · {match.status}
              {connected ? " · 即時已連線" : " · 連線中…"}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">比分</h2>
          <div className="grid grid-cols-2 gap-4">
            <ScoreCard
              name={match.player1.username}
              score={scoreFor(match.player1Id)}
              self={match.player1Id === userId}
            />
            <ScoreCard
              name={match.player2?.username ?? "等待對手…"}
              score={match.player2Id ? scoreFor(match.player2Id) : 0}
              self={match.player2Id === userId}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || match.status === "FINISHED" || !match.player2Id}
              onClick={() => void bumpScore()}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-40"
            >
              我的分數 +1
            </button>
            {match.status === "READY" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void start()}
                className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white"
              >
                開始比賽
              </button>
            )}
          </div>
        </div>

        {match.player2Id && match.status !== "FINISHED" && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <h2 className="mb-2 text-sm font-medium text-zinc-400">結束比賽</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void finish(match.player1Id)}
                className="rounded-lg border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-900"
              >
                {match.player1.username} 獲勝
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void finish(match.player2Id!)}
                className="rounded-lg border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-900"
              >
                {match.player2?.username} 獲勝
              </button>
            </div>
          </div>
        )}

        {match.status === "FINISHED" && (
          <p className="rounded-xl bg-emerald-950/50 px-4 py-3 text-emerald-300">
            比賽結束。Winner ID: {match.winnerId}
          </p>
        )}

        {statusNote && <p className="text-sm text-amber-400">{statusNote}</p>}
      </section>

      <section className="flex flex-col gap-4">
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 text-sm text-zinc-400">
            <span>對手牌桌視訊{videoReady ? " · 播放中" : ""}</span>
            <button
              type="button"
              className="text-xs text-emerald-400 hover:underline"
              onClick={() => {
                setStatusNote("手動重置視訊，等待手機重新連線…");
                resetPeer();
              }}
            >
              重置視訊連線
            </button>
          </div>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            className="aspect-video w-full bg-zinc-950 object-contain"
            onClick={(e) => {
              void e.currentTarget.play().catch(() => undefined);
            }}
          />
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="mb-2 text-sm font-medium text-zinc-400">
            用手機掃描此 QR，當作你的牌桌攝影機
          </h2>
          <p className="mb-3 text-xs text-zinc-500">
            注意：你掃自己的 QR 後，畫面會出現在「對手」的桌機上，不是自己這台。
          </p>
          {camUrl ? (
            <CameraQr url={camUrl} />
          ) : (
            <p className="text-sm text-zinc-500">尚無 camera token</p>
          )}
        </div>
      </section>
    </div>
  );
}

function ScoreCard({
  name,
  score,
  self,
}: {
  name: string;
  score: number;
  self: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        self ? "border-emerald-700 bg-emerald-950/30" : "border-zinc-800"
      }`}
    >
      <p className="truncate text-sm text-zinc-400">
        {name}
        {self ? "（你）" : ""}
      </p>
      <p className="mt-1 text-4xl font-bold tabular-nums">{score}</p>
    </div>
  );
}
