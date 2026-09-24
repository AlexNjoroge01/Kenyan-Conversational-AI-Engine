import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users, type NewUser, type User } from "../db/schema";

export const userRepository = {
  async findByEmail(email: string): Promise<User | undefined> {
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  },

  async findById(id: string): Promise<User | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  },

  /** Returns undefined if the email is already taken (unique violation), instead of throwing. */
  async create(values: Pick<NewUser, "email" | "passwordHash">): Promise<User | undefined> {
    const [row] = await db.insert(users).values(values).onConflictDoNothing({ target: users.email }).returning();
    return row;
  },
};
