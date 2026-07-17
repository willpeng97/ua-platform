import { and, asc, eq, gt, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getDb } from "@/db";
import {
  cameraTokens,
  matchEvents,
  matchScores,
  matches,
  roomMessages,
  users,
} from "@/db/schema";
import type { MatchDetail } from "@/lib/types";

export type { MatchDetail };

const joinCodeAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const tokenAlphabet = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  24,
);

export async function createMatch(player1Id: string) {
  const db = getDb();
  const joinCode = joinCodeAlphabet();
  const [match] = await db
    .insert(matches)
    .values({
      joinCode,
      player1Id,
      status: "WAITING",
    })
    .returning();

  await db.insert(matchScores).values({
    matchId: match.id,
    playerId: player1Id,
    score: 0,
  });

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const token = tokenAlphabet();
  await db.insert(cameraTokens).values({
    token,
    matchId: match.id,
    playerId: player1Id,
    expiresAt,
  });

  await db.insert(matchEvents).values({
    matchId: match.id,
    playerId: player1Id,
    action: "MATCH_CREATED",
  });

  return { match, cameraToken: token };
}

export async function joinMatch(joinCode: string, player2Id: string) {
  const db = getDb();
  const code = joinCode.trim().toUpperCase();
  const found = await db
    .select()
    .from(matches)
    .where(eq(matches.joinCode, code))
    .limit(1);

  if (found.length === 0) {
    throw new Response("Match not found", { status: 404 });
  }

  const match = found[0];

  if (match.player1Id === player2Id) {
    return match;
  }

  if (match.player2Id && match.player2Id !== player2Id) {
    throw new Response("Match is full", { status: 409 });
  }

  if (match.status === "FINISHED") {
    throw new Response("Match already finished", { status: 409 });
  }

  if (!match.player2Id) {
    const [updated] = await db
      .update(matches)
      .set({ player2Id, status: "READY" })
      .where(eq(matches.id, match.id))
      .returning();

    await db.insert(matchScores).values({
      matchId: match.id,
      playerId: player2Id,
      score: 0,
    });

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const token = tokenAlphabet();
    await db.insert(cameraTokens).values({
      token,
      matchId: match.id,
      playerId: player2Id,
      expiresAt,
    });

    await db.insert(matchEvents).values({
      matchId: match.id,
      playerId: player2Id,
      action: "PLAYER_JOINED",
    });

    await publishRoomMessage(match.id, "PLAYER_JOINED", {
      player2Id,
    });

    return updated;
  }

  return match;
}

export async function startMatch(matchId: string, userId: string) {
  const db = getDb();
  const match = await getMatchRow(matchId);
  if (!match) throw new Response("Not found", { status: 404 });
  if (match.player1Id !== userId && match.player2Id !== userId) {
    throw new Response("Forbidden", { status: 403 });
  }
  if (match.status !== "READY" && match.status !== "WAITING") {
    return match;
  }
  if (!match.player2Id) {
    throw new Response("Need two players", { status: 400 });
  }

  const [updated] = await db
    .update(matches)
    .set({ status: "PLAYING", startedAt: new Date() })
    .where(eq(matches.id, matchId))
    .returning();

  await db.insert(matchEvents).values({
    matchId,
    playerId: userId,
    action: "MATCH_STARTED",
  });

  await publishRoomMessage(matchId, "MATCH_UPDATED", { status: "PLAYING" });
  return updated;
}

export async function finishMatch(
  matchId: string,
  userId: string,
  winnerId: string,
) {
  const db = getDb();
  const match = await getMatchRow(matchId);
  if (!match) throw new Response("Not found", { status: 404 });
  if (match.player1Id !== userId && match.player2Id !== userId) {
    throw new Response("Forbidden", { status: 403 });
  }
  if (winnerId !== match.player1Id && winnerId !== match.player2Id) {
    throw new Response("Invalid winner", { status: 400 });
  }

  const [updated] = await db
    .update(matches)
    .set({
      status: "FINISHED",
      winnerId,
      endedAt: new Date(),
    })
    .where(eq(matches.id, matchId))
    .returning();

  await db.insert(matchEvents).values({
    matchId,
    playerId: userId,
    action: "MATCH_FINISHED",
    payload: { winnerId },
  });

  await publishRoomMessage(matchId, "MATCH_FINISHED", { winnerId });
  return updated;
}

export async function incrementScore(matchId: string, userId: string) {
  const db = getDb();
  const match = await getMatchRow(matchId);
  if (!match) throw new Response("Not found", { status: 404 });
  if (match.player1Id !== userId && match.player2Id !== userId) {
    throw new Response("Forbidden", { status: 403 });
  }
  if (match.status === "FINISHED") {
    throw new Response("Match finished", { status: 409 });
  }
  if (match.status === "WAITING" || match.status === "READY") {
    await db
      .update(matches)
      .set({ status: "PLAYING", startedAt: new Date() })
      .where(eq(matches.id, matchId));
  }

  await db
    .update(matchScores)
    .set({
      score: sql`${matchScores.score} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(matchScores.matchId, matchId), eq(matchScores.playerId, userId)),
    );

  await db.insert(matchEvents).values({
    matchId,
    playerId: userId,
    action: "SCORE_UPDATE",
    payload: { delta: 1 },
  });

  const scores = await db
    .select({
      playerId: matchScores.playerId,
      score: matchScores.score,
    })
    .from(matchScores)
    .where(eq(matchScores.matchId, matchId));

  await publishRoomMessage(matchId, "SCORE_UPDATED", { scores });
  return scores;
}

export async function getMatchDetail(
  matchId: string,
  viewerId?: string,
): Promise<MatchDetail | null> {
  const db = getDb();
  const rows = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (rows.length === 0) return null;
  const match = rows[0];

  const [p1] = await db.select().from(users).where(eq(users.id, match.player1Id)).limit(1);
  let p2 = null;
  if (match.player2Id) {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, match.player2Id))
      .limit(1);
    p2 = row ?? null;
  }

  const scores = await db
    .select({
      playerId: matchScores.playerId,
      score: matchScores.score,
    })
    .from(matchScores)
    .where(eq(matchScores.matchId, matchId));

  let cameraToken: string | null = null;
  if (viewerId && (viewerId === match.player1Id || viewerId === match.player2Id)) {
    const tokens = await db
      .select()
      .from(cameraTokens)
      .where(
        and(
          eq(cameraTokens.matchId, matchId),
          eq(cameraTokens.playerId, viewerId),
        ),
      )
      .limit(1);
    cameraToken = tokens[0]?.token ?? null;
  }

  return {
    id: match.id,
    joinCode: match.joinCode,
    status: match.status,
    player1Id: match.player1Id,
    player2Id: match.player2Id,
    winnerId: match.winnerId,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    player1: {
      id: p1.id,
      username: p1.username,
      avatar: p1.avatar,
    },
    player2: p2
      ? { id: p2.id, username: p2.username, avatar: p2.avatar }
      : null,
    scores,
    cameraToken,
  };
}

export async function getCameraSession(token: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(cameraTokens)
    .where(eq(cameraTokens.token, token))
    .limit(1);
  if (rows.length === 0) return null;
  const cam = rows[0];
  if (cam.expiresAt.getTime() < Date.now()) return null;

  const match = await getMatchRow(cam.matchId);
  if (!match) return null;

  return {
    token: cam.token,
    matchId: cam.matchId,
    playerId: cam.playerId,
    opponentId:
      match.player1Id === cam.playerId ? match.player2Id : match.player1Id,
    status: match.status,
  };
}

async function getMatchRow(matchId: string) {
  const db = getDb();
  const rows = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  return rows[0] ?? null;
}

export async function publishRoomMessage(
  matchId: string,
  type: string,
  payload: unknown,
) {
  const db = getDb();
  const [row] = await db
    .insert(roomMessages)
    .values({
      matchId,
      type,
      payload,
    })
    .returning();
  return row;
}

export async function listRoomMessages(matchId: string, afterId?: string) {
  const db = getDb();
  if (afterId) {
    const afterRows = await db
      .select()
      .from(roomMessages)
      .where(eq(roomMessages.id, afterId))
      .limit(1);
    const after = afterRows[0];
    if (after) {
      return db
        .select()
        .from(roomMessages)
        .where(
          and(
            eq(roomMessages.matchId, matchId),
            gt(roomMessages.createdAt, after.createdAt),
          ),
        )
        .orderBy(asc(roomMessages.createdAt))
        .limit(100);
    }
  }
  return db
    .select()
    .from(roomMessages)
    .where(eq(roomMessages.matchId, matchId))
    .orderBy(asc(roomMessages.createdAt))
    .limit(100);
}
