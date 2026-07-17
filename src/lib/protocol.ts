export type RoomClientMessage =
  | {
      type: "JOIN";
      matchId: string;
      role: "desktop" | "camera";
      playerId: string;
      token?: string;
    }
  | {
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
    }
  | {
      type: "PING";
    };

export type RoomServerMessage =
  | { type: "JOINED"; matchId: string; role: string }
  | { type: "ERROR"; message: string }
  | {
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
    }
  | { type: "SCORE_UPDATED"; scores: { playerId: string; score: number }[] }
  | { type: "MATCH_UPDATED"; status: string }
  | { type: "MATCH_FINISHED"; winnerId: string }
  | { type: "PLAYER_JOINED"; player2Id: string }
  | { type: "PONG" }
  | { type: "EVENT"; eventType: string; payload: unknown };
