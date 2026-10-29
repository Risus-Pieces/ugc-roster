import "server-only";
import { inArray } from "drizzle-orm";
import { db, creatorAccounts, posts } from "@/db";
import { foodFit, type FoodFit } from "@/lib/engines/food-fit";

/** Food creator or not, for each creator, from their name, handles, bios and captions. */
export async function foodFitFor(list: { id: string; name: string }[]): Promise<Map<string, FoodFit>> {
  const ids = list.map((c) => c.id);
  if (!ids.length) return new Map();
  const [accts, caps] = await Promise.all([
    db.select({ creatorId: creatorAccounts.creatorId, handle: creatorAccounts.handle, bio: creatorAccounts.bio }).from(creatorAccounts).where(inArray(creatorAccounts.creatorId, ids)),
    db.select({ creatorId: posts.creatorId, caption: posts.caption }).from(posts).where(inArray(posts.creatorId, ids)),
  ]);
  const fits = new Map<string, FoodFit>();
  for (const c of list) {
    const a = accts.filter((x) => x.creatorId === c.id);
    fits.set(
      c.id,
      foodFit({
        name: c.name,
        handles: a.map((x) => x.handle),
        bios: a.map((x) => x.bio ?? "").filter(Boolean),
        captions: caps.filter((x) => x.creatorId === c.id && x.caption).map((x) => x.caption!),
      }),
    );
  }
  return fits;
}
