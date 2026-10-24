import { pgTable, text, integer, real, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const json = <T>(name: string) => jsonb(name).$type<T>();

export const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const STAGES = ["prospect", "contacted", "replied", "trial", "active", "cut"] as const;
export type Stage = (typeof STAGES)[number];

// ─── 1. Finding creators ────────────────────────────────────────────────────

export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text("name").notNull(),
  niche: text("niche").notNull(),
  keywords: json<string[]>("keywords").notNull(),
  platforms: json<Platform[]>("platforms").notNull(),
  minFollowers: integer("min_followers").notNull().default(2000),
  maxFollowers: integer("max_followers").notNull().default(20000),
  status: text("status", { enum: ["active", "paused", "archived"] }).notNull().default("active"),
  createdAt: createdAt(),
});

export const creators = pgTable(
  "creators",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    country: text("country"),
    niche: text("niche"),
    /** Where the creator came from: "YouTube discovery", "Modash", "Spreadsheet", "Referral", … */
    source: text("source"),
    stage: text("stage", { enum: STAGES }).notNull().default("prospect"),
    tier: text("tier"),
    rateCardId: text("rate_card_id"),
    referredById: text("referred_by_id"),
    referralCode: text("referral_code").notNull().$defaultFn(() => shortCode()),
    promoCode: text("promo_code"),
    portalToken: text("portal_token").notNull().$defaultFn(() => crypto.randomUUID().replaceAll("-", "")),
    warmupStartedAt: ts("warmup_started_at"),
    warmupTargetDays: integer("warmup_target_days").notNull().default(7),
    productAccessAt: ts("product_access_at"),
    payoutProvider: text("payout_provider", { enum: ["wise", "paypal", "stripe"] }),
    payoutDestination: text("payout_destination"),
    stageChangedAt: ts("stage_changed_at"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("creators_email_norm_uq").on(t.emailNormalized),
    uniqueIndex("creators_referral_code_uq").on(t.referralCode),
    uniqueIndex("creators_portal_token_uq").on(t.portalToken),
    index("creators_stage_idx").on(t.stage),
  ],
);

export const creatorAccounts = pgTable(
  "creator_accounts",
  {
    id: id(),
    creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    handle: text("handle").notNull(),
    platformUserId: text("platform_user_id"),
    url: text("url"),
    bio: text("bio"),
    followers: integer("followers").notNull().default(0),
    // Official-login connection (stats come from the platform, not screenshots)
    connected: boolean("connected").notNull().default(false),
    connectedAt: ts("connected_at"),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: ts("token_expires_at"),
    lastSyncedAt: ts("last_synced_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("accounts_platform_handle_uq").on(t.platform, t.handle), index("accounts_creator_idx").on(t.creatorId)],
);

export const campaignCreators = pgTable(
  "campaign_creators",
  {
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
    addedAt: createdAt(),
  },
  (t) => [uniqueIndex("campaign_creator_uq").on(t.campaignId, t.creatorId)],
);

/** Scoring snapshot: typical views (median + worst 5), not the viral hit. */
export const creatorScores = pgTable(
  "creator_scores",
  {
    id: id(),
    creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    sampleSize: integer("sample_size").notNull(),
    medianViews: integer("median_views").notNull(),
    worst5AvgViews: integer("worst5_avg_views").notNull(),
    maxViews: integer("max_views").notNull(),
    engagementRate: real("engagement_rate").notNull(),
    viewFollowerRatio: real("view_follower_ratio").notNull(),
    authenticityScore: integer("authenticity_score").notNull(),
    authenticityVerdict: text("authenticity_verdict", { enum: ["pass", "review", "fail"] }).notNull(),
    authenticityFlags: json<string[]>("authenticity_flags").notNull(),
    commentQuality: real("comment_quality").notNull(),
    suggestedBaseCents: integer("suggested_base_cents").notNull(),
    computedAt: createdAt(),
  },
  (t) => [index("scores_creator_idx").on(t.creatorId)],
);

// ─── Posts (prospect samples, roster posts, competitor posts) ───────────────

export const posts = pgTable(
  "posts",
  {
    id: id(),
    creatorId: text("creator_id").references(() => creators.id, { onDelete: "cascade" }),
    accountId: text("account_id").references(() => creatorAccounts.id, { onDelete: "set null" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    externalId: text("external_id").notNull(),
    url: text("url"),
    caption: text("caption"),
    transcript: text("transcript"),
    postedAt: ts("posted_at").notNull(),
    source: text("source", { enum: ["prospect", "roster", "competitor"] }).notNull(),
    competitorName: text("competitor_name"),
    isCampaignPost: boolean("is_campaign_post").notNull().default(false),
    isPaidPartnership: boolean("is_paid_partnership").notNull().default(false),
    views: integer("views").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    paidViews: integer("paid_views").notNull().default(0),
    sampleComments: json<string[]>("sample_comments"),
    // Hook bank
    inHookBank: boolean("in_hook_bank").notNull().default(false),
    hookText: text("hook_text"),
    hookType: text("hook_type"),
    format: text("format"),
    reviewId: text("review_id"),
    removedAt: ts("removed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("posts_platform_ext_uq").on(t.platform, t.externalId),
    index("posts_creator_idx").on(t.creatorId),
    index("posts_posted_idx").on(t.postedAt),
  ],
);

/** Views recorded at day 1, 7 and 14 (plus any intermediate syncs). */
export const postSnapshots = pgTable(
  "post_snapshots",
  {
    id: id(),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    dayMark: integer("day_mark").notNull(), // 1, 7, 14 (0 = ad-hoc)
    views: integer("views").notNull(),
    likes: integer("likes").notNull(),
    comments: integer("comments").notNull(),
    shares: integer("shares").notNull(),
    saves: integer("saves").notNull(),
    paidViews: integer("paid_views").notNull().default(0),
    credibleViews: integer("credible_views").notNull(),
    botViewsEst: integer("bot_views_est").notNull().default(0),
    capturedAt: createdAt(),
  },
  (t) => [uniqueIndex("snap_post_day_uq").on(t.postId, t.dayMark)],
);

// ─── 2. Outreach & pipeline ─────────────────────────────────────────────────

export const messages = pgTable(
  "messages",
  {
    id: id(),
    creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    direction: text("direction", { enum: ["out", "in"] }).notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status", { enum: ["draft", "sent", "simulated", "failed", "received", "handled"] }).notNull(),
    classification: text("classification", { enum: ["interested", "rates", "not_interested", "other"] }),
    draftReply: text("draft_reply"),
    providerMessageId: text("provider_message_id"),
    sentAt: ts("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_creator_idx").on(t.creatorId)],
);

export const calls = pgTable("calls", {
  id: id(),
  creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  scheduledAt: ts("scheduled_at").notNull(),
  link: text("link"),
  status: text("status", { enum: ["booked", "done", "no_show", "cancelled"] }).notNull().default("booked"),
  createdAt: createdAt(),
});

export const referrals = pgTable("referrals", {
  id: id(),
  referrerId: text("referrer_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  referredId: text("referred_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  bonusCents: integer("bonus_cents").notNull(),
  status: text("status", { enum: ["pending", "qualified", "paid", "void"] }).notNull().default("pending"),
  qualifiedAt: ts("qualified_at"),
  createdAt: createdAt(),
});

// ─── 3. Onboarding ──────────────────────────────────────────────────────────

export type ContractTerms = {
  baseCents: number;
  cpmCents: number;
  videosPerMonth: number;
  viewWindowDays: number;
  perVideoCapCents: number;
  monthlyCapCents: number;
  // Added with trial pricing; older contracts may not have them.
  quotaScope?: "month" | "total";
  milestones?: Milestone[];
  milestoneMode?: "all" | "highest";
  signupBonusCents?: number;
  bonusCapCents?: number;
  perks?: string;
  usageRights: "none" | "organic" | "paid_ads";
  usageMonths: number;
  disclosure: string;
  clawbackDays: number;
  termMonths: number;
};

export const contracts = pgTable("contracts", {
  id: id(),
  creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  rateCardId: text("rate_card_id"),
  terms: json<ContractTerms>("terms").notNull(),
  body: text("body").notNull(),
  bodySha256: text("body_sha256").notNull(),
  status: text("status", { enum: ["draft", "sent", "signed", "void"] }).notNull().default("draft"),
  sentAt: ts("sent_at"),
  signedAt: ts("signed_at"),
  signatureName: text("signature_name"),
  signatureIp: text("signature_ip"),
  signatureUserAgent: text("signature_user_agent"),
  createdAt: createdAt(),
});

export const taxForms = pgTable("tax_forms", {
  id: id(),
  creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  formType: text("form_type", { enum: ["W-9", "W-8BEN"] }).notNull(),
  legalName: text("legal_name"),
  data: json<Record<string, string>>("data"),
  tinEnc: text("tin_enc"),
  tinLast4: text("tin_last4"),
  status: text("status", { enum: ["requested", "submitted", "verified", "rejected"] }).notNull().default("requested"),
  signatureName: text("signature_name"),
  submittedAt: ts("submitted_at"),
  createdAt: createdAt(),
});

// ─── 4. Creative engine ─────────────────────────────────────────────────────

export type Variation = { hook: string; script: string; onScreenText?: string };

export const breakouts = pgTable("breakouts", {
  id: id(),
  postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  views: integer("views").notNull(),
  engagementRate: real("engagement_rate").notNull(),
  variations: json<Variation[]>("variations").notNull(),
  sentToCount: integer("sent_to_count").notNull().default(0),
  status: text("status", { enum: ["new", "sent", "dismissed"] }).notNull().default("new"),
  detectedAt: createdAt(),
});

export const briefs = pgTable(
  "briefs",
  {
    id: id(),
    creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    kind: text("kind", { enum: ["proven", "test", "breakout"] }).notNull(),
    format: text("format").notNull(),
    hook: text("hook").notNull(),
    script: text("script").notNull(),
    shotList: json<string[]>("shot_list").notNull(),
    sourcePostId: text("source_post_id"),
    breakoutId: text("breakout_id"),
    status: text("status", { enum: ["assigned", "submitted", "done", "skipped"] }).notNull().default("assigned"),
    createdAt: createdAt(),
  },
  (t) => [index("briefs_date_idx").on(t.date)],
);

// ─── 5. Approval & compliance ───────────────────────────────────────────────

export type ComplianceCheck = {
  key: "disclosure" | "claims" | "experience" | "ai_label" | "similarity" | "ai_review";
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

export const reviews = pgTable("reviews", {
  id: id(),
  creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  briefId: text("brief_id"),
  platform: text("platform", { enum: PLATFORMS }).notNull(),
  draftUrl: text("draft_url"),
  caption: text("caption").notNull(),
  transcript: text("transcript"),
  paidPartnershipToggle: boolean("paid_partnership_toggle").notNull().default(false),
  containsAiFootage: boolean("contains_ai_footage").notNull().default(false),
  aiLabelToggle: boolean("ai_label_toggle").notNull().default(false),
  checks: json<ComplianceCheck[]>("checks"),
  overall: text("overall", { enum: ["pass", "warn", "fail"] }),
  status: text("status", { enum: ["pending", "approved", "changes_requested", "rejected"] }).notNull().default("pending"),
  reviewerNotes: text("reviewer_notes"),
  decidedAt: ts("decided_at"),
  createdAt: createdAt(),
});

// ─── 7. Attribution ─────────────────────────────────────────────────────────

/** Hourly app metrics from App Store Connect / Google Play / RevenueCat. */
export const appMetrics = pgTable(
  "app_metrics",
  {
    id: id(),
    bucketStart: ts("bucket_start").notNull(),
    granularity: text("granularity", { enum: ["hour", "day"] }).notNull(),
    source: text("source", { enum: ["app_store", "google_play", "revenuecat"] }).notNull(),
    installs: integer("installs").notNull().default(0),
    trials: integer("trials").notNull().default(0),
    revenueCents: integer("revenue_cents").notNull().default(0),
  },
  (t) => [uniqueIndex("metrics_bucket_uq").on(t.source, t.granularity, t.bucketStart)],
);

/** Direct signals: promo code redemptions, tracked link conversions, survey answers. */
export const attributionEvents = pgTable(
  "attribution_events",
  {
    id: id(),
    creatorId: text("creator_id").references(() => creators.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["link_click", "link_install", "promo_redemption", "survey", "signup"] }).notNull(),
    surveyAnswer: text("survey_answer"),
    revenueCents: integer("revenue_cents").notNull().default(0),
    /** App user id; for waitlist signups, a SHA-256 of the normalized email so each person counts once. */
    appUserId: text("app_user_id"),
    occurredAt: ts("occurred_at").notNull(),
  },
  (t) => [index("attr_creator_idx").on(t.creatorId), index("attr_kind_idx").on(t.kind)],
);

// ─── 8. Payouts ─────────────────────────────────────────────────────────────

export type Milestone = { views: number; bonusCents: number };
export type Tier = { name: string; minTypicalViews: number; baseCents: number; cpmCents: number };

export const rateCards = pgTable("rate_cards", {
  id: id(),
  name: text("name").notNull(),
  baseCents: integer("base_cents").notNull(),
  cpmCents: integer("cpm_cents").notNull(),
  viewWindowDays: integer("view_window_days").notNull().default(14),
  perVideoCapCents: integer("per_video_cap_cents").notNull(),
  monthlyCapCents: integer("monthly_cap_cents").notNull(),
  videosPerMonth: integer("videos_per_month").notNull().default(30),
  minViewsForCpm: integer("min_views_for_cpm").notNull().default(0),
  milestones: json<Milestone[]>("milestones").notNull(),
  tiers: json<Tier[]>("tiers").notNull(),
  referralBonusCents: integer("referral_bonus_cents").notNull().default(15000),
  /** "month": base pay for up to videosPerMonth approved videos each month. "total": that many videos in all (a trial). */
  quotaScope: text("quota_scope", { enum: ["month", "total"] }).notNull().default("month"),
  /** "all": every milestone a video passes pays. "highest": only the highest one reached. */
  milestoneMode: text("milestone_mode", { enum: ["all", "highest"] }).notNull().default("all"),
  /** Paid per waitlist signup through the creator's link inside a video's view window. */
  signupBonusCents: integer("signup_bonus_cents").notNull().default(0),
  /** Most one creator can earn in milestone + signup bonuses across all statements (0 = no cap). */
  bonusCapCents: integer("bonus_cap_cents").notNull().default(0),
  /** Non-cash perks, one per line. Shown in outreach, the contract and the creator portal. */
  perks: text("perks").notNull().default(""),
  createdAt: createdAt(),
});

export type LineItem = {
  kind: "base" | "cpm" | "milestone" | "signup" | "referral" | "clawback" | "cap_adjustment";
  postId?: string;
  description: string;
  amountCents: number;
};

export const statements = pgTable("statements", {
  id: id(),
  creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  periodStart: text("period_start").notNull(), // YYYY-MM-DD
  periodEnd: text("period_end").notNull(),
  lineItems: json<LineItem[]>("line_items").notNull(),
  totalCents: integer("total_cents").notNull(),
  status: text("status", { enum: ["draft", "approved", "paid", "failed"] }).notNull().default("draft"),
  approvedAt: ts("approved_at"),
  payoutProvider: text("payout_provider", { enum: ["wise", "paypal", "stripe"] }),
  payoutRef: text("payout_ref"),
  payoutError: text("payout_error"),
  paidAt: ts("paid_at"),
  createdAt: createdAt(),
});

// ─── Misc ───────────────────────────────────────────────────────────────────

export const activity = pgTable(
  "activity",
  {
    id: id(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    creatorId: text("creator_id"),
    at: createdAt(),
  },
  (t) => [index("activity_at_idx").on(t.at)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: json<unknown>("value").notNull(),
});

function shortCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export type Creator = typeof creators.$inferSelect;
export type CreatorAccount = typeof creatorAccounts.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostSnapshot = typeof postSnapshots.$inferSelect;
export type RateCard = typeof rateCards.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Statement = typeof statements.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type CreatorScore = typeof creatorScores.$inferSelect;
