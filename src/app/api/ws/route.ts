import {
  experimental_upgradeWebSocket,
  type WebSocketData,
} from "@vercel/functions";
import { getCameraSession, listRoomMessages, publishRoomMessage } from "@/lib/matches";
import type { RoomClientMessage, RoomServerMessage } from "@/lib/protocol";

export const maxDuration = 300;
export const runtime = "nodejs";

type WsClient = {
  readyState: number;
  send: (data: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};

type ClientMeta = {
  matchId: string;
  role: "desktop" | "camera";
  playerId: string;
};

const rooms = new Map<string, Set<WsClient>>();
const meta = new WeakMap<WsClient, ClientMeta>();

function broadcast(matchId: string, message: RoomServerMessage, except?: WsClient) {
  const set = rooms.get(matchId);
  if (!set) return;
  const raw = JSON.stringify(message);
  for (const client of set) {
    if (client === except) continue;
    if (client.readyState === 1) {
      client.send(raw);
    }
  }
}

function send(ws: WsClient, message: RoomServerMessage) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

export async function GET() {
  return experimental_upgradeWebSocket((rawWs) => {
    const ws = rawWs as unknown as WsClient;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let lastSeenId: string | undefined;

    ws.on("message", async (...args: unknown[]) => {
      const data = args[0] as WebSocketData;
      try {
        const text =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data.toString("utf8")
              : Array.isArray(data)
                ? Buffer.concat(data as Buffer[]).toString("utf8")
                : new TextDecoder().decode(data as ArrayBuffer);
        const msg = JSON.parse(text) as RoomClientMessage;

        if (msg.type === "PING") {
          send(ws, { type: "PONG" });
          return;
        }

        if (msg.type === "JOIN") {
          if (msg.role === "camera") {
            if (!msg.token) {
              send(ws, { type: "ERROR", message: "Camera token required" });
              return;
            }
            const session = await getCameraSession(msg.token);
            if (!session || session.playerId !== msg.playerId) {
              send(ws, { type: "ERROR", message: "Invalid camera token" });
              return;
            }
          }

          meta.set(ws, {
            matchId: msg.matchId,
            role: msg.role,
            playerId: msg.playerId,
          });

          let set = rooms.get(msg.matchId);
          if (!set) {
            set = new Set();
            rooms.set(msg.matchId, set);
          }
          set.add(ws);

          send(ws, {
            type: "JOINED",
            matchId: msg.matchId,
            role: msg.role,
          });

          if (pollTimer) clearInterval(pollTimer);
          pollTimer = setInterval(() => {
            void (async () => {
              try {
                const messages = await listRoomMessages(msg.matchId, lastSeenId);
                for (const row of messages) {
                  lastSeenId = row.id;
                  if (row.type === "SIGNAL") {
                    const payload = row.payload as RoomServerMessage;
                    if (
                      payload.type === "SIGNAL" &&
                      payload.toPlayerId === msg.playerId
                    ) {
                      send(ws, payload);
                    }
                  } else if (row.type === "SCORE_UPDATED") {
                    send(ws, {
                      type: "SCORE_UPDATED",
                      scores: (
                        row.payload as {
                          scores: { playerId: string; score: number }[];
                        }
                      ).scores,
                    });
                  } else if (row.type === "MATCH_UPDATED") {
                    send(ws, {
                      type: "MATCH_UPDATED",
                      status: (row.payload as { status: string }).status,
                    });
                  } else if (row.type === "MATCH_FINISHED") {
                    send(ws, {
                      type: "MATCH_FINISHED",
                      winnerId: (row.payload as { winnerId: string }).winnerId,
                    });
                  } else if (row.type === "PLAYER_JOINED") {
                    send(ws, {
                      type: "PLAYER_JOINED",
                      player2Id: (row.payload as { player2Id: string }).player2Id,
                    });
                  }
                }
              } catch {
                /* ignore poll errors */
              }
            })();
          }, 700);

          return;
        }

        if (msg.type === "SIGNAL") {
          const info = meta.get(ws);
          if (!info) {
            send(ws, { type: "ERROR", message: "Join first" });
            return;
          }

          const out: RoomServerMessage = {
            type: "SIGNAL",
            matchId: msg.matchId,
            fromPlayerId: msg.fromPlayerId,
            toPlayerId: msg.toPlayerId,
            fromRole: msg.fromRole,
            signal: msg.signal,
          };

          await publishRoomMessage(msg.matchId, "SIGNAL", out);
          broadcast(msg.matchId, out, ws);
        }
      } catch (err) {
        send(ws, {
          type: "ERROR",
          message: err instanceof Error ? err.message : "Bad message",
        });
      }
    });

    ws.on("close", () => {
      if (pollTimer) clearInterval(pollTimer);
      const info = meta.get(ws);
      if (info) {
        const set = rooms.get(info.matchId);
        set?.delete(ws);
        if (set && set.size === 0) rooms.delete(info.matchId);
      }
    });
  });
}
