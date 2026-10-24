# Roster

An operations tool for a UGC creator program: find creators, recruit them by email, onboard them, feed them proven hooks, review every post, track views, attribute installs and revenue, pay them, and decide who to keep, cut or promote.

```bash
pnpm install
vercel link            # once, pick the ugc-roster project
vercel env pull        # writes .env.local: Neon DATABASE_URL, ENCRYPTION_KEY, CRON_SECRET
pnpm dev               # http://localhost:3000
pnpm test              # engine unit tests
```

**Signing in.** The ops console is behind a team password (`ADMIN_PASSWORD`). After `vercel env pull` it's in `.env.local`; change it any time in Vercel → Settings → Environment Variables (changing it signs everyone out). The creator portal, referral sign-up, tracking links, survey API, webhooks and crons stay public. Crons check `CRON_SECRET` themselves.

The database is **Neon Postgres**, provisioned through the Vercel Marketplace, so its connection strings live in the Vercel project. Schema and data commands:

```bash
pnpm db:push           # apply src/db/schema.ts to the database (uses the direct connection)
pnpm db:seed           # add ~45 days of demo data (refuses if the database already has creators)
pnpm db:reset --yes    # empty every table and re-seed — destructive
```

> **Local development and production share one Neon database** — `vercel env pull` gives you the same `DATABASE_URL` the live site uses. Before experimenting with real data, create a Neon branch (Vercel → Storage → your database → Branches) and point your local `DATABASE_URL` at it.

Third-party keys are optional: without them, discovery uses a deterministic demo provider, emails and payouts are recorded as simulated, and the AI features fall back to templates. Add keys from `.env.example` (in Vercel → Settings → Environment Variables) to make each part live. **Settings & integrations** in the app shows what's live.

## What's in it

| # | Area | Where | How it works |
|---|---|---|---|
| 1 | Finding creators | `/discover`, `/creators` | Keyword search per platform, filtered to 2K–20K followers. Each creator is scored on **typical views**: the median of recent posts and the average of their 5 worst videos, never the viral hit (`engines/creator-score.ts`). Base pay is suggested off that floor at your target CPM. Audience check: views ÷ followers, engagement shape, like:comment ratio, view uniformity, comment quality and duplicate comments (`engines/authenticity.ts`). Emails are pulled from bios, including "name [at] gmail [dot] com", and normalized so the same person is never contacted twice across campaigns. "Find more like my top 10" ranks prospects by topic, size, typical views and engagement (`engines/lookalike.ts`). |
| 2 | Outreach & pipeline | `/outreach`, `/pipeline`, `/referrals` | Email first. Claude writes a short, plain opener ("Love your videos", then the pay up front); it never quotes a specific video. Replies are sorted (interested / asking about rates / not interested) with a drafted response that includes your booking link. Stages: contacted → replied → trial → active → cut. Referral links (`/join/<code>`) pay a bonus when the friend becomes active. |
| 3 | Onboarding | `/onboarding`, creator portal `/c/<token>` | Contract generated from the rate card (rate, quota, view window, caps, usage rights, disclosure, clawbacks), e-signed with typed name + consent + IP + user agent + SHA-256 of the exact text. W-9 for US creators, W-8BEN for everyone else; TINs encrypted at rest (AES-256-GCM). Accounts connect through TikTok Login Kit, Instagram Login and Google sign-in. Warm-up is a day counter. |
| 4 | Creative engine | `/creative`, `/creative/breakouts`, `/creative/briefs` | Hook bank = top 5% of roster and competitor videos, tagged by hook type and format. A breakout (default 10K+ views at 3%+ engagement within 96h) triggers 5–10 rewritten variations sent to every creator the same day. Daily briefs: ~80% proven formats (weighted by performance), ~20% tests, each with a script and shot list (`engines/brief-planner.ts`). |
| 5 | Approval & compliance | `/review` | Nothing is paid unless approved. Every draft gets deterministic checks — paid-partnership label, banned claims, claimed experience vs actual days with the product, AI footage labeled, overlap with existing videos (shingle similarity) — plus a Claude review (`engines/compliance.ts`). |
| 6 | Tracking | `/tracking` | Connected accounts are synced (cron every 6h). New posts are detected; views are recorded at day 1, 7 and 14. Paid-boost views (from the platform's traffic-source data) are subtracted and views the engagement can't support are treated as bots (`engines/view-quality.ts`). Leaderboards use credible views. |
| 7 | Attribution | `/attribution` | Three independent signals per creator: link + promo code (a floor), the in-app "where did you hear about us?" survey (`/api/survey` lists creator names), and lift — installs above a same-hour-of-week baseline in the 48h after each post, split between overlapping posts by decaying views (`engines/attribution.ts`). Output: revenue per 1,000 views with a range and a confidence level. |
| 8 | Payouts | `/payouts`, `/payouts/rate-cards`, `/payouts/tax` | Rate card engine: base pay up to a monthly quota, per-1K-view pay on credible views inside the view window, milestone bonuses, per-video and monthly caps, tiers by typical views (`engines/rate-card.ts`). Itemized statements → approval → Wise / PayPal / Stripe Connect (idempotent per statement). Year-end 1099-NEC list ($600 threshold through 2025, $2,000 from 2026; PayPal payments excluded because PayPal reports them on 1099-K). |
| 9 | Decisions | `/decisions`, `/decisions/forecast` | Profit per 1K views = revenue per 1K − cost per 1K. After 20 posts each creator gets keep / cut / promote with reasons (`engines/decisions.ts`). Forecast turns a target ("150 videos a day") into creators needed, monthly cost, revenue and the outreach volume required (`engines/forecast.ts`). |

## Architecture

```
src/
  db/            Drizzle schema (Postgres), Neon client, seed, reset
  lib/engines/   Pure, unit-tested business logic — no I/O
  lib/services/  Engines + DB + integrations (what pages and routes call)
  lib/integrations/
    platforms/   YouTube (search + OAuth), TikTok & Instagram (OAuth), demo provider
    email.ts     Resend (or simulated)
    revenue.ts   RevenueCat webhook, App Store Connect sales reports, Google Play CSV
    payouts.ts   Wise, PayPal Payouts, Stripe Connect (or simulated)
  lib/ai/        Claude calls (structured output) with template fallbacks
  app/(app)/     Ops console
  app/c/[token]  Creator portal (contract, tax form, connect accounts, briefs, submit drafts)
  app/join/[code] Referral sign-up
  app/api/       OAuth, cron, webhooks, survey
  app/r/[code]   Tracking links
```

## Going live: notes that matter

- **Discovery.** Only YouTube offers official keyword search to commercial apps. TikTok's Research API is for non-commercial research, and Instagram's Business Discovery looks up known usernames only. For TikTok and Instagram keyword discovery, plug a TikTok One (Creator Marketplace) partner API or a creator-data vendor into `lib/integrations/platforms` behind the `DiscoveryProvider` interface.
- **Creator lists and emails.** Import exports from Modash, Influencers.club and similar tools in Discover → Import, or several at once with `pnpm import-csv --campaign "Name" --source Modash *.csv`. Exports usually leave out emails, so `pnpm find-emails` (run from your own computer, since TikTok blocks most cloud servers) reads the emails creators post themselves: TikTok bios and bio links, Instagram bios and website links through Business Discovery (set `INSTAGRAM_GRAPH_TOKEN`), and the same-handle TikTok for Instagram creators. It never guesses addresses, paces itself, stops if a platform starts refusing requests, and resumes where it left off.
- **Waitlist signups.** The trial pays $1 per waitlist signup through a creator's link. Creator links are `<App URL>/go/<code>`; drinksooz.com stores the code with the signup (`influencer_handle` in its Supabase `waitlist` table). With `WAITLIST_DATABASE_URL` set (a least-privilege `roster_sync` login), the daily job lists creators on trial in the site's `influencers` table and pulls new signups; flagged signups never count. Without it, upload the table's CSV export in Attribution → Waitlist signups. Never use `?ref=` for creators: on the site that's the friend-referral program.
- **Stats from the platform.** After a creator connects, numbers come from the official APIs. TikTok's Display API doesn't expose saves or paid-boost views, and YouTube's Data API doesn't expose shares (the Analytics API, which is used, does). Where a platform doesn't report paid views, ask creators to submit Spark Ads/Promote codes so boosted posts can be flagged.
- **Cold email.** Send from a separate domain with SPF, DKIM and DMARC, warm it up, keep volume modest, and include a way to opt out.
- **Attribution.** Hourly installs give much sharper lift estimates than the daily App Store and Play reports. Send hourly new-user counts from your analytics, or log first opens, into `app_metrics`. Set a RevenueCat subscriber attribute (`creator_code` or `promo_code`) when a code is redeemed so direct attribution works.
- **Tax and contracts.** The contract template and the 1099 logic are starting points, not legal or tax advice. Have a lawyer and an accountant review them.
- **Deploying.** Pushes to `main` deploy to Vercel automatically. `ENCRYPTION_KEY` and `CRON_SECRET` are already set there; the `vercel.json` crons run the account sync (12:00 UTC) and the daily jobs (13:00 UTC). The Hobby plan allows daily crons only. On Pro you can change the sync to every few hours (`0 */6 * * *`).
