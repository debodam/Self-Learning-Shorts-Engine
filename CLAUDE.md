# CLAUDE.md

## Project

Aced Shorts Engine V2. An internal dashboard plus agent that turns Aced's long-form YouTube videos into Shorts for YouTube, TikTok, and Instagram using the OpusClip API. A Claude agent scores clips, writes titles and captions, schedules approved clips, pulls performance metrics from all three platforms, and learns weekly from results using a RAG over past clips.

## MVP scope

The MVP is YouTube only. Instagram and TikTok move to V2.

- Metrics pipelines pull from YouTube only.
- The performance page shows only YouTube columns.
- The review page shows only YouTube predicted performance.
- Scheduling and publishing target YouTube only.
- Keep the Instagram and TikTok integration stubs in the code, but hide them from the UI and the settings page until V2.

## Users

Single-user auth for now. More teammates may be added later, so don't hardcode any user.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- Supabase (Postgres + pgvector)
- Claude API
- OpusClip REST API (https://api.opus.pro)
- YouTube Data + Analytics APIs
- Instagram Graph API (V2, stub only in MVP)
- TikTok API (V2, stub only in MVP)
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
- Every person speaking must be fully visible. Split layout for 2+ people.
- Mock interview clips open on the moment of tension, then cut back to the answer.
- Rubric, 1 to 5 each: Hook, Tension, Standalone, Payoff, Loopability. Cut anything under 3 on Hook or Standalone.
- Weekly flow: shortlist 10 clips, approve 7, one per day at 12pm Eastern on YouTube (all three platforms from V2).

## Phases

1. Data layer, metrics pipelines, performance page
2. Opus integration, agent scoring, review and approve page, scheduling
3. Embeddings, similar-clip retrieval, weekly learning report
4. Competitors, comments, back catalog, second channel

Phases 1 to 3 are YouTube only. Instagram and TikTok metrics, predictions, and scheduling come in V2.
