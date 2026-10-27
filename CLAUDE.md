# CLAUDE.md

## Project

Aced Shorts Engine V2. An internal dashboard plus agent that turns Aced's long-form YouTube videos into Shorts for YouTube, TikTok, and Instagram using the OpusClip API. A Claude agent scores clips, writes titles and captions, schedules approved clips, pulls performance metrics from all three platforms, and learns weekly from results using a RAG over past clips.

## Scope

MVP 1 (the Generator) is the current focus. Build for it, and keep later phases out of the UI until their phase starts: their code and integration stubs can stay, but pages show "Coming in Phase 2" and settings only list what MVP 1 uses.

## Users

Single-user auth for now. More teammates may be added later, so don't hardcode any user.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- Supabase (Postgres + pgvector)
- Claude API
- OpusClip REST API (https://api.opus.pro)
- YouTube Data + Analytics APIs
- Instagram Graph API (Phase 3, stub only for now)
- TikTok API (Phase 3, stub only for now)
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
- Weekly flow: the top 7 clips across the week's 2 videos, one per day at 12pm Eastern on YouTube (Instagram and TikTok in Phase 3). See Weekly flow below.

## Weekly flow

The Review page follows this flow. Build and change features to fit it.

1. Once last week's posts are done, the user pastes 2 new Aced YouTube links.
2. Both get submitted to OpusClip with the Aced template.
3. When Opus finishes, the clips sync in and get scored on our rubric.
4. The top 7 across both videos are auto-highlighted as this week's picks.
5. The user reviews them, swaps any out if they want, and schedules them one per day at 12pm Eastern on YouTube.

Submitting to Opus spends credits and scheduling posts publicly, so both always need an explicit confirm step. Schedule only to the Exponent YouTube account through OpusClip, never to Ace Your Interviews.

## Phases

1. **MVP 1: Generator (current focus).** Submit 2 YouTube links, OpusClip clips them, the agent scores them, the top 7 are highlighted, and they're scheduled to the Exponent YouTube channel. See Weekly flow.
2. **Phase 2:** YouTube metrics, V1 data import, Vercel deploy, login, GitHub Actions routines.
3. **Phase 3:** Instagram and TikTok.
4. **Phase 4:** RAG, similar-clip retrieval, weekly learnings.
