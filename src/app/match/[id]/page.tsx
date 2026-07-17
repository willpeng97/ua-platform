import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { MatchRoom } from "@/components/match-room";
import { ensureUser } from "@/lib/auth";
import { getMatchDetail } from "@/lib/matches";

type Props = { params: Promise<{ id: string }> };

export default async function MatchPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  await ensureUser();
  const { id } = await params;
  const match = await getMatchDetail(id, userId);
  if (!match) {
    return (
      <div className="px-4 py-16 text-center text-zinc-400">找不到比賽</div>
    );
  }
  if (match.player1Id !== userId && match.player2Id !== userId) {
    return (
      <div className="px-4 py-16 text-center text-zinc-400">你不是此房間成員</div>
    );
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";

  return (
    <MatchRoom initialMatch={match} userId={userId} appUrl={appUrl} />
  );
}
