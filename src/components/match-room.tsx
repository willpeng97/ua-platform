"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraQr } from "@/components/camera-qr";
import type { MatchDetail } from "@/lib/types";
import type { RoomServerMessage } from "@/lib/protocol";
import { useRoomSocket } from "@/lib/use-room-socket";
import { createPeerConnection, fetchIceServers } from "@/lib/webrtc";

type Props = {
  initialMatch: MatchDetail;
  userId: string;
  appUrl: string;
};

export function MatchRoom({ initialMatch, userId, appUrl }: Props) {
  const [match, setMatch] = useState(initialMatch);
  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState("");
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const makingOffer = useRef(false);

  const opponentId =
    match.player1Id === userId ? match.player2Id : match.player1Id;

  const scoreFor = (pid: string) =>
    match.scores.find((s) => s.playerId === pid)?.score ?? 0;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/matches/${match.id}`);
    if (!res.ok) return;
    const data = await res.json();
    setMatch(data.match);
  }, [match.id]);

  const ensurePc = useCallback(async () => {
    if (pcRef.current) return pcRef.current;
    const iceServers = await fetchIceServers();
    const pc = createPeerConnection(iceServers);
    pcRef.current = pc;

    pc.ontrack = (ev) => {
      const el = remoteVideoRef.current;
      if (el) {
        el.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
      }
    };

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !opponentId) return;
      void publishSignalRef.current({
        type: "SIGNAL",
        matchId: match.id,
        fromPlayerId: userId,
        toPlayerId: opponentId,
        fromRole: "desktop",
        signal: { kind: "ice", candidate: ev.candidate.toJSON() },
      });
    };

    return pc;
  }, [match.id, opponentId, userId]);

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

  const onMessage = useCallback(
    async (msg: RoomServerMessage) => {
      if (msg.type === "SCORE_UPDATED") {
        setMatch((m) => ({ ...m, scores: msg.scores }));
      } else if (msg.type === "MATCH_UPDATED") {
        setMatch((m) => ({
          ...m,
          status: msg.status as MatchDetail["status"],
        }));
        void refresh();
      } else if (msg.type === "MATCH_FINISHED") {
        setMatch((m) => ({
          ...m,
          status: "FINISHED",
          winnerId: msg.winnerId,
        }));
        void refresh();
      } else if (msg.type === "PLAYER_JOINED") {
        void refresh();
      } else if (msg.type === "SIGNAL" && msg.toPlayerId === userId) {
        // Receive stream from opponent's camera (fromRole === camera)
        // or handle answer from... actually desktop only receives from opponent camera
        if (msg.fromRole !== "camera") return;
        if (!opponentId || msg.fromPlayerId !== opponentId) return;

        const pc = await ensurePc();
        const { signal } = msg;

        try {
          if (signal.kind === "offer" && signal.sdp) {
            await pc.setRemoteDescription(signal.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await publishSignalRef.current({
              type: "SIGNAL",
              matchId: match.id,
              fromPlayerId: userId,
              toPlayerId: opponentId,
              fromRole: "desktop",
              signal: { kind: "answer", sdp: answer },
            });
            setStatusNote("已收到對手攝影機連線");
          } else if (signal.kind === "answer" && signal.sdp) {
            if (!makingOffer.current) {
              await pc.setRemoteDescription(signal.sdp);
            }
          } else if (signal.kind === "ice" && signal.candidate) {
            try {
              await pc.addIceCandidate(signal.candidate);
            } catch {
              /* ignore */
            }
          }
        } catch (err) {
          console.error("desktop signal error", err);
        }
      }
    },
    [ensurePc, match.id, opponentId, refresh, userId],
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

  useEffect(() => {
    return () => {
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, []);

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
      const res = await fetch(`/api/matches/${match.id}/start`, { method: "POST" });
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
          <div className="border-b border-zinc-800 px-3 py-2 text-sm text-zinc-400">
            對手牌桌視訊
          </div>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="aspect-video w-full bg-zinc-950 object-contain"
          />
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="mb-2 text-sm font-medium text-zinc-400">
            用手機掃描此 QR，當作你的牌桌攝影機
          </h2>
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
