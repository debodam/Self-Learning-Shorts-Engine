# Setup and key migration

Every key the app and the scheduled jobs use, where to get it, and whose account it lives on today. The keys in use now are temporary. When they move to Aced's accounts, work through the [migration checklist](#migration-checklist) at the end. The tables double as the record of what still has to move.

Anything without its keys falls back to mock data, so the app and the jobs run with none of these set. The Settings page shows which integrations are connected.

## Where keys go

| Place | Used by | How to set |
| --- | --- | --- |
| `.env.local` (repo root, never committed) | Local dev server and `npm run job:*` / `npm run import:v1` | Copy `.env.example` to `.env.local` and fill it in. Restart the dev server after changes. |
| GitHub Actions secrets | The workflows in `.github/workflows` | Repo **Settings > Secrets and variables > Actions > New repository secret**, or `gh secret set NAME`. Names must match exactly. |
| Vercel environment variables | The deployed dashboard (once it's on Vercel) | Project **Settings > Environment Variables**. Redeploy after changes. |

Which secrets each workflow reads:

| Workflow | Secrets |
| --- | --- |
| Weekly candidates | Supabase (all 3), `ANTHROPIC_API_KEY`, `OPUSCLIP_API_KEY`, `OPUSCLIP_ORG_ID`, YouTube (all 4) |
| Metrics pull | Supabase (all 3), `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`, and optionally `ANTHROPIC_API_KEY` (labels new Shorts) |
| Weekly learnings | Supabase (all 3), `ANTHROPIC_API_KEY` |

Metrics pull runs daily at 13:00 UTC and can also be run by hand. Weekly candidates and Weekly learnings are manual for now: **Actions > (workflow) > Run workflow**. Tick **Dry run** to read everything and write nothing. Without the Supabase secrets, a manual run of those two is a dry run; a scheduled metrics pull fails instead.

### Daily metrics pull: adding the secrets

1. Open the repository on GitHub: **github.com/debodam/aced-shorts-engine**.
2. Click **Settings** (top tab bar), then in the left sidebar **Secrets and variables > Actions**.
3. On the **Secrets** tab, click **New repository secret**. Add each secret below, one at a time: paste the name exactly into **Name**, the value into **Secret**, then click **Add secret**. Copy each value from `.env.local`, without quotes or spaces around it.
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `YOUTUBE_API_KEY`
   - `YOUTUBE_CHANNEL_ID` (`UCjm_qVkCPjOVDz9BWjNqO9A`, the @aced_io channel)
   - `ANTHROPIC_API_KEY` (optional: labels new Shorts' format with Claude Haiku, a fraction of a cent each)
4. Check the list shows every name above. GitHub never shows a secret's value again; to change one, click it and choose **Update**.
5. Test it: click **Actions** (top tab bar), pick **Metrics pull** on the left, click **Run workflow**, leave **Dry run** unticked, and click the green **Run workflow** button. After a minute or two the run should show a green check, and the run's summary lists how many Shorts it pulled.
6. From then on it runs every day at 13:00 UTC. If a run fails (a missing or wrong secret, a YouTube or Supabase error), the run turns red and GitHub emails you. GitHub pauses scheduled workflows after 60 days with no commits to the repository; re-enable it from the **Actions** tab if that happens.

## Keys

The **Current account** column is for whoever holds each key today. Fill it in when a key is created, and update it when the key moves.

### Supabase

| Key | Where to get it | Current account | Moves to |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard > the project > **Project Settings > API**: Project URL | _fill in_ | Aced's Supabase organization |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page, **API Keys**: the `anon` public key | _fill in_ | Aced's Supabase organization |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page: the `service_role` secret key. Full database access, server only. Never expose it to the browser. | _fill in_ | Aced's Supabase organization |

Notes:
- After creating a project, apply the schema: `supabase link --project-ref <ref>` then `supabase db push` (runs everything in `supabase/migrations`).
- Newer Supabase projects also offer "publishable" and "secret" API keys. Either the legacy `anon`/`service_role` keys or the new pair works with the client this app uses.

### Claude

| Key | Where to get it | Current account | Moves to |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | [Claude Console](https://platform.claude.com) > **Settings > API Keys > Create Key**, in the workspace that should be billed | _fill in_ | Aced's Anthropic organization |

### OpusClip

| Key | Where to get it | Current account | Moves to |
| --- | --- | --- | --- |
| `OPUSCLIP_API_KEY` | OpusClip account settings, API section. API access needs a Pro, Max, or Business plan. See the [API docs](https://help.opus.pro/api-reference/overview). | _fill in_ | Aced's OpusClip workspace |
| `OPUSCLIP_ORG_ID` (optional) | Only needed if the API key's user belongs to more than one Opus organization. Ask Opus support or check the workspace settings. | _fill in_ | Aced's OpusClip workspace |

Notes:
- The social accounts Opus posts to (Aced's YouTube, TikTok, and Instagram) are connected inside the Opus workspace, not through a key here. Scheduling needs each account's `postAccountId` from `GET /api/social-accounts?q=mine`.
- Opus projects belong to the account that created them. `source_videos.opus_project_id` points at projects in the current Opus account. After switching accounts, clips from old projects can't be fetched again, so finish importing any pending projects first.

### YouTube

| Key | Where to get it | Current account | Moves to |
| --- | --- | --- | --- |
| `YOUTUBE_API_KEY` | [Google Cloud Console](https://console.cloud.google.com): create or pick a project, enable **YouTube Data API v3**, then **APIs & Services > Credentials > Create credentials > API key**. Restrict it to the YouTube Data API v3. Public data only: views, likes, and comments. A full pull costs about 35 of the 10,000 daily quota units. | _fill in_ | Aced's Google Cloud project |
| `YOUTUBE_CHANNEL_ID` | The Aced channel, @aced_io: `UCjm_qVkCPjOVDz9BWjNqO9A`. Never Ace Your Interviews. | Aced YouTube channel | Unchanged unless the channel changes |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | Not used yet. An OAuth client authorized by a channel owner, with **YouTube Analytics API** enabled and the scopes `youtube.readonly` and `yt-analytics.readonly`, would add retention and subscribers gained later. | _not set_ | Aced's Google Cloud project |

Notes for the OAuth client, if it's added later:
- While the OAuth consent screen is in **Testing**, refresh tokens expire after 7 days. Publish the app (internal or production) before relying on the token.
- The refresh token is tied to the Google account that authorized it. If that person loses access to the channel, the token stops working.

### Instagram

| Key | Where to get it | Current account | Moves to |
| --- | --- | --- | --- |
| `INSTAGRAM_ACCESS_TOKEN` | [Meta for Developers](https://developers.facebook.com): create a Business app with the Instagram product. The Instagram account must be a Business or Creator account linked to a Facebook Page. Generate a token with `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, and `pages_read_engagement`. | _fill in_ | A system user in Aced's Meta Business Manager |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Graph API Explorer: `GET /me/accounts?fields=instagram_business_account` with the token above | Aced Instagram account | Unchanged unless the account changes |

Notes:
- User tokens from the Graph API Explorer expire within hours; long-lived user tokens last 60 days. For Aced, use a **system user** token from Business Manager, which doesn't expire.
- The code pins Graph API v26.0. See the TODO in `src/lib/integrations/instagram.ts`.

### TikTok

| Key | Where to get it | Current account | Moves to |
| --- | --- | --- | --- |
| `TIKTOK_CLIENT_KEY` | [TikTok for Developers](https://developers.tiktok.com): create an app, add Login Kit and the Display API with scopes `user.info.basic` and `video.list`. The key is on the app page. | _fill in_ | Aced's TikTok developer organization |
| `TIKTOK_CLIENT_SECRET` | Same app page | _fill in_ | Aced's TikTok developer organization |
| `TIKTOK_ACCESS_TOKEN` | Authorize the app as the Aced TikTok account through Login Kit, then exchange the code at `POST https://open.tiktokapis.com/v2/oauth/token/` | _fill in_ (the TikTok account that authorized) | The Aced TikTok account, through Aced's app |

Notes:
- Access tokens expire after 24 hours. The code doesn't refresh them yet (TODO in `src/lib/integrations/tiktok.ts`), so the metrics pull needs a fresh token until that's built. Refresh tokens last 365 days.
- An app has to pass TikTok's review before it can read accounts other than the developer's own test users.

## Migration checklist

Do this when the keys move to Aced's accounts. Each step lists what to verify.

1. **Supabase.** Create the project in Aced's organization and run `supabase db push`. To keep existing data, dump it from the old project (`supabase db dump --data-only`) and restore it into the new one. Update the 3 Supabase keys everywhere they're set. Verify: Settings shows Supabase connected and Review, Performance, and Learnings show the same data as before.
2. **Claude.** Create a key in Aced's Anthropic organization and update `ANTHROPIC_API_KEY`. Verify: run **Weekly learnings** with **Dry run** ticked and check the run summary says Claude is live.
3. **OpusClip.** Finish importing any pending Opus projects first (run **Weekly candidates** until it reports no projects waiting). Then create the key in Aced's Opus workspace, connect Aced's social accounts there, and update `OPUSCLIP_API_KEY` (and `OPUSCLIP_ORG_ID` if needed). Verify: a dry run of **Weekly candidates** reports OpusClip live.
4. **YouTube.** Create the OAuth client in Aced's Google Cloud project, publish the consent screen, authorize as an Aced account with channel access, and update all 4 YouTube keys. Verify: a dry run of **Metrics pull** lists real YouTube videos.
5. **Instagram.** Create a system user in Aced's Business Manager with access to the app and the Instagram account, generate its token, and update both Instagram keys. Verify: the **Metrics pull** dry run lists real Reels.
6. **TikTok.** Create the app under Aced's developer organization (and get it reviewed), authorize as the Aced account, and update the 3 TikTok keys. Verify: the **Metrics pull** dry run lists real TikTok videos.
7. **Everywhere.** Make sure each changed key is updated in all three places: `.env.local`, GitHub Actions secrets, and Vercel.
8. **Revoke the old keys** in each temporary account once the new ones are verified, and update the **Current account** column above.
