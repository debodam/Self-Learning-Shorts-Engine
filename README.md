# aced-shorts-engine

Aced Shorts Engine: automated short-form content system.

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

Three GitHub Actions workflows, manual trigger only for now (**Actions > workflow > Run workflow**):

| Workflow | What it does | Run locally |
| --- | --- | --- |
| Weekly candidates | Finds new long-form uploads, submits them to OpusClip, imports finished clips, and scores them with the agent | `npm run job:weekly-candidates` |
| Metrics pull | Saves every Short on the Aced YouTube channel with a views, likes, and comments snapshot, and links the ones we posted (same as Pull metrics now) | `npm run job:metrics-pull` |
| Weekly learnings | Compares predicted and actual views for last week's posts and writes the learnings entry | `npm run job:weekly-learnings` |

Add `-- --dry-run` (or tick **Dry run** in Actions) to read everything and write nothing. Without Supabase keys every run is a dry run. Keys and where they come from are in [SETUP.md](SETUP.md).
