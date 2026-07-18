"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomClientMessage, RoomServerMessage } from "@/lib/protocol";

type Options = {
  matchId: string;
  role: "desktop" | "camera";
  playerId: string;
  token?: string;
  enabled?: boolean;
  onMessage: (msg: RoomServerMessage) => void;
};

function wsUrl() {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
}

export function useRoomSocket({
  matchId,
  role,
  playerId,
  token,
  enabled = true,
  onMessage,
}: Options) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const lastPollId = useRef<string | undefined>(undefined);
  const usePolling = useRef(false);
  const pollBootstrapped = useRef(false);

  const send = useCallback((msg: RoomClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const publishSignal = useCallback(
    async (msg: Extract<RoomClientMessage, { type: "SIGNAL" }>) => {
      if (send(msg)) return true;
      await fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...msg, token }),
      });
      return true;
    },
    [send, token],
  );

  useEffect(() => {
    if (!enabled || !matchId || !playerId) return;

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let delay = 1000;
    lastPollId.current = undefined;
    pollBootstrapped.current = false;

    async function poll() {
      try {
        const qs = new URLSearchParams({ matchId });
        if (lastPollId.current) qs.set("after", lastPollId.current);
        const res = await fetch(`/api/room-messages?${qs}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          messages: {
            id: string;
            type: string;
            payload: unknown;
          }[];
        };

        // First poll: only advance cursor, don't replay historical SIGNAL storms
        if (!pollBootstrapped.current) {
          pollBootstrapped.current = true;
          if (data.messages.length > 0) {
            lastPollId.current = data.messages[data.messages.length - 1].id;
          }
          return;
        }

        for (const m of data.messages) {
          lastPollId.current = m.id;
          if (m.type === "SIGNAL") {
            onMessageRef.current(m.payload as RoomServerMessage);
          } else if (m.type === "SCORE_UPDATED") {
            onMessageRef.current({
              type: "SCORE_UPDATED",
              scores: (m.payload as { scores: { playerId: string; score: number }[] })
                .scores,
            });
          } else if (m.type === "MATCH_UPDATED") {
            onMessageRef.current({
              type: "MATCH_UPDATED",
              status: (m.payload as { status: string }).status,
            });
          } else if (m.type === "MATCH_FINISHED") {
            onMessageRef.current({
              type: "MATCH_FINISHED",
              winnerId: (m.payload as { winnerId: string }).winnerId,
            });
          } else if (m.type === "PLAYER_JOINED") {
            onMessageRef.current({
              type: "PLAYER_JOINED",
              player2Id: (m.payload as { player2Id: string }).player2Id,
            });
          } else {
            onMessageRef.current({
              type: "EVENT",
              eventType: m.type,
              payload: m.payload,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    function startPolling() {
      usePolling.current = true;
      setConnected(true);
      if (pollTimer) clearInterval(pollTimer);
      void poll();
      pollTimer = setInterval(() => void poll(), 800);
    }

    function connect() {
      if (cancelled) return;
      try {
        const ws = new WebSocket(wsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          delay = 1000;
          setConnected(true);
          usePolling.current = false;
          ws.send(
            JSON.stringify({
              type: "JOIN",
              matchId,
              role,
              playerId,
              token,
            } satisfies RoomClientMessage),
          );
        };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as RoomServerMessage;
            onMessageRef.current(msg);
          } catch {
            /* ignore */
          }
        };

        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          // Local next dev may not support WS upgrade — fall back to polling
          startPolling();
          reconnectTimer = setTimeout(() => {
            if (!cancelled && usePolling.current) {
              // keep polling; also retry WS occasionally
              connect();
            }
          }, delay);
          delay = Math.min(delay * 2, 15000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        startPolling();
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
      wsRef.current?.close();
    };
  }, [enabled, matchId, playerId, role, token]);

  return { connected, send, publishSignal };
}
