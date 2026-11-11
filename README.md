# Aced Shorts Engine

An internal dashboard and Claude agent that turns Aced's long-form YouTube videos into Shorts, posts them, measures how they do, and learns from the results.

## What it does

- **Review (MVP 1, the Generator).** Add the week's 2 Aced videos, as YouTube links or uploaded MP4 or MOV files (uploads go straight from the browser to OpusClip). They go to OpusClip with the Aced template, the clips sync back, and Claude scores each one on the rubric (Hook, Tension, Standalone, Payoff, Loopability) from its transcript and frames. The top 7 are picked automatically, each gets a headline baked into the video, and Claude writes one caption per clip. You review, swap picks, and schedule or post through OpusClip to YouTube (the Exponent channel), TikTok, and Instagram (Aced accounts). Scheduling and Post now always show a confirm step that names the platforms and accounts.
- **Performance (MVP 2).** Every Short on the Aced YouTube channel, pulled daily with the YouTube Data API: views, likes, comments, views at 48 hours and 7 days, and settled views (the main performance number). Claude Haiku labels each Short's format, and Shorts we posted are linked to their clips.
- **Scoring memory.** Every clip and Short has a Voyage embedding. When a clip is scored, the 5 most similar past Shorts and their settled views go into the prompt, and Claude predicts a views range. The top 7 ranks by rubric and predicted views together.
- **Learnings (the learning loop).** The scoring prompt is versioned. Prediction accuracy is tracked per version and backtested on the channel's past Shorts. A weekly report writes what worked and what didn't and proposes up to 3 prompt changes, each backtested. Nothing changes until you approve one; any version can be rolled back to.
- **Access.** The whole site sits behind one shared password (`DASHBOARD_PASSWORD`). There are no user accounts yet.

It's a Next.js app with Supabase (Postgres and pgvector), the Claude API, the OpusClip API, the YouTube Data API, and Voyage AI. Scheduled jobs run in GitHub Actions and the dashboard runs on Vercel. Every integration falls back to mock data when its key is missing, so the app always runs. Keys, GitHub Actions secrets, and the Vercel deploy steps are in [SETUP.md](SETUP.md).

## Running it locally

```bash
npm install
```

Copy `.env.example` to `.env.local`, set `DASHBOARD_PASSWORD` and any keys you have, then start the dev server and open http://localhost:3000:

```bash
npm run dev
```

## Importing V1 clip performance

`scripts/import-v1-performance.mts` loads performance history from V1 into the `source_videos`, `clips`, `posts`, and `metrics` tables.

### CSV format

One row per clip per platform. [`data/v1-clip-performance.sample.csv`](data/v1-clip-performance.sample.csv) shows every column.

| Column | Required | Notes |
| --- | --- | --- |
| `source_video_url` | Yes | YouTube URL of the long-form video. Matches existing source videos. |
| `source_video_title` | Yes | |
| `source_video_channel` | Yes | For example `Aced`. |
| `clip_title` | Yes | With the source video URL, identifies the clip across rows. |
| `format` | Yes | `mock` or `conversational`. Must be the same on every row for a clip. |
| `platform` | Yes | `youtube`, `tiktok`, or `instagram`. One row per clip per platform. |
| `posted_at` | Yes | ISO 8601, for example `2026-09-14T16:00:00Z`. |
| `platform_post_id` | No | The platform's ID for the post. |
| `caption` | No | |
| `captured_at` | With metrics | When the metrics were read. Required if any metric column has a value. |
| `views`, `shares`, `saves`, `follows_gained`, `comments` | No | Whole numbers. Leave blank if the platform doesn't report one. |
| `avg_percent_watched` | No | 0 to 100. |

Leave all metric columns blank for a post with no numbers yet. The post is still created.

### Running it

Check the file first. This validates every row and writes nothing:

```bash
npm run import:v1 -- data/v1-clip-performance.sample.csv --dry-run
```

Then import it. The script reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`. If either is missing it does a dry run instead.

```bash
npm run import:v1 -- path/to/v1-export.csv
```

How it behaves:

- The whole file is validated before anything is written. If any row has a problem, it lists every problem with its line number and imports nothing.
- Imported clips get the status `posted`, and their posts get the status `posted`.
- Running the same file again is safe. Videos, clips, and posts are matched and updated, and a metrics snapshot is only added once per post and `captured_at`. To add newer numbers, import rows with a later `captured_at`.
- Writes are not one transaction. If a run stops partway (for example a network error), fix the cause and run it again.

## Scheduled jobs

Three GitHub Actions workflows. Metrics pull runs daily at 13:00 UTC and Weekly report on Mondays at 14:00 UTC; Weekly candidates is manual for now (**Actions > workflow > Run workflow**):

| Workflow | What it does | Run locally |
| --- | --- | --- |
| Weekly candidates | Finds new long-form uploads, submits them to OpusClip, imports finished clips, and scores them with the agent | `npm run job:weekly-candidates` |
| Metrics pull | Saves every Short on the Aced YouTube channel with a views, likes, and comments snapshot, updates views at 48h and 7d and settled views, links the ones we posted, and labels new Shorts' format with Claude Haiku (same as Pull metrics now) | `npm run job:metrics-pull` |
| Embed | Embeds new clips and Shorts with Voyage for similar-Short search in scoring; runs daily after the metrics pull. `-- --all` re-embeds everything. | `npm run job:embed` |
| Label Shorts | Labels unlabeled Shorts' format with Claude Haiku and prints the breakdown and cost; `-- --all` relabels every Short. Not a workflow. | `npm run job:label-shorts` |
| Weekly report | Measures prediction accuracy, writes the week's learnings, proposes up to 3 scoring prompt changes, and backtests each (Mondays 14:00 UTC, or Run weekly report now on the Learnings page). Nothing changes until approved. | `npm run job:weekly-report` |
| Backtest | Backtests the active scoring prompt on every eligible channel Short, for the accuracy baseline the weekly report reads. Run it after a new prompt version goes live. Not a workflow. | `npm run job:backtest` |

Add `-- --dry-run` (or tick **Dry run** in Actions) to read everything and write nothing. Without Supabase keys every run is a dry run. Keys and where they come from are in [SETUP.md](SETUP.md).
