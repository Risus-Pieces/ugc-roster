/**
 * Demo data. Run with: pnpm db:reset
 * Uses the demo discovery provider (no API keys needed) and simulates 45 days of activity.
 */
delete process.env.YOUTUBE_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;

import { eq, inArray } from "drizzle-orm";
import { db, pool, creators, creatorAccounts, posts, postSnapshots, messages, reviews, appMetrics, attributionEvents, referrals, calls, contracts, taxForms, statements, campaigns } from "./index";
import { createCampaign, runDiscovery } from "@/lib/services/discovery";
import { defaultRateCard, latestScores } from "@/lib/services/common";
import { generateContract, requestTaxForm } from "@/lib/services/onboarding";
import { addCompetitorPost, refreshHookBank, createBreakout, generateDailyBriefs } from "@/lib/services/creative";
import { submitForReview } from "@/lib/services/review";
import { generateStatements, approveStatement, payStatement } from "@/lib/services/payouts";
import { credibleViews } from "@/lib/engines/view-quality";
import { runComplianceChecks, overallStatus } from "@/lib/engines/compliance";
import { rng } from "@/lib/integrations/platforms/demo";
import type { PgTable } from "drizzle-orm/pg-core";
import { encrypt } from "@/lib/integrations/crypto";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.now();
const r = rng("seed-v1");

const CAMPAIGN_HOOKS = [
  "POV: you snap your lunch and it just tells you the macros",
  "I stopped weighing my food and here's what happened",
  "Guess the calories in this burrito bowl",
  "Rating my meals by how fast I can log them",
  "Things I wish I knew before counting calories",
  "My lazy girl tracking routine",
  "Nobody talks about how annoying calorie apps are… except this one",
  "What 1,800 calories looks like at a food court",
  "Testing the photo calorie thing on my mom's cooking",
  "Day 5 of logging every single bite",
];
const FORMATS = ["POV skit", "Talking head", "Green screen reaction", "Guess the calories", "Day in my life", "Street interview"];

/** One multi-row INSERT per batch keeps the seed fast over a network connection. */
async function insertInBatches<T extends PgTable>(table: T, rows: T["$inferInsert"][], size = 500) {
  for (let i = 0; i < rows.length; i += size) await db.insert(table).values(rows.slice(i, i + size));
}

async function main() {
  const existing = await db.$count(creators);
  if (existing > 0 && !process.argv.includes("--force")) {
    console.error(`The database already has ${existing} creators. Seeding adds demo data on top; run \`pnpm db:reset --yes\` to start fresh, or pass --force.`);
    process.exit(1);
  }
  console.log("→ rate card + campaign");
  const card = await defaultRateCard();
  const campaign = await createCampaign({ name: "Calorie tracking — Q4", niche: "fitness food", keywords: ["calorie counting", "meal prep", "high protein"], platforms: ["tiktok", "instagram", "youtube"] });
  await createCampaign({ name: "Busy parents — pilot", niche: "family meals", keywords: ["family dinner ideas"], platforms: ["tiktok"] });

  console.log("→ discovery (demo provider)");
  const run = await runDiscovery(campaign.id, { perKeyword: 14 });
  console.log("  ", run);
  const pilot = (await db.select().from(campaigns)).find((c) => c.name.startsWith("Busy"))!;
  await runDiscovery(pilot.id, { perKeyword: 10 });

  // ── Roster ──────────────────────────────────────────────────────────────
  const scores = await latestScores();
  const pool = (await db.select().from(creators)).filter((c) => c.email && scores.get(c.id)?.authenticityVerdict === "pass");
  pool.sort((a, b) => (scores.get(b.id)?.medianViews ?? 0) - (scores.get(a.id)?.medianViews ?? 0));
  const pickN = (n: number) => pool.splice(0, n);
  // Interleave so actives span good and mediocre performers
  const active = [...pickN(4), ...pool.splice(6, 8)];
  const trial = pickN(4);
  const cut = pickN(2);
  const replied = pickN(4);
  const contacted = pickN(8);

  console.log(`→ roster: ${active.length} active, ${trial.length} trial, ${replied.length} replied, ${contacted.length} contacted, ${cut.length} cut`);
  const setStage = async (list: typeof active, stage: "active" | "trial" | "cut" | "replied" | "contacted", ageDays: () => number) => {
    for (const c of list) {
      const access = new Date(now - ageDays() * DAY);
      await db
        .update(creators)
        .set({
          stage,
          stageChangedAt: access,
          productAccessAt: ["active", "trial", "cut"].includes(stage) ? access : null,
          warmupStartedAt: ["active", "trial", "cut"].includes(stage) ? access : null,
          promoCode: ["active", "trial", "cut"].includes(stage) ? c.name.split(" ")[0].toUpperCase() + c.referralCode.slice(0, 2) : null,
          rateCardId: card.id,
          payoutProvider: ["active", "cut"].includes(stage) ? r.pick(["wise", "paypal", "stripe"] as const) : null,
          payoutDestination: ["active", "cut"].includes(stage) ? c.email : null,
        })
        .where(eq(creators.id, c.id));
    }
  };
  await setStage(active, "active", () => r.int(40, 50));
  await setStage(trial, "trial", () => r.int(2, 9));
  await setStage(cut, "cut", () => r.int(35, 45));
  await setStage(replied, "replied", () => r.int(1, 4));
  await setStage(contacted, "contacted", () => r.int(1, 6));
  const fresh = new Map((await db.select().from(creators)).map((c) => [c.id, c]));
  for (const list of [active, trial, cut, replied, contacted]) list.forEach((c, i) => (list[i] = fresh.get(c.id)!));

  // Outreach history
  const brandSig = "Alex";
  for (const c of [...active, ...trial, ...cut, ...replied, ...contacted]) {
    const sent = new Date(now - r.int(8, 55) * DAY);
    await db.insert(messages).values({
      creatorId: c.id,
      campaignId: campaign.id,
      direction: "out",
      subject: "Paid video collab with Snapcal",
      body: `Hi ${c.name.split(" ")[0]},\n\nLoved your meal prep video — the way you laid out the containers was so satisfying.\n\nWe pay $25 per video plus $1 per 1,000 views. Snapcal counts calories from a photo of your meal.\n\nWant me to send over a sample brief?\n\n${brandSig}`,
      status: "simulated",
      sentAt: sent,
      createdAt: sent,
    });
  }
  const replies: [string, "interested" | "rates" | "not_interested" | "other", string][] = [
    ["Hey! Yes I'd love to try this, sounds fun. What are next steps?", "interested", ""],
    ["Thanks for reaching out. What's the rate per video? I usually charge $150 for a dedicated TikTok.", "rates", ""],
    ["Sounds interesting — is the $1 per 1K views on top of the base? And how long do views count?", "rates", ""],
    ["I'm down! Can you send the brief?", "interested", ""],
  ];
  for (const [i, c] of replied.entries()) {
    const [text, label] = replies[i % replies.length];
    await db.insert(messages).values({
      creatorId: c.id,
      direction: "in",
      subject: "Re: Paid video collab with Snapcal",
      body: text,
      status: "received",
      classification: label,
      draftReply:
        label === "rates"
          ? `Thanks ${c.name.split(" ")[0]}. Our standard rate is $25 per approved video plus $1 per 1,000 views (first 14 days), with bonuses at 100K and 500K views. Creators who perform move up to higher tiers. Happy to talk it through: https://cal.com/your-team/creator-intro\n\nAlex`
          : `Great to hear, ${c.name.split(" ")[0]}. Easiest next step is a quick 15-minute call so I can walk you through the brief and how payouts work: https://cal.com/your-team/creator-intro\n\nAlex`,
      createdAt: new Date(now - r.int(1, 30) * HOUR),
    });
  }
  for (const c of [...active, ...trial]) {
    await db.insert(messages).values({ creatorId: c.id, direction: "in", subject: "Re: Paid video collab", body: "Yes, interested! Let's do it.", status: "handled", classification: "interested", createdAt: new Date(now - r.int(30, 55) * DAY) });
  }
  await db.insert(messages).values({ creatorId: cut[0].id, direction: "in", subject: "Re: Paid video collab", body: "Not for me right now, thanks though!", status: "handled", classification: "not_interested" });
  await db.insert(calls).values([
    { creatorId: replied[0].id, scheduledAt: new Date(now + 26 * HOUR), link: "https://cal.com/your-team/creator-intro" },
    { creatorId: replied[3].id, scheduledAt: new Date(now + 50 * HOUR), link: "https://cal.com/your-team/creator-intro" },
  ]);

  // Referrals
  await db.update(creators).set({ referredById: active[0].id }).where(eq(creators.id, trial[0].id));
  await db.update(creators).set({ referredById: active[1].id }).where(eq(creators.id, active[7].id));
  await db.insert(referrals).values([
    { referrerId: active[0].id, referredId: trial[0].id, bonusCents: card.referralBonusCents, status: "pending" },
    { referrerId: active[1].id, referredId: active[7].id, bonusCents: card.referralBonusCents, status: "qualified", qualifiedAt: new Date(now - 10 * DAY) },
  ]);

  // ── Onboarding ──────────────────────────────────────────────────────────
  console.log("→ contracts, tax forms, connections");
  for (const c of [...active, ...trial, ...cut]) {
    const k = await generateContract(c.id);
    const tf = await requestTaxForm(c.id);
    if (active.includes(c) || cut.includes(c)) {
      const signedAt = new Date((c.productAccessAt?.getTime() ?? now) + 1 * DAY);
      await db.update(contracts).set({ status: "signed", sentAt: signedAt, signedAt, signatureName: c.name, signatureIp: "203.0.113.7", signatureUserAgent: "Mozilla/5.0 (iPhone)" }).where(eq(contracts.id, k.id));
      if (tf) {
        const tin = String(r.int(100000000, 999999999));
        await db
          .update(taxForms)
          .set({ status: "verified", legalName: c.name, tinEnc: encrypt(tin), tinLast4: tin.slice(-4), signatureName: c.name, submittedAt: signedAt, data: { address: "123 Example St", country: c.country ?? "US" } })
          .where(eq(taxForms.id, tf.id));
      }
    } else if (r.next() < 0.5) {
      await db.update(contracts).set({ status: "sent", sentAt: new Date(now - DAY) }).where(eq(contracts.id, k.id));
    }
  }
  const rosterIds = [...active, ...trial, ...cut].map((c) => c.id);
  const accounts = await db.select().from(creatorAccounts).where(inArray(creatorAccounts.creatorId, rosterIds));
  const primary = new Map<string, (typeof accounts)[number]>();
  for (const a of accounts) if (!primary.has(a.creatorId) || primary.get(a.creatorId)!.followers < a.followers) primary.set(a.creatorId, a);
  for (const a of primary.values()) {
    const c = [...active, ...trial, ...cut].find((x) => x.id === a.creatorId)!;
    const connected = !trial.includes(c) || r.next() < 0.5;
    if (connected) await db.update(creatorAccounts).set({ connected: true, connectedAt: c.productAccessAt, lastSyncedAt: new Date(now) }).where(eq(creatorAccounts.id, a.id));
  }

  // ── Campaign posts with snapshots + hidden "true" economics ───────────────
  console.log("→ campaign posts + snapshots");
  const truth = new Map<string, { installsPer1k: number; viewScale: number }>();
  for (const [i, c] of [...active, ...cut].entries()) {
    truth.set(c.id, {
      installsPer1k: cut.includes(c) ? 0.25 + r.next() * 0.3 : i % 5 === 4 ? 0.3 + r.next() * 0.3 : 0.9 + r.next() * 2.6,
      viewScale: cut.includes(c) ? 0.35 : i < 4 ? 2.2 + r.next() : 0.6 + r.next() * 1.4,
    });
  }
  const campaignPosts: { id: string; creatorId: string; postedAt: number; finalViews: number }[] = [];
  // Rows are built in memory with client-side ids, then inserted in batches (one round trip per batch).
  const reviewRows: (typeof reviews.$inferInsert)[] = [];
  const postRows: (typeof posts.$inferInsert)[] = [];
  const snapRows: (typeof postSnapshots.$inferInsert)[] = [];
  for (const c of [...active, ...cut]) {
    const acct = primary.get(c.id)!;
    const t = truth.get(c.id)!;
    const typical = Math.max(1500, (scores.get(c.id)?.medianViews ?? 3000) * t.viewScale);
    const start = c.productAccessAt!.getTime() + 7 * DAY; // after warm-up
    const end = cut.includes(c) ? start + 25 * DAY : now;
    const baseline = scores.get(c.id)?.engagementRate ?? 0.06;
    let i = 0;
    for (let tPost = start; tPost < end; tPost += r.int(14, 30) * HOUR) {
      const postedAt = tPost + r.int(-3, 3) * HOUR;
      if (postedAt > now - HOUR) break;
      const ageDays = (now - postedAt) / DAY;
      const viral = r.next() < 0.03;
      const finalViews = Math.round(r.logNormal(typical, 0.6) * (viral ? r.int(8, 25) : 1));
      const views = Math.round(finalViews * (1 - Math.exp(-ageDays / 2.5)));
      const er = r.logNormal(0.065, 0.3);
      const botty = r.next() < 0.05;
      const paid = r.next() < 0.06 ? Math.round(views * 0.25) : 0;
      const hook = r.pick(CAMPAIGN_HOOKS);
      const format = r.pick(FORMATS);
      const caption = `${hook} #ad #snapcal ${r.pick(["#mealprep", "#caloriecounting", "#whatieatinaday"])}`;
      const transcript = `${hook}. ${r.pick(["Okay so I've been logging everything this week.", "So here's my lunch today.", "Let me show you how fast this is."])} I just take a photo, it estimates the calories and macros, done. ${r.pick(["It's not perfect but it's close.", "Way easier than weighing everything.", "I actually stuck with it this time."])}`;
      const ext = `${acct.platform}_${acct.handle}_c${i++}`;
      const counts = { likes: Math.round(views * er * (botty ? 0.12 : 0.86)), comments: Math.round(views * er * 0.07), shares: Math.round(views * er * 0.04), saves: Math.round(views * er * 0.05) };
      const removed = cut.includes(c) && r.next() < 0.15 ? new Date(postedAt + r.int(3, 20) * DAY) : null;

      // Approved review for this post
      const reviewId = crypto.randomUUID();
      const checks = runComplianceChecks({ caption, transcript, paidPartnershipToggle: true, containsAiFootage: false, aiLabelToggle: false, productAccessAt: c.productAccessAt, now: new Date(postedAt), corpus: [] });
      reviewRows.push({
        id: reviewId,
        creatorId: c.id,
        platform: acct.platform,
        caption,
        transcript,
        paidPartnershipToggle: true,
        checks,
        overall: overallStatus(checks),
        status: "approved",
        decidedAt: new Date(postedAt - 6 * HOUR),
        createdAt: new Date(postedAt - 20 * HOUR),
      });

      const postId = crypto.randomUUID();
      postRows.push({
        id: postId,
        creatorId: c.id,
        accountId: acct.id,
        platform: acct.platform,
        externalId: ext,
        url: `https://www.${acct.platform === "youtube" ? "youtube.com/shorts" : acct.platform + ".com/@" + acct.handle + "/video"}/${ext}`,
        caption,
        transcript,
        postedAt: new Date(postedAt),
        source: "roster",
        isCampaignPost: true,
        isPaidPartnership: true,
        views,
        ...counts,
        paidViews: paid,
        hookText: hook,
        hookType: hook.startsWith("POV") ? "pov" : hook.includes("?") || hook.startsWith("Guess") ? "question" : /^(Nobody|Things)/.test(hook) ? "contrarian" : "story",
        format,
        reviewId,
        removedAt: removed,
      });
      campaignPosts.push({ id: postId, creatorId: c.id, postedAt, finalViews });

      for (const mark of [1, 7, 14]) {
        if (ageDays < mark) continue;
        const v = Math.round(finalViews * (1 - Math.exp(-mark / 2.5)));
        const sc = { likes: Math.round(v * er * (botty ? 0.12 : 0.86)), comments: Math.round(v * er * 0.07), shares: Math.round(v * er * 0.04), saves: Math.round(v * er * 0.05) };
        const pv = paid ? Math.round(v * 0.25) : 0;
        const q = credibleViews({ views: v, ...sc, paidViews: pv, baselineEngagementRate: baseline });
        snapRows.push({ postId, dayMark: mark, views: v, ...sc, paidViews: q.paidViews, credibleViews: q.credibleViews, botViewsEst: q.botViewsEst, capturedAt: new Date(postedAt + mark * DAY) });
      }
    }
  }
  await insertInBatches(reviews, reviewRows);
  await insertInBatches(posts, postRows);
  await insertInBatches(postSnapshots, snapRows);
  console.log(`   ${campaignPosts.length} campaign posts`);

  // ── App metrics: organic baseline + lift from each post ──────────────────
  console.log("→ app metrics, survey, promo codes");
  const startT = Math.floor((now - 75 * DAY) / HOUR) * HOUR;
  const hours = Math.floor((now - startT) / HOUR);
  const lift = new Float64Array(hours);
  const liftByCreator = new Map<string, number>();
  for (const p of campaignPosts) {
    const t = truth.get(p.creatorId)!;
    const totalInstalls = (p.finalViews / 1000) * t.installsPer1k;
    liftByCreator.set(p.creatorId, (liftByCreator.get(p.creatorId) ?? 0) + totalInstalls);
    const h0 = Math.floor((p.postedAt - startT) / HOUR);
    for (let k = 0; k < 72; k++) {
      const idx = h0 + k;
      if (idx < 0 || idx >= hours) continue;
      lift[idx] += totalInstalls * (Math.exp(-k / 17) * (1 - Math.exp(-1 / 17)));
    }
  }
  const poisson = (lambda: number) => {
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (r.next() + r.next() + r.next() - 1.5) * 2));
    const L = Math.exp(-lambda);
    let k = 0,
      p = 1;
    do {
      k++;
      p *= r.next();
    } while (p > L);
    return k - 1;
  };
  const ARPU = 310; // cents of eventual revenue per install
  const metricRows = [];
  for (let h = 0; h < hours; h++) {
    const t = startT + h * HOUR;
    const d = new Date(t);
    const hod = d.getUTCHours();
    const dow = d.getUTCDay();
    const daily = 0.55 + 0.45 * Math.sin(((hod - 9) / 24) * 2 * Math.PI) ** 2 + (hod >= 0 && hod <= 4 ? 0.5 : 0);
    const weekly = dow === 0 || dow === 6 ? 1.15 : 1;
    const installs = poisson(26 * daily * weekly + lift[h]);
    metricRows.push({ source: "revenuecat" as const, granularity: "hour" as const, bucketStart: new Date(t), installs, trials: Math.round(installs * 0.32), revenueCents: Math.round(installs * ARPU * (0.8 + r.next() * 0.4)) });
  }
  await insertInBatches(appMetrics, metricRows);

  // Direct signals + survey
  const totalInstalls = metricRows.filter((m) => m.bucketStart.getTime() >= now - 60 * DAY).reduce((a, m) => a + m.installs, 0);
  const attrRows: (typeof attributionEvents.$inferInsert)[] = [];
  for (const [creatorId, installs] of liftByCreator) {
    const directN = Math.round(installs * (0.08 + r.next() * 0.1));
    for (let i = 0; i < directN; i++)
      attrRows.push({ creatorId, kind: r.next() < 0.6 ? "promo_redemption" : "link_install", revenueCents: r.next() < 0.35 ? r.pick([3999, 999, 5999]) : 0, occurredAt: new Date(now - r.int(1, 55) * DAY) });
    for (let i = 0; i < directN * 6; i++) attrRows.push({ creatorId, kind: "link_click", occurredAt: new Date(now - r.int(1, 55) * DAY) });
  }
  const surveyN = Math.round(totalInstalls * 0.09);
  const creatorTotal = [...liftByCreator.values()].reduce((a, b) => a + b, 0);
  const others = ["TikTok (no specific creator)", "Instagram", "App Store search", "Friend or family", "YouTube", "Other"];
  for (let i = 0; i < surveyN; i++) {
    let x = r.next() * totalInstalls;
    let creatorId: string | null = null;
    if (x < creatorTotal * 0.75) {
      for (const [id, v] of liftByCreator) {
        x -= v * 0.75;
        if (x <= 0) {
          creatorId = id;
          break;
        }
      }
    }
    const name = creatorId ? [...active, ...cut].find((c) => c.id === creatorId)?.name : null;
    attrRows.push({ creatorId, kind: "survey", surveyAnswer: name ?? r.pick(others), occurredAt: new Date(now - r.int(1, 59) * DAY) });
  }
  await insertInBatches(attributionEvents, attrRows);
  console.log(`   ${surveyN} survey answers, ${attrRows.length} attribution events`);

  // ── Creative engine ───────────────────────────────────────────────────────
  console.log("→ competitors, hook bank, breakouts, briefs");
  const competitorPosts = [
    ["Cal AI", "POV: you're on a diet but your friends want pizza", "POV: you're on a diet but your friends want pizza. So I just snap it, see it's 300 a slice, and have one. Balance.", 2_400_000],
    ["Cal AI", "I asked 100 people to guess the calories in a Starbucks drink", "I asked 100 people to guess the calories in this Starbucks drink. Nobody got close. It's 470.", 1_100_000],
    ["Cal AI", "Stop eating 'healthy' snacks that are 600 calories", "Stop eating healthy snacks that are secretly 600 calories. Here are three I scanned this week.", 860_000],
    ["MyFitnessPal", "What I eat in a day at 1,600 calories (realistic)", "What I eat in a day at 1600 calories, realistic version. Breakfast is eggs and toast.", 640_000],
    ["Ladder", "Tier list of every protein bar I've tried", "Tier list of every protein bar I've tried. Starting with the worst.", 920_000],
    ["Cal AI", "My boyfriend guesses calories vs the app", "My boyfriend guesses calories versus the app. Round one: chipotle bowl.", 1_700_000],
    ["Noom", "Things that changed when I started tracking", "Three things that changed when I started tracking. One: I stopped snacking at night.", 380_000],
    ["Cal AI", "Expectation vs reality: 500 calorie meals", "Expectation versus reality: what 500 calories actually looks like at five fast food places.", 1_300_000],
  ] as const;
  for (const [name, caption, transcript, views] of competitorPosts) {
    await addCompetitorPost({ competitorName: name, platform: "tiktok", url: "https://www.tiktok.com/@competitor", caption, transcript, views, likes: Math.round(views * 0.08), comments: Math.round(views * 0.004), shares: Math.round(views * 0.006), postedAt: new Date(now - r.int(3, 40) * DAY) });
  }
  await refreshHookBank();

  // A fresh breakout from a top creator
  const star = active[0];
  const acct = primary.get(star.id)!;
  const [bp] = await db
    .insert(posts)
    .values({
      creatorId: star.id,
      accountId: acct.id,
      platform: acct.platform,
      externalId: `${acct.platform}_${acct.handle}_breakout`,
      caption: "I let the app plan my calories at a buffet #ad #snapcal",
      transcript: "I let the app count my calories at an all-you-can-eat buffet. Plate one — 640. Plate two — okay we don't talk about plate two. Honestly it's the only way I'd ever track at a buffet.",
      postedAt: new Date(now - 20 * HOUR),
      source: "roster",
      isCampaignPost: true,
      isPaidPartnership: true,
      views: 38_400,
      likes: 2900,
      comments: 260,
      shares: 410,
      saves: 520,
      hookText: "I let the app count my calories at an all-you-can-eat buffet",
      hookType: "challenge",
      format: "Challenge",
    })
    .returning();
  await db.insert(postSnapshots).values({ postId: bp.id, dayMark: 1, views: 38_400, likes: 2900, comments: 260, shares: 410, saves: 520, credibleViews: 38_400, botViewsEst: 0, paidViews: 0 });
  await createBreakout(bp.id);
  await generateDailyBriefs();

  // ── Review queue: pending drafts with real issues ─────────────────────────
  console.log("→ review queue");
  const queue: [typeof trial[number], string, string, boolean, boolean, boolean][] = [
    [trial[0], "trying the photo calorie thing for my lunch #ad", "Day three with this app. I snapped my poke bowl and it got the macros pretty close.", true, false, false],
    [trial[1], "this app changed my life fr", "I've been using this app for six months and it's guaranteed to help you lose weight.", false, false, false],
    [trial[2], "AI made my dream meal 😂 #snapcal #ad", "I asked AI to make my dream meal and then scanned it. Look at this.", true, true, false],
    [trial[3], "POV: you're on a diet but your friends want pizza #ad", "POV: you're on a diet but your friends want pizza. So I just snap it, see it's 300 a slice, and have one. Balance.", true, false, false],
    [active[2], "Guess the calories in my grocery store sushi #ad", "Guess the calories in this grocery store sushi. I said 400. The app says 520. Rough.", true, false, false],
    [active[5], "my honest review #snapcal", "Honest review after two weeks. It's quick, it's not perfect with sauces, but I log more than I used to.", false, false, false],
  ];
  for (const [c, caption, transcript, ppt, aiFootage, aiLabel] of queue) {
    await submitForReview({ creatorId: c.id, platform: primary.get(c.id)?.platform ?? "tiktok", caption, transcript, paidPartnershipToggle: ppt, containsAiFootage: aiFootage, aiLabelToggle: aiLabel, draftUrl: null });
  }

  // ── Payouts: last month paid, this month drafted ──────────────────────────
  console.log("→ statements");
  const d = new Date(now);
  const prevStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const prevEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const prev = await generateStatements(iso(prevStart), iso(prevEnd));
  for (const s of prev) {
    await approveStatement(s.id);
    try {
      await payStatement(s.id);
    } catch (e) {
      console.log("   skip pay:", (e as Error).message);
    }
  }
  const curStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  await generateStatements(iso(curStart), iso(new Date(now)));
  const st = await db.select().from(statements);
  console.log(`   ${st.length} statements`);
  console.log("✓ seed complete");
}

main().then(
  async () => {
    await pool.end();
    process.exit(0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
