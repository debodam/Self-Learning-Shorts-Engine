# CLAUDE.md

## Project

Aced Shorts Engine V2. An internal dashboard plus agent that turns Aced's long-form YouTube videos into Shorts for YouTube, TikTok, and Instagram using the OpusClip API. A Claude agent scores clips, writes titles and captions, schedules approved clips, pulls performance metrics (YouTube first), and learns from results to score better over time.

## Scope

MVP 2 (YouTube metrics and a self-learning scoring loop) is the current focus, on top of the finished MVP 1 Generator. MVP 2 is YouTube only: Instagram and TikTok metrics are out of scope. Keep later phases out of the UI until their phase starts: their code and integration stubs can stay, but pages show a "Coming later" placeholder and settings only list what MVP 1 and MVP 2 use.

YouTube metrics come from a plain Data API v3 key (`YOUTUBE_API_KEY`, public data only, no OAuth) for the Aced channel `YOUTUBE_CHANNEL_ID` (@aced_io, never Ace Your Interviews). That gives views, likes, and comments. It does not give retention or subscribers gained, so don't build anything that needs them. A Short is a video 3 minutes or under. Batch video IDs 50 per call to keep quota low.

Settled views are the main performance number everywhere: current views for Shorts older than 30 days, otherwise views at 7 days once captured. Each Short's format (mock interview, conversational, explainer, or other) is labeled by Claude Haiku from its title, description, and thumbnail, with a confidence level. The metrics pull runs daily in GitHub Actions so 48-hour and 7-day snapshots get captured.

The scoring agent has a memory. Every pipeline clip (format, title, headline, transcript) and every channel Short (format, title, description) gets a Voyage `voyage-4-large` embedding (1024 dimensions). When a clip is scored, the 5 most similar Shorts with settled views that are at least 7 days old go into the prompt, and Claude returns a predicted settled views range (low, expected, high) and a one-line reason naming the Shorts it compared against. The rubric is still scored on the clip itself.

Ranking formula for the top 7 (src/lib/ranking.ts): rank score = 0.5 x rubric part + 0.5 x views part. The rubric part is (rubric total - 5) / 20, so 5/25 is 0 and 25/25 is 1. The views part is the percentile of the clip's expected predicted views among the clips being ranked, 0 for the lowest and 1 for the highest. A clip with no prediction gets 0.5 for the views part. Ties go to the higher rubric total, then the higher expected views. Cuts still come from the rubric alone (under 3 on Hook or Standalone, or the face rule).

The learning loop. The scoring prompt (rubric included) lives in Supabase as versioned records (`prompt_versions`); the active version scores every clip and each clip saves the version that scored it. The prompt in `src/lib/agent/prompts.ts` only seeds version 1, so edit prompts through proposals, not the code. Accuracy is tracked three ways, per prompt version: rank accuracy (Spearman correlation of predicted and actual settled views), range hit rate (actual inside the predicted low to high range), and top 7 hit rate (share of a week's top 7 that beat the channel's median settled views). Because we have few posted clips, accuracy is also backtested on the channel's Shorts: each is predicted using only Shorts published before it, and its top 7 is per month because the channel rarely posted 8+ Shorts a week. The weekly report (manual only for now: Run weekly report now or the workflow; don't schedule it until the user says to) writes a learnings entry and proposes up to 3 exact text changes, each backtested against the current version on the same recent Shorts. Nothing changes until someone approves a proposal on the Learnings page; approving creates a new active version, rejecting saves the reason, and any earlier version can be made active again.

## Users

One shared password for now, no user accounts: `src/proxy.ts` gates every page, API route, and server action with a session cookie signed from `DASHBOARD_PASSWORD`, and 5 wrong passwords lock an IP out for 15 minutes. Every new server action must call `requireSession()` first. More teammates may be added later, so don't hardcode any user. The app deploys to Vercel; deploy steps are in SETUP.md.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- Supabase (Postgres + pgvector)
- Claude API
- OpusClip REST API (https://api.opus.pro)
- YouTube Data API v3 (API key, public metrics; Analytics needs OAuth and isn't used yet)
- Instagram Graph API (later-phase metrics, stub only for now; posting goes through OpusClip in MVP 1)
- TikTok API (later-phase metrics, stub only for now; posting goes through OpusClip in MVP 1)
- GitHub Actions
- Vercel

## Design

Match Aced's product UI. Light theme, light gray page background, white sidebar, white cards with subtle borders and rounded corners, purple primary color for buttons, links, and highlights, light purple tint on the active sidebar item, near-black headings, gray secondary text, clean sans serif font, generous spacing.

## Rules

- Always commit and push directly to main. No branches, no pull requests.
- Never commit secrets. Keys live in `.env.local` and are documented in `.env.example` with placeholders.
- Keys are temporary and will migrate to Aced's accounts later. Nothing account-specific is hardcoded.
- Any code calling an external API must fall back to mock data when its key is missing, so the app always runs.
- Never use em dashes in UI copy or generated content.

## Content rules

- Branding says "Aced", never "Exponent", anywhere a viewer sees it.
- Titles are factual and specific. No clickbait.
- Captions: one caption per clip, posted as is to YouTube, TikTok, and Instagram. It's the factual title (the first line, which is also the YouTube title, under 60 characters), then 1 to 2 lines of context, then 3 to 5 relevant hashtags.
- Every person speaking must be fully visible. Split layout for 2+ people.
- Mock interview clips open on the moment of tension, then cut back to the answer.
- Rubric, 1 to 5 each: Hook, Tension, Standalone, Payoff, Loopability. Cut anything under 3 on Hook or Standalone.
- Weekly flow: the top 7 clips across the week's 2 videos, by default one per day at 12pm Eastern on YouTube, TikTok, and Instagram through OpusClip. See Weekly flow below.

## Weekly flow

The Review page follows this flow. Build and change features to fit it.

1. Once last week's posts are done, the user adds 2 new Aced videos: each a YouTube link or an uploaded MP4 or MOV file. Uploads go straight from the browser to OpusClip's storage (never through our server, since Vercel caps request size); the file name becomes the editable video title.
2. Both get submitted to OpusClip with the Aced template.
3. When Opus finishes, the clips sync in and get scored on our rubric.
4. The top 7 across both videos are auto-highlighted as this week's picks.
5. The user reviews them, swaps any out if they want, and schedules them through OpusClip to YouTube, TikTok, and Instagram. The default is one per day at 12pm Eastern; each clip's date, time, platforms, and caption can be changed, or it can be posted now. The same caption goes to all three platforms.

Every clip needs a headline baked into the video before it's scheduled or posted. Submitting to Opus spends credits and posting is public, so both always need an explicit confirm step that names the platforms and accounts. Post only to the "Exponent" YouTube channel and the Aced TikTok and Instagram accounts, never to Ace Your Interviews.

## Phases

1. **MVP 1: Generator (done).** Submit 2 YouTube links, OpusClip clips them, the agent scores them, the top 7 are highlighted, and they're posted through OpusClip to YouTube (Exponent channel), TikTok, and Instagram (Aced accounts), with one caption per clip used on all three. See Weekly flow.
2. **MVP 2: YouTube metrics and self-learning scoring (current focus).** YouTube only. Backfill every Short on the channel, save a timestamped snapshot on each metrics pull, compute views at 48 hours and 7 days after publish so Shorts posted on different days compare fairly, link the Shorts we posted to their YouTube video IDs, and show it all on the Performance page. Then a self-learning loop that uses those results to improve clip scoring.
3. **Later:** V1 data import, per-user login, Instagram and TikTok metrics and their own APIs (posting to them through OpusClip is already part of MVP 1), RAG and similar-clip retrieval.
