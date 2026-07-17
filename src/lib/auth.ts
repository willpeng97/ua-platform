import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export async function requireUserId() {
  const { userId } = await auth();
  if (!userId) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return userId;
}

export async function ensureUser() {
  const userId = await requireUserId();
  const clerkUser = await currentUser();
  if (!clerkUser) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const db = getDb();
  const existing = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  const username =
    clerkUser.username ||
    clerkUser.firstName ||
    clerkUser.emailAddresses[0]?.emailAddress?.split("@")[0] ||
    "Player";
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? null;
  const avatar = clerkUser.imageUrl ?? null;

  if (existing.length === 0) {
    await db.insert(users).values({
      id: userId,
      username,
      email,
      avatar,
    });
  } else {
    await db
      .update(users)
      .set({ username, email, avatar })
      .where(eq(users.id, userId));
  }

  return { userId, username, email, avatar };
}
