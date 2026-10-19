import type { Platform } from "@/db/schema";
import type { DiscoveredCreator, DiscoveredPost, DiscoveryProvider, SearchOptions } from "./types";

/** Seeded PRNG (mulberry32) so demo data is stable for a given keyword. */
export function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = (h << 13) | (h >>> 19);
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    /** Log-normal around `median` with spread sigma. */
    logNormal: (median: number, sigma: number) => {
      const u = Math.max(1e-9, next());
      const v = next();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return median * Math.exp(sigma * z);
    },
  };
}

const FIRST = ["Maya", "Jordan", "Priya", "Leo", "Sofia", "Ethan", "Aisha", "Noah", "Chloe", "Diego", "Hana", "Marcus", "Zoe", "Kai", "Lena", "Omar", "Isla", "Theo", "Nina", "Ravi", "Emma", "Luca", "Amara", "Finn", "Tessa", "Jae", "Rosa", "Eli", "Mila", "Sam"];
const LAST = ["Chen", "Okafor", "Patel", "Rossi", "Garcia", "Kim", "Nguyen", "Brooks", "Silva", "Haddad", "Novak", "Reyes", "Turner", "Sato", "Ali", "Moreau", "Walsh", "Costa", "Berg", "Shah"];
const COUNTRIES = ["US", "US", "US", "US", "US", "GB", "CA", "AU", "IE", "DE", "PH", "NG"];
const GOOD_COMMENTS = [
  "wait which app is this?",
  "ok I need to try this for my lunches",
  "how accurate is it with mixed dishes?",
  "the way you plated that 😂",
  "saving this for meal prep sunday",
  "does it work with homemade stuff?",
  "I've been counting by hand like a caveman",
  "your kitchen is so cozy",
  "can you do one with a burrito bowl next?",
  "this is the content I needed today",
  "what's the macro split on that?",
  "lol the cat in the background",
  "trying this tonight with my stir fry",
  "where's the bowl from??",
];
const BOT_COMMENTS = ["nice", "🔥🔥", "great post", "follow me back", "nice", "wow", "cool", "check my page", "🔥🔥", "nice", "amazing", "😍😍"];

const HOOKS = [
  "POV: you finally stop guessing your calories",
  "I ate 2,000 calories and this is what it looked like",
  "Stop counting calories like this",
  "What I eat in a day as a {niche} girlie",
  "Rating viral {niche} hacks so you don't have to",
  "The lazy way to hit your protein goal",
  "I tried tracking every meal for a week",
  "Things nobody tells you about {niche}",
  "3 meals under 500 calories that actually fill you up",
  "Reacting to my followers' grocery hauls",
  "This is your sign to start meal prepping",
  "I asked strangers to guess the calories in my lunch",
];

function captionFor(r: ReturnType<typeof rng>, niche: string) {
  return r.pick(HOOKS).replace("{niche}", niche) + " " + r.pick(["#mealprep", "#caloriecounting", "#healthyeating", "#whatieatinaday", "#fitnessjourney", "#highprotein"]);
}

export function demoPosts(r: ReturnType<typeof rng>, opts: { followers: number; ratio: number; er: number; count: number; bot: boolean; niche: string; platform: Platform; handle: string; now?: Date }): DiscoveredPost[] {
  const now = opts.now ?? new Date();
  const posts: DiscoveredPost[] = [];
  const typical = Math.max(150, opts.followers * opts.ratio);
  for (let i = 0; i < opts.count; i++) {
    const viral = !opts.bot && r.next() < 0.05;
    const views = Math.round(opts.bot ? typical * (0.95 + r.next() * 0.1) : r.logNormal(typical, 0.55) * (viral ? r.int(15, 60) : 1));
    const er = opts.er * (0.7 + r.next() * 0.6);
    const caption = captionFor(r, opts.niche);
    const pool = [...GOOD_COMMENTS].sort(() => r.next() - 0.5);
    const comments = Array.from({ length: 8 }, (_, k) => (opts.bot ? r.pick(BOT_COMMENTS) : r.next() < 0.2 ? r.pick(BOT_COMMENTS) : pool[k % pool.length]));
    posts.push({
      externalId: `${opts.platform}_${opts.handle}_${i}`,
      url: opts.platform === "youtube" ? `https://youtube.com/shorts/${opts.handle}${i}` : opts.platform === "tiktok" ? `https://www.tiktok.com/@${opts.handle}/video/${1000 + i}` : `https://instagram.com/reel/${opts.handle}${i}`,
      caption,
      transcript: caption.replace(/#\w+/g, "").trim() + ". So here's the thing — I used to just eyeball everything and wonder why nothing changed.",
      postedAt: new Date(now.getTime() - (i * 1.6 + r.next()) * 86_400_000 - 4 * 86_400_000),
      views,
      likes: Math.round(views * er * 0.86),
      comments: Math.round(views * er * (opts.bot ? 0.01 : 0.08)),
      shares: Math.round(views * er * 0.04),
      saves: Math.round(views * er * 0.05),
      sampleComments: comments,
    });
  }
  return posts;
}

function demoCreator(platform: Platform, keyword: string, i: number, opts: SearchOptions): DiscoveredCreator {
  const r = rng(`${platform}:${keyword}:${i}`);
  const first = r.pick(FIRST);
  const last = r.pick(LAST);
  const handle = `${first}${r.pick(["eats", "cooks", "fit", "", ".kitchen", "_daily", "makes"])}${r.int(1, 99)}`.toLowerCase().replace(/[^a-z0-9._]/g, "");
  // ~15% are outside the follower band so the filter has something to do.
  const inBand = r.next() > 0.15;
  const followers = inBand ? Math.round(Math.exp(Math.log(opts.minFollowers) + r.next() * (Math.log(opts.maxFollowers) - Math.log(opts.minFollowers)))) : r.pick([r.int(300, 1800), r.int(25_000, 120_000)]);
  const bot = r.next() < 0.12;
  const ratio = bot ? 0.012 : r.logNormal(0.45, 0.6);
  const er = bot ? 0.006 : r.logNormal(0.065, 0.35);
  const emailStyle = r.next();
  const domain = r.pick(["gmail.com", "gmail.com", "outlook.com", "icloud.com"]);
  const email =
    emailStyle < 0.45 ? `📩 ${handle.replace(/\./g, "")}@${domain}` : emailStyle < 0.65 ? `collabs: ${first.toLowerCase()} [at] ${domain.replace(".", " [dot] ")}` : emailStyle < 0.75 ? `business: ${first.toLowerCase()}@${handle.replace(/[._]/g, "")}.co` : "";
  const bio = `${r.pick(["🥗", "🍳", "💪", "🌱"])} ${keyword} + real food | ${r.pick(["NYC", "London", "Austin", "Toronto", "Sydney", "LA"])} ${email ? "| " + email : ""}`.trim();
  return {
    platform,
    handle,
    platformUserId: `demo_${platform}_${handle}`,
    name: `${first} ${last}`,
    bio,
    followers,
    url: platform === "youtube" ? `https://youtube.com/@${handle}` : platform === "tiktok" ? `https://www.tiktok.com/@${handle}` : `https://instagram.com/${handle}`,
    country: r.pick(COUNTRIES),
    posts: demoPosts(r, { followers, ratio, er, count: r.int(18, 30), bot, niche: keyword, platform, handle }),
  };
}

export const demoDiscovery = (platform: Platform): DiscoveryProvider => ({
  platform,
  name: "Demo data",
  live: false,
  async search(keyword, opts) {
    return Array.from({ length: opts.limit }, (_, i) => demoCreator(platform, keyword.toLowerCase().trim(), i, opts));
  },
});

/**
 * Simulated platform sync for demo-connected accounts: views follow a saturating curve
 * by age, so day-1/7/14 snapshots look realistic.
 */
export function simulateGrowth(p: { externalId: string; postedAt: Date; views: number }, lastCountedAt: Date, now = new Date()) {
  const r = rng(p.externalId);
  const share = (age: number) => 1 - Math.exp(-Math.max(0, age) / 2.5);
  const ageDays = (now.getTime() - p.postedAt.getTime()) / 86_400_000;
  // Continue the same saturating curve from when the stored count was taken.
  const prevAge = (Math.max(lastCountedAt.getTime(), p.postedAt.getTime()) - p.postedAt.getTime()) / 86_400_000;
  const prevShare = Math.max(0.05, share(prevAge));
  const finalViews = p.views > 0 ? p.views / prevShare : Math.round(r.logNormal(4000, 0.7));
  const views = Math.max(p.views, Math.round(finalViews * share(ageDays)));
  const er = r.logNormal(0.06, 0.3);
  const botty = r.next() < 0.06;
  return {
    views,
    likes: Math.round(views * er * (botty ? 0.15 : 0.86)),
    comments: Math.round(views * er * 0.07),
    shares: Math.round(views * er * 0.04),
    saves: Math.round(views * er * 0.05),
    paidViews: r.next() < 0.08 ? Math.round(views * 0.3) : 0,
  };
}
