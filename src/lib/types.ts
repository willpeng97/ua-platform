export type MatchDetail = {
  id: string;
  joinCode: string;
  status: "WAITING" | "READY" | "PLAYING" | "FINISHED";
  player1Id: string;
  player2Id: string | null;
  winnerId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  player1: { id: string; username: string; avatar: string | null };
  player2: { id: string; username: string; avatar: string | null } | null;
  scores: { playerId: string; score: number }[];
  cameraToken: string | null;
};
