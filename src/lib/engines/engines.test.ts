import { describe, it, expect } from "vitest";
import { typicalViews, suggestedBaseCents } from "./creator-score";
import { assessAuthenticity, commentQuality } from "./authenticity";
import { extractEmails, emailsFromPage, creatorEmailsFromPage, normalizeEmail, isReservedAddress } from "./contact";
import { emailLooksLike, looksLikeSamePerson, parseTikTokProfile, worthOpening } from "./public-profile";
import { offerLine, offerTerms, shortOffer } from "./offer";
import { cleanRef, creatorLink, parseSignupCsv, parseSignupDate } from "./signups";
import { rankLookalikes } from "./lookalike";
import { classifyReply } from "./reply-classifier";
import { runComplianceChecks, claimedExperienceDays, overallStatus } from "./compliance";
import { credibleViews } from "./view-quality";
import { isBreakout, topPercent } from "./breakout";
import { planBriefs } from "./brief-planner";
import { buildStatement, type RateCardRules } from "./rate-card";
import { attribute, liftByCreator, type Bucket } from "./attribution";
import { decide } from "./decisions";
import { forecast } from "./forecast";
import { warmupStatus, needs1099, taxFormFor } from "./onboarding";

const now = new Date("2026-10-18T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const post = (views: number, age: number, er = 0.06) => ({
  views,
  likes: Math.round(views * er * 0.85),
  comments: Math.round(views * er * 0.1),
  shares: Math.round(views * er * 0.05),
  postedAt: daysAgo(age),
});

describe("typicalViews", () => {
  it("uses the median and worst 5, ignoring the viral outlier and immature posts", () => {
    const posts = [post(1_200_000, 10), ...[3000, 3500, 4000, 4200, 5000, 5200, 6000, 2000, 2500, 2200].map((v, i) => post(v, 4 + i)), post(90_000, 1)];
    const t = typicalViews(posts, { now });
    expect(t.sampleSize).toBe(11); // the 1-day-old post is excluded
    expect(t.medianViews).toBe(4000);
    expect(t.worst5AvgViews).toBe(Math.round((2000 + 2200 + 2500 + 3000 + 3500) / 5));
    expect(t.viralDependence).toBeGreaterThan(100);
  });
  it("prices off the floor", () => {
    expect(suggestedBaseCents({ worst5AvgViews: 2640, medianViews: 4000 }, 1000)).toBe(2500);
    expect(suggestedBaseCents({ worst5AvgViews: 100, medianViews: 200 }, 1000)).toBe(1000);
  });
});

describe("authenticity", () => {
  it("passes a healthy creator", () => {
    const posts = Array.from({ length: 15 }, (_, i) => ({
      ...post(3000 + i * 400, i + 4),
      caption: "my morning protein oats recipe",
      sampleComments: ["what protein powder is this?", "made these oats today, so good with banana", "how many calories?", "🔥", "recipe please?"],
    }));
    const r = assessAuthenticity({ followers: 12_000, posts });
    expect(r.verdict).toBe("pass");
  });
  it("flags bought followers and bot comments", () => {
    const posts = Array.from({ length: 12 }, (_, i) => ({
      ...post(200 + i, i + 4, 0.004),
      sampleComments: ["nice", "nice", "🔥🔥", "follow me back", "great post", "nice", "wow", "🔥🔥", "cool", "nice"],
    }));
    const r = assessAuthenticity({ followers: 18_000, posts });
    expect(r.verdict).toBe("fail");
    expect(r.flags.join(" ")).toMatch(/followers/);
    expect(r.flags.join(" ")).toMatch(/duplicate|generic/);
  });
  it("doesn't treat fans repeating comments across different videos as bots", () => {
    const fan = ["love this", "what app is this?", "trying this tonight for dinner", "where is the bowl from?", "🔥"];
    const posts = Array.from({ length: 12 }, (_, i) => ({ ...post(4000 + i * 300, i + 4), caption: "dinner recipe", sampleComments: fan }));
    const r = assessAuthenticity({ followers: 9000, posts });
    expect(r.flags.join(" ")).not.toMatch(/duplicates/);
  });
  it("scores comment quality", () => {
    expect(commentQuality(["nice", "🔥", "nice"]).quality).toBeLessThan(0.2);
    expect(commentQuality(["where did you get that blender?", "tried this recipe and loved it"], "blender recipe").quality).toBeGreaterThan(0.8);
  });
});

describe("contact", () => {
  it("extracts plain and obfuscated emails, business first", () => {
    expect(extractEmails("💌 jane.doe [at] gmail [dot] com | collabs: collab@janedoe.co")).toEqual(["collab@janedoe.co", "jane.doe@gmail.com"]);
    expect(extractEmails("no email here")).toEqual([]);
  });
  it("recognises reserved demo addresses", () => {
    expect(isReservedAddress("maya.1a2b3c@example.com")).toBe(true);
    expect(isReservedAddress("collab@mayaeats.example.com")).toBe(true);
    expect(isReservedAddress("maya@gmail.com")).toBe(false);
    expect(isReservedAddress("hi@examples.com")).toBe(false);
  });
  it("normalizes for dedupe", () => {
    expect(normalizeEmail("Jane.Doe+ugc@GoogleMail.com")).toBe("janedoe@gmail.com");
    expect(normalizeEmail("a.b+x@company.com")).toBe("a.b@company.com");
  });
  it("finds emails on link-in-bio pages without picking up vendor or asset addresses", () => {
    const html = `<img src="/logo@2x.png"><a href="mailto:Collabs%40PaigeEats.com?subject=Hi">Email</a>
      <script>{"support":"help@linktr.ee","dsn":"https://abc@o1.ingest.sentry.io/1"}</script><p>or paige&#64;gmail.com</p>`;
    expect(emailsFromPage(html)).toEqual(["collabs@paigeeats.com", "paige@gmail.com"]);
    expect(emailsFromPage("<p>Eat at joes. com</p>")).toEqual([]);
    expect(emailsFromPage("<p>________amber777@gmail.com</p>")).toEqual(["amber777@gmail.com"]);
  });
  it("only trusts other sites' emails when they belong to the creator", () => {
    const page = "<p>Contact joe@user.com or study@vumc.org</p><a href='mailto:breezy.bites@gmail.com'>me</a>";
    expect(creatorEmailsFromPage(page, "https://redcap.vumc.org/surveys/?s=X", "breezybitesss")).toEqual(["breezy.bites@gmail.com"]);
    expect(creatorEmailsFromPage("<p>random@gmail.com</p>", "https://shop.example-store.com", "breezybitesss")).toEqual([]);
    expect(creatorEmailsFromPage("<p>hello@paigeeats.com</p>", "https://paigeeats.com/about", "eatsbypaigee")).toEqual(["hello@paigeeats.com"]);
    expect(creatorEmailsFromPage("<p>random@gmail.com</p>", "https://linktr.ee/breezy", "breezybitesss")).toEqual(["random@gmail.com"]);
  });
});

describe("public profile", () => {
  const page = (scope: object) => `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: scope })}</script></html>`;
  it("reads a TikTok bio, bio link and followers", () => {
    const p = parseTikTokProfile(
      page({ "webapp.user-detail": { userInfo: { user: { uniqueId: "eatsbypaigee", nickname: "eatsbypaige", signature: "mukbangs 💌: eatsbypaige@gmail.com", bioLink: { link: "https://linktr.ee/eatsbypaige" } }, stats: { followerCount: 13000 } } } }),
    );
    expect(p).toEqual({ found: true, name: "eatsbypaige", bio: "mukbangs 💌: eatsbypaige@gmail.com", bioLink: "https://linktr.ee/eatsbypaige", followers: 13000 });
  });
  it("tells a missing account apart from a blocked page", () => {
    expect(parseTikTokProfile(page({ "webapp.user-detail": { statusCode: 10221, userInfo: {} } }))?.found).toBe(false);
    expect(parseTikTokProfile("<html>Please verify you are human</html>")).toBeNull();
  });
  it("only opens bio links that could hold a contact email", () => {
    expect(worthOpening("linktr.ee/eatsbypaige")).toBe("https://linktr.ee/eatsbypaige");
    expect(worthOpening("https://www.amazon.com/shop/paige")).toBeNull();
    expect(worthOpening("https://instagram.com/paige")).toBeNull();
    expect(worthOpening(null)).toBeNull();
  });
  it("matches the same creator across platforms by display name", () => {
    expect(looksLikeSamePerson("Ron Don Eatz", "rondon eatz 🍗")).toBe(true);
    expect(looksLikeSamePerson("Ruben Garcia", "Ruben Reviews")).toBe(true);
    expect(looksLikeSamePerson("Brou Quinn", "Brou")).toBe(true);
    expect(looksLikeSamePerson("Jo", "Joanna Smith")).toBe(false);
    expect(looksLikeSamePerson("Quentin Johnson", "5th_light")).toBe(false);
    expect(looksLikeSamePerson("Jessica Perez", "Marcus")).toBe(false);
    expect(looksLikeSamePerson("Jo Will", null)).toBe(false);
  });
  it("accepts a contact email built from the handle or name as proof of the same creator", () => {
    expect(emailLooksLike("thatsandwichdude@gmail.com", "thatsandwichdude", "Jeremy")).toBe(true);
    expect(emailLooksLike("rob.hobbs.eats@gmail.com", "ramen_rob", "Rob Hobbs")).toBe(true);
    expect(emailLooksLike("bookings@gmail.com", "ramen_rob", "Rob Hobbs")).toBe(false);
  });
});

describe("lookalikes", () => {
  it("ranks topic + size neighbours above unrelated creators", () => {
    const seeds = [
      { id: "s1", followers: 8000, medianViews: 6000, engagementRate: 0.07, text: "calorie counting meal prep high protein" },
      { id: "s2", followers: 12000, medianViews: 9000, engagementRate: 0.06, text: "macro tracking meal prep weight loss protein" },
    ];
    const cands = [
      { id: "a", followers: 10000, medianViews: 7000, engagementRate: 0.065, text: "high protein meal prep for weight loss" },
      { id: "b", followers: 10000, medianViews: 7000, engagementRate: 0.065, text: "car detailing and wheel cleaning asmr" },
      { id: "s1", followers: 8000, medianViews: 6000, engagementRate: 0.07, text: "x" },
    ];
    const r = rankLookalikes(seeds, cands);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("reply classifier", () => {
  it.each([
    ["Yes! I'd love to, send me the brief", "interested"],
    ["What's your budget per video? My rate is $150", "rates"],
    ["No thanks, not interested at the moment", "not_interested"],
    ["Who is this?", "other"],
  ])("%s → %s", (text, label) => expect(classifyReply(text).label).toBe(label));
});

describe("compliance", () => {
  const corpus = [{ id: "p1", text: "POV you finally found an app that counts calories from a photo and it actually works" }];
  it("parses experience claims", () => {
    expect(claimedExperienceDays("I've been using this app for 3 months")?.days).toBe(90);
    expect(claimedExperienceDays("been using it for a week")?.days).toBe(7);
  });
  it("fails missing disclosure, banned claims, false experience, unlabeled AI and copies", () => {
    const checks = runComplianceChecks({
      caption: "This app is guaranteed to work",
      transcript: "I've been using this for 6 months. POV you finally found an app that counts calories from a photo and it actually works",
      paidPartnershipToggle: false,
      containsAiFootage: true,
      aiLabelToggle: false,
      productAccessAt: daysAgo(10),
      now,
      corpus,
    });
    const s = Object.fromEntries(checks.map((c) => [c.key, c.status]));
    expect(s).toEqual({ disclosure: "fail", claims: "fail", experience: "fail", ai_label: "fail", similarity: "warn" });
    expect(overallStatus(checks)).toBe("fail");
  });
  it("passes a clean post", () => {
    const checks = runComplianceChecks({
      caption: "trying the snap-a-photo calorie thing for my lunch #ad",
      transcript: "Day 4 of tracking with this — I snapped my burrito and it got the macros close",
      paidPartnershipToggle: true,
      containsAiFootage: false,
      aiLabelToggle: false,
      productAccessAt: daysAgo(10),
      now,
      corpus,
    });
    expect(overallStatus(checks)).toBe("pass");
  });
});

describe("view quality", () => {
  it("removes paid boosts and unsupported (bot) views", () => {
    const r = credibleViews({ views: 100_000, paidViews: 20_000, likes: 800, comments: 50, shares: 100, saves: 50, baselineEngagementRate: 0.06 });
    expect(r.paidViews).toBe(20_000);
    expect(r.credibleViews).toBe(Math.round(1000 / 0.03));
    expect(r.botViewsEst).toBe(80_000 - r.credibleViews);
  });
  it("leaves healthy posts untouched", () => {
    expect(credibleViews({ views: 10_000, paidViews: 0, likes: 500, comments: 40, shares: 30, saves: 30, baselineEngagementRate: 0.06 }).credibleViews).toBe(10_000);
  });
});

describe("breakouts", () => {
  it("detects 10K+ views at 3%+ engagement on fresh posts", () => {
    expect(isBreakout({ ...post(15_000, 1, 0.05) }, undefined, now)).toBe(true);
    expect(isBreakout({ ...post(15_000, 1, 0.01) }, undefined, now)).toBe(false);
    expect(isBreakout({ ...post(15_000, 10, 0.05) }, undefined, now)).toBe(false);
  });
  it("ignores routine posts from creators whose normal is already above the threshold", () => {
    expect(isBreakout({ ...post(15_000, 1, 0.05) }, undefined, now, 12_000)).toBe(false);
    expect(isBreakout({ ...post(30_000, 1, 0.05) }, undefined, now, 12_000)).toBe(true);
  });
  it("takes the top 5%", () => {
    expect(topPercent(Array.from({ length: 100 }, (_, i) => ({ views: i })), 5).map((x) => x.views)).toEqual([99, 98, 97, 96, 95]);
  });
});

describe("brief planner", () => {
  it("splits ~80/20 and is deterministic", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `c${i}`);
    const proven = [
      { format: "POV", posts: 10, medianViews: 20000 },
      { format: "Green screen", posts: 8, medianViews: 8000 },
    ];
    const a = planBriefs(ids, proven, ["Street interview"], "2026-10-18");
    expect(a.filter((x) => x.kind === "test")).toHaveLength(10);
    expect(planBriefs(ids, proven, ["Street interview"], "2026-10-18")).toEqual(a);
  });
});

describe("rate card", () => {
  const rules: RateCardRules = {
    baseCents: 2500,
    cpmCents: 100,
    viewWindowDays: 14,
    perVideoCapCents: 50_000,
    monthlyCapCents: 60_000,
    videosPerMonth: 2,
    minViewsForCpm: 1000,
    milestones: [{ views: 100_000, bonusCents: 10_000 }],
    tiers: [{ name: "Pro", minTypicalViews: 20_000, baseCents: 5000, cpmCents: 150 }],
    quotaScope: "month",
    milestoneMode: "all",
    signupBonusCents: 0,
    bonusCapCents: 0,
  };
  const p = (id: string, views: number, d: number, extra = {}) => ({
    id,
    label: id,
    postedAt: daysAgo(d),
    approved: true,
    windowViews: views,
    windowClosed: true,
    basePaid: false,
    performancePaid: false,
    ...extra,
  });

  it("pays base up to quota, CPM, milestones, applies per-video cap", () => {
    const s = buildStatement({ rules, posts: [p("a", 50_000, 20), p("b", 600_000, 18), p("c", 5000, 16), p("d", 9000, 15, { approved: false })] });
    const byKind = (k: string) => s.lineItems.filter((i) => i.kind === k);
    expect(byKind("base")).toHaveLength(2); // quota = 2
    // b: 600K × $1 = $600 + $100 milestone, capped at $500 − $25 base = $475 total performance
    const bPerf = s.lineItems.filter((i) => i.postId === "b" && i.kind !== "base").reduce((a, i) => a + i.amountCents, 0);
    expect(bPerf).toBe(47_500);
    expect(s.lineItems.some((i) => i.postId === "d")).toBe(false);
  });
  it("applies the monthly cap and tiers", () => {
    const s = buildStatement({ rules, typicalViews: 25_000, posts: [p("a", 300_000, 20), p("b", 300_000, 18)] });
    expect(s.tier.name).toBe("Pro");
    expect(s.totalCents).toBe(60_000);
    expect(s.lineItems.at(-1)?.kind).toBe("cap_adjustment");
  });
  it("never pays below a promoted tier", () => {
    const s = buildStatement({ rules, typicalViews: 2000, tierFloor: "Pro", posts: [p("a", 10_000, 20)] });
    expect(s.tier.name).toBe("Pro");
    expect(s.lineItems.find((i) => i.kind === "base")?.amountCents).toBe(5000);
    expect(buildStatement({ rules, typicalViews: 25_000, tierFloor: "Nonexistent", posts: [] }).tier.name).toBe("Pro");
  });
  it("defers performance pay until the window closes", () => {
    const s = buildStatement({ rules, posts: [p("a", 50_000, 3, { windowClosed: false })] });
    expect(s.lineItems.map((i) => i.kind)).toEqual(["base"]);
  });

  // Sooz creator trial: $30 × 4 videos, highest milestone only, $1 per signup, $200 bonus cap, no other caps.
  const trial: RateCardRules = {
    baseCents: 3000,
    cpmCents: 0,
    viewWindowDays: 14,
    perVideoCapCents: 0,
    monthlyCapCents: 0,
    videosPerMonth: 4,
    minViewsForCpm: 0,
    milestones: [
      { views: 10_000, bonusCents: 2500 },
      { views: 25_000, bonusCents: 5000 },
      { views: 100_000, bonusCents: 10_000 },
    ],
    tiers: [],
    quotaScope: "total",
    milestoneMode: "highest",
    signupBonusCents: 100,
    bonusCapCents: 20_000,
  };
  it("trial pricing pays only the highest milestone reached, plus signups", () => {
    const s = buildStatement({ rules: trial, posts: [p("a", 30_000, 20, { windowSignups: 12 }), p("b", 8000, 18)] });
    expect(s.lineItems.filter((i) => i.kind === "milestone").map((i) => i.amountCents)).toEqual([5000]); // 25K, not 10K + 25K
    expect(s.lineItems.find((i) => i.kind === "signup")?.amountCents).toBe(1200);
    expect(s.totalCents).toBe(3000 * 2 + 5000 + 1200);
  });
  it("trial pricing caps base at 4 videos in total and bonuses at $200 per creator", () => {
    const s = buildStatement({
      rules: trial,
      basePostsAlreadyPaid: 3,
      bonusesAlreadyPaidCents: 15_000,
      posts: [p("a", 150_000, 20, { windowSignups: 40 }), p("b", 150_000, 18)],
    });
    expect(s.lineItems.filter((i) => i.kind === "base")).toHaveLength(1); // only 1 of the 4 left
    const bonuses = s.lineItems.filter((i) => i.kind === "milestone" || i.kind === "signup");
    expect(bonuses.reduce((a, i) => a + i.amountCents, 0)).toBe(5000); // $200 cap − $150 already paid
    expect(bonuses.at(-1)?.description).toMatch(/bonus cap reached/);
  });
});

describe("attribution", () => {
  const HOUR = 3_600_000;
  const start = Date.UTC(2026, 7, 1);
  const series: Bucket[] = [];
  for (let h = 0; h < 24 * 42; h++) {
    const t = start + h * HOUR;
    const hod = (h % 24) + 1;
    series.push({ t, installs: 10 + (hod > 18 ? 5 : 0), revenueCents: 0 });
  }
  // Creator A posts at day 30 hour 12 → +40 installs over the next hours
  const postT = start + (30 * 24 + 12) * HOUR;
  for (const b of series) {
    const dt = (b.t - postT) / HOUR;
    if (dt >= 0 && dt < 8) b.installs += 5;
  }
  for (const b of series) b.revenueCents = b.installs * 100;

  it("attributes lift to the creator who posted", () => {
    const r = liftByCreator(series, [{ id: "p", creatorId: "A", postedAt: postT, credibleViews: 50_000 }]);
    expect(Math.round(r.byCreator.get("A") ?? 0)).toBe(40);
  });

  it("blends methods with a direct floor and confidence", () => {
    const res = attribute({
      series,
      posts: [
        { id: "p", creatorId: "A", postedAt: postT, credibleViews: 50_000 },
        { id: "q", creatorId: "B", postedAt: start + 5 * 24 * HOUR, credibleViews: 50_000 },
      ],
      direct: new Map([["B", { linkInstalls: 20, promoRedemptions: 0, revenueCents: 3000 }]]),
      surveyCounts: new Map([["A", 4]]),
      surveyTotal: 400,
    });
    const a = res.find((x) => x.creatorId === "A")!;
    const b = res.find((x) => x.creatorId === "B")!;
    expect(a.lift?.installs).toBeCloseTo(40, 0);
    expect(a.estimate.revenueCents).toBeGreaterThan(0);
    expect(b.estimate.revenueCents).toBeGreaterThanOrEqual(b.direct.revenueCents);
    expect(a.confidence).toBe("low");
  });
});

describe("decisions", () => {
  const history = Array.from({ length: 25 }, () => 10_000);
  it("waits until 20 posts", () => {
    expect(decide({ posts: 12, views: 1, paidCents: 1, revenuePer1kCents: 1, confidence: "high", viewHistory: [] }).action).toBe("evaluating");
  });
  it("promotes profitable creators and cuts losing ones", () => {
    expect(decide({ posts: 25, views: 250_000, paidCents: 50_000, revenuePer1kCents: 600, confidence: "medium", viewHistory: history }).action).toBe("promote");
    expect(decide({ posts: 25, views: 250_000, paidCents: 150_000, revenuePer1kCents: 300, confidence: "high", viewHistory: history }).action).toBe("cut");
    expect(decide({ posts: 25, views: 250_000, paidCents: 150_000, revenuePer1kCents: 300, confidence: "low", viewHistory: history }).action).toBe("keep");
  });
});

describe("forecast", () => {
  it("150 videos/day at 2 per creator needs 75 creators", () => {
    const f = forecast({
      targetVideosPerDay: 150,
      postsPerCreatorPerDay: 2,
      viewsPerVideo: 5000,
      revenuePer1kCents: 400,
      rules: {
        baseCents: 2500,
        cpmCents: 100,
        viewWindowDays: 14,
        perVideoCapCents: 50_000,
        monthlyCapCents: 300_000,
        videosPerMonth: 60,
        minViewsForCpm: 0,
        milestones: [],
        tiers: [],
        quotaScope: "month",
        milestoneMode: "all",
        signupBonusCents: 0,
        bonusCapCents: 0,
      },
    });
    expect(f.creators).toBe(75);
    expect(f.costPerVideoCents).toBe(3000);
    expect(f.monthlyCostCents).toBe(75 * 60 * 3000);
    expect(f.summary).toContain("75 creators");
  });
});

describe("onboarding", () => {
  it("counts warm-up days", () => {
    expect(warmupStatus(daysAgo(2), 7, now)).toMatchObject({ day: 3, done: false, remaining: 5 });
    expect(warmupStatus(daysAgo(9), 7, now).done).toBe(true);
  });
  it("picks tax forms and 1099 rules", () => {
    expect(taxFormFor("US")).toBe("W-9");
    expect(taxFormFor("GB")).toBe("W-8BEN");
    expect(needs1099({ country: "US", totalCents: 250_000, tpsoCents: 100_000, year: 2026 }).required).toBe(false);
    expect(needs1099({ country: "US", totalCents: 250_000, tpsoCents: 0, year: 2026 }).required).toBe(true);
    expect(needs1099({ country: "US", totalCents: 70_000, tpsoCents: 0, year: 2025 }).required).toBe(true);
  });
});

import { complianceFooter, withFooter, doNotContact, followUpEmail, followUpStatus, greetingName, openerEmail, type MessageLite } from "./outreach";

describe("outreach rules", () => {
  const t0 = new Date("2026-10-01T15:00:00Z");
  const out = (daysAfter: number, status = "sent"): MessageLite => ({ direction: "out", status, subject: "Paid video collab", body: "Hi", createdAt: new Date(t0.getTime() + daysAfter * 86_400_000), sentAt: new Date(t0.getTime() + daysAfter * 86_400_000) });

  it("adds the footer once, with address and opt-out", () => {
    const f = complianceFooter({ senderName: "Alex", brandName: "Snapcal", mailingAddress: "1 Main St, Austin TX" });
    expect(f).toContain("1 Main St");
    expect(f).toContain("no thanks");
    expect(withFooter(withFooter("Hello", f), f).split("no thanks").length).toBe(2);
  });

  it("blocks creators who opted out, said no, or were cut", () => {
    expect(doNotContact("contacted", [{ direction: "in", status: "received", body: "please unsubscribe me", createdAt: t0 }])).toMatch(/asked/);
    expect(doNotContact("replied", [{ direction: "in", status: "handled", classification: "not_interested", createdAt: t0 }])).toMatch(/not interested/);
    expect(doNotContact("cut", [])).toMatch(/cut/);
    expect(doNotContact("contacted", [out(0)])).toBeNull();
  });

  it("schedules follow-ups on day 4 and 9, stopping on reply", () => {
    const sched = [4, 9];
    expect(followUpStatus([out(0)], sched, new Date(t0.getTime() + 3 * 86_400_000)).due).toBe(false);
    const due1 = followUpStatus([out(0)], sched, new Date(t0.getTime() + 4 * 86_400_000));
    expect(due1).toMatchObject({ due: true, step: 1, subject: "Re: Paid video collab" });
    expect(followUpStatus([out(0), out(4)], sched, new Date(t0.getTime() + 9 * 86_400_000))).toMatchObject({ due: true, step: 2 });
    expect(followUpStatus([out(0), out(4), out(9)], sched, new Date(t0.getTime() + 20 * 86_400_000)).due).toBe(false);
    expect(followUpStatus([out(0), { direction: "in", status: "received", createdAt: t0 }], sched, new Date(t0.getTime() + 5 * 86_400_000)).due).toBe(false);
    expect(followUpStatus([out(0), out(5, "draft")], sched, new Date(t0.getTime() + 6 * 86_400_000)).due).toBe(false);
    // A late first follow-up (day 30) pushes the second one 5 days after it, not immediately.
    expect(followUpStatus([out(0), out(30)], sched, new Date(t0.getTime() + 31 * 86_400_000)).due).toBe(false);
    expect(followUpStatus([out(0), out(30)], sched, new Date(t0.getTime() + 35 * 86_400_000)).due).toBe(true);
  });
});


import { parseCsv, mapColumns, parseCount, parseRate, fromProfileUrl, normalizeRows } from "./csv-import";
import { assessFromAggregates } from "./authenticity";

describe("csv import", () => {
  it("parses quotes, embedded commas and newlines, and semicolons", () => {
    expect(parseCsv('a,b\n"x, y","line1\nline2"\n')).toEqual([["a", "b"], ["x, y", "line1\nline2"]]);
    expect(parseCsv("\uFEFFa;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("maps common export headers", () => {
    const m = mapColumns(["Username", "Full name", "Followers", "Engagement Rate", "Avg. Views", "Email", "Profile URL", "Country"]);
    expect(m).toMatchObject({ handle: 0, name: 1, followers: 2, engagementRate: 3, avgViews: 4, email: 5, url: 6, country: 7 });
  });
  it("cleans numbers and handles", () => {
    expect(parseCount("12.5K")).toBe(12500);
    expect(parseCount("1,234")).toBe(1234);
    expect(parseRate("4.5%")).toBeCloseTo(0.045);
    expect(parseRate("0.045")).toBeCloseTo(0.045);
    expect(fromProfileUrl("https://www.tiktok.com/@Spicy.Sam?lang=en")).toEqual({ platform: "tiktok", handle: "spicy.sam" });
    expect(fromProfileUrl("instagram.com/hotsauce_hank/")).toEqual({ platform: "instagram", handle: "hotsauce_hank" });
    expect(fromProfileUrl("https://instagram.com/p/abc123").handle).toBeNull();
  });
  it("normalizes rows with platform from URL or default", () => {
    const { rows } = normalizeRows(parseCsv("Username,Followers,Email,Link\n@SpicySam,8.2K,collabs: sam@gmail.com,https://tiktok.com/@spicysam\nhank,15000,,"), "instagram");
    expect(rows[0]).toMatchObject({ handle: "spicysam", platform: "tiktok", followers: 8200, email: "sam@gmail.com" });
    expect(rows[1]).toMatchObject({ handle: "hank", platform: "instagram", followers: 15000, email: null });
  });
  it("scores from aggregates", () => {
    expect(assessFromAggregates({ followers: 10000, avgViews: 4000, engagementRate: 0.06, fakeFollowersPct: 0.05 }).verdict).toBe("pass");
    expect(assessFromAggregates({ followers: 18000, avgViews: 300, engagementRate: 0.004, fakeFollowersPct: 0.4 }).verdict).toBe("fail");
  });
});

describe("offer wording", () => {
  const sooz = {
    baseCents: 3000,
    cpmCents: 0,
    videosPerMonth: 4,
    quotaScope: "total" as const,
    viewWindowDays: 14,
    milestones: [
      { views: 25_000, bonusCents: 5000 },
      { views: 10_000, bonusCents: 2500 },
      { views: 100_000, bonusCents: 10_000 },
    ],
    milestoneMode: "highest" as const,
    signupBonusCents: 100,
    bonusCapCents: 20_000,
    perks: "First samples from the first production run\nA Hot Mess Club card\n",
  };
  it("states the trial in one sentence for cold emails", () => {
    expect(offerLine(sooz)).toBe("$30 per video for 4 videos, up to $100 more per video at view milestones, plus $1 for every waitlist signup from your link");
  });
  it("spells out every term for replies and the portal", () => {
    expect(offerTerms(sooz)).toEqual([
      "$30 per approved video, for 4 videos",
      "View bonus per video (first 14 days): $25 at 10K, $50 at 25K, $100 at 100K. You get the highest level reached; they don't add up.",
      "$1 per waitlist signup through your link, counted for 14 days after each post",
      "Bonuses (view bonuses plus signups) top out at $200 for the whole trial",
      "Perks: First samples from the first production run; A Hot Mess Club card",
    ]);
  });
});

describe("waitlist signups", () => {
  it("reads common export columns", () => {
    const { rows, missing } = parseSignupCsv("Email Address,Referral Code,Created At\nFan@Example.com,samheat,2026-10-21 15:04\nnobody,,\n");
    expect(missing).toEqual([]);
    expect(rows[0]).toMatchObject({ email: "fan@example.com", ref: "SAMHEAT" });
    expect(rows[0].at?.getFullYear()).toBe(2026);
    expect(rows[1]).toMatchObject({ email: null, ref: null, at: null });
  });
  it("says which columns are missing", () => {
    expect(parseSignupCsv("name,email\nSam,sam@x.co").missing).toEqual(["ref", "signup date"]);
  });
  it("reads the Sooz waitlist table export, ignoring the friend-referral columns", () => {
    const csv = [
      "id,email,card_index,created_at,ref_slug,ref_name,referred_by_slug,discount_code,referral_count,influencer_handle,signup_status",
      "1,a@x.co,2,2026-10-21 15:04:00+00,QK7P2M,Ann,XY12AB,SOOZ50,0,samheat4x7,valid",
      "2,b@x.co,1,2026-10-21 16:00:00+00,ZZ9P2M,Bo,,SOOZ50,0,samheat4x7,flagged",
      "3,c@x.co,1,2026-10-21 17:00:00+00,AB3P2M,Cy,QK7P2M,SOOZ50,0,,valid",
    ].join("\n");
    const { rows, missing } = parseSignupCsv(csv);
    expect(missing).toEqual([]);
    expect(rows.map((r) => [r.ref, r.flagged])).toEqual([
      ["SAMHEAT4X7", false],
      ["SAMHEAT4X7", true],
      [null, false],
    ]);
  });
  it("builds the site's creator link, never ?ref= (that's the friend program)", () => {
    expect(creatorLink("https://drinksooz.com", "SAMHEAT4X7")).toBe("https://drinksooz.com/go/samheat4x7");
    expect(creatorLink("https://drinksooz.com/shop?x=1", "AB3")).toBe("https://drinksooz.com/go/ab3");
  });
  it("cleans refs and dates", () => {
    expect(cleanRef("https://drinksooz.com/?ref=sam-heat&utm_source=creator")).toBe("SAM-HEAT");
    expect(parseSignupDate("1792500000")?.toISOString()).toBe(new Date(1792500000 * 1000).toISOString());
    expect(parseSignupDate("not a date")).toBeNull();
  });
});

describe("cold email text", () => {
  const offer = "$25 per video for 4 videos, up to $100 more per video at view milestones, plus $1 for every waitlist signup from your link";
  const brand = { name: "Sooz", senderName: "Risus Zhao", openerSubject: "Sooz x @{handle}", openerBody: "Hey {name}!\r\n\r\nLove your videos.\r\n\r\nRisus\r\n" };

  it("greets by first name only when the name on file looks like one", () => {
    const g = (name: string, handle: string | null = "thehandle") => greetingName({ name, handle });
    expect(g("Carmen Roman")).toBe("Carmen");
    expect(g("Zozo Mukbang ")).toBe("@thehandle");
    expect(g("Stef and Nat")).toBe("Stef and Nat");
    expect(g("NOODLE")).toBe("Noodle");
    expect(g("🏆 We Love Ranking Real 🥰")).toBe("@thehandle");
    expect(g("Spice Combo")).toBe("@thehandle");
    expect(g("The Adaptive Maritimer ")).toBe("@thehandle");
    expect(g("Chef Soulja")).toBe("@thehandle");
    expect(g("POVKitchen")).toBe("@thehandle");
    expect(g("Munching with Marina")).toBe("@thehandle");
    expect(g("Lil Mk")).toBe("@thehandle");
    expect(g("Fullmoon_chadani")).toBe("@thehandle");
    expect(g("Jennylaprincess")).toBe("@thehandle");
    expect(g("Amber Nichole Kellehan")).toBe("Amber");
    expect(g("Kristopher")).toBe("Kristopher");
    expect(g("🔥🔥", null)).toBe("there");
  });

  it("fills {name} and {handle} in the saved first email", () => {
    expect(openerEmail(brand, offer, [], { name: "Kami", handle: "@kamiavii" })).toEqual({ subject: "Sooz x @kamiavii", body: "Hey Kami!\n\nLove your videos.\n\nRisus" });
    expect(openerEmail(brand, offer, [], { name: "Kami", handle: null }).subject).toBe("Sooz x Kami");
  });

  it("builds a plain email from the rate card when none is saved", () => {
    const e = openerEmail({ name: "Sooz", senderName: "Risus Zhao" }, offer, ["First samples from our first production run"], { name: "Graci", handle: "graci" });
    expect(e.subject).toBe("Paid video collab with Sooz");
    expect(e.body).toBe(`Hey Graci!\n\nLove your videos.\n\nWe'd pay ${offer}. You'd also get first samples from our first production run.\n\nWant me to send over the details?\n\nRisus`);
  });

  it("follow-ups greet the creator and keep the deal short", () => {
    const short = shortOffer({ baseCents: 2500, cpmCents: 0, videosPerMonth: 4, quotaScope: "total", viewWindowDays: 14, milestones: [{ views: 25000, bonusCents: 5000 }, { views: 10000, bonusCents: 2500 }], milestoneMode: "highest", signupBonusCents: 100, bonusCapCents: 20000, perks: "" });
    expect(short).toBe("4 videos at $25 each, plus bonuses when one takes off past 10K views");
    expect(followUpEmail(brand, 1, short, { name: "Lydia Hooker" })).toBe(`Hey Lydia! Popping back in case this got buried. It's ${short}, and the drink's on us. Want me to send over the details?\n\nRisus`);
    expect(followUpEmail(brand, 2, short, { name: "Spice Combo", handle: "spicecombo" })).toMatch(/^Hey @spicecombo, last note from me!/);
  });
});
