# Deployment

How the app is deployed on free tiers, with every setting and step. Written on 2026-10-21 after the first deployment.
Prices and limits of the platforms change often: check each vendor's page before relying on them.

## Where it runs

| Part | Platform | Address | Plan |
|---|---|---|---|
| Frontend (Next.js) | [Vercel](https://vercel.com) | https://coa-pink-seven.vercel.app | Hobby (free, non-commercial use only) |
| Backend (FastAPI + workers) | [Render](https://render.com) web service, Docker | https://coa-j8vv.onrender.com | Free |
| Database (Postgres + pgvector) | [Neon](https://neon.com) | private connection string | Free |
| Sign-in | [WorkOS](https://workos.com) AuthKit | hosted by WorkOS (staging environment) | Free |
| Language model | [OpenRouter](https://openrouter.ai) (`openai/gpt-5-mini`) | API | **Paid per run**, not free |

```
Browser ──► Vercel (Next.js, WorkOS AuthKit)
   │            │
   │            └──► WorkOS (sign-in page, tokens)
   │
   └──► Render (FastAPI + 2 worker threads)  ──► OpenRouter (model calls)
              │
              └──► Neon Postgres + pgvector (runs, users, agent checkpoints, memory)
```

How a request flows:
1. The browser loads the page from Vercel. Vercel's `proxy.ts` sends signed-out visitors to `/login`.
2. Signing in goes to WorkOS and comes back to `/auth/callback` on Vercel, which stores the session in a cookie.
3. The browser then calls the **backend directly** (`NEXT_PUBLIC_API_URL`) with the session's access token as `Authorization: Bearer ...`.
   Uploads therefore never pass through Vercel.
4. The backend checks the token against WorkOS's public keys (`WORKOS_CLIENT_ID`), queues the job in memory and runs it in a worker thread.
   Jobs, users, the agent's checkpoints and the memory are in Neon. The uploaded PDFs are on the backend's **local disk**.

### Why not all on one platform

- **The backend cannot run on Vercel.** It keeps an in-memory job queue and worker threads, a run takes 1.5 to 2.5 minutes, and a
  serverless function freezes background work when it answers. It also writes the PDFs to local disk.
- **It cannot run on Neon either.** Neon Functions run Node.js only (no Python, no Docker), and Neon says to host the frontend elsewhere.
  Neon holds the data only. Neon Auth (Better Auth) is not used, because sign-in is WorkOS: leave it off when creating the project.

## Environment variables

### Backend (Render → service → Environment)

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | yes | Neon's **direct** (non-pooled) connection string, ending in `?sslmode=require`. The host must **not** contain `-pooler`. |
| `OPENROUTER_API_KEY` | yes | A key made only for this deployment, with a **credit limit** set in OpenRouter. |
| `WORKOS_CLIENT_ID` | yes | The WorkOS client id (`client_...`). The **same value** as on Vercel. Without it the API answers 503. |
| `CORS_ORIGINS` | yes | `https://coa-pink-seven.vercel.app` exactly: no trailing slash, no quotes, no wildcard. Comma-separated for more than one. |
| `PORT` | yes | `8000` (the Dockerfile starts uvicorn on 8000; Render defaults to 10000). |
| `MAX_CONCURRENT_RUNS` | no | Worker threads, default 3. |
| `MAX_UPLOAD_MB` | no | Largest upload, default 20. |
| `MAX_ACTIVE_JOBS_PER_USER` | no | Queued or running jobs per person, default 20. |
| `RATE_LIMIT` | no | Requests one address may make to the jobs routes (not `/health`), default `60/minute`; more are refused with 429. The counts are kept in memory, per process. The page polls once a second while a run is active, which is about 60 requests a minute from one tab: consider `600/minute` here (see Troubleshooting). |
| `FORWARDED_ALLOW_IPS` | no | Read by uvicorn, not by the app. Behind Render's proxy the rate limit sees the proxy's address unless this is `*`, so every person would share one limit. `*` trusts the forwarding header from anyone, which lets a client fake its address: acceptable for a demo. |
| `EMBEDDING_MODEL`, `MEMORY_MIN_SCORE` | no | The memory's embedding model and similarity threshold; leave the defaults. |
| `CHECKPOINT_SCHEMA` | no | Schema of the agent's tables, default `langgraph`. |
| `JOBS_DIR` | no | Where the PDFs are saved, default `backend/data/` (ephemeral on Render). |
| `RESEND_API_KEY`, `SMTP_FROM`, `NOTIFY_EMAIL`, `APP_URL` | no | The mail for a non-conforming lot, sent through [Resend](https://resend.com)'s HTTP API. **Not set**: the mail is off. `RESEND_API_KEY` is a secret (`re_...`). `NOTIFY_EMAIL` is who gets it. `APP_URL` is the Vercel address, so the mail links to the run. `SMTP_FROM` is the sender: it defaults to `onboarding@resend.dev`, which only delivers to the address you signed up to Resend with; to mail anyone else, verify a domain in Resend and use an address on it. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | no | Mail over SMTP instead. **Does not work on Render's free plan**, which blocks outbound ports 25, 465 and 587 ([changelog](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports)). Ignored when `RESEND_API_KEY` is set. |
| `LANGSMITH_*` | no | Optional tracing, see the README. |

### Frontend (Vercel → project → Settings → Environment Variables)

| Variable | Required | Value |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | `https://coa-j8vv.onrender.com`, no trailing slash. Public by design: the browser needs it. |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | yes | `https://coa-pink-seven.vercel.app/auth/callback`. Public by design. |
| `WORKOS_CLIENT_ID` | yes | The same client id as on Render. |
| `WORKOS_API_KEY` | yes | `sk_...`, a **secret**. Never give it the `NEXT_PUBLIC_` prefix. |
| `WORKOS_COOKIE_PASSWORD` | yes | 32+ random characters, a **secret**: `openssl rand -base64 32`. Use a new one, not the local one. |

Rules:
- `NEXT_PUBLIC_*` values are written into the browser bundle **when Vercel builds**. After changing one, **redeploy** the project.
- Vercel warns that `NEXT_PUBLIC_` values are exposed to the browser. For the two above that is intended: keep the prefix, or the app
  falls back to `http://localhost:8000`.
- Do **not** set `WORKOS_CLAIM_TOKEN` on Vercel: it only belongs to the local quick-start environment.
- Secrets live only in the platforms' environment stores. `.env` files are gitignored.

### WorkOS dashboard (not an env variable, but it must match)

Under the application's **Redirects** settings (the dashboard's field names change; these are the ones it shows now):

| Field | Value |
|---|---|
| Redirect URIs | `https://coa-pink-seven.vercel.app/auth/callback` (keep `http://localhost:3000/auth/callback` for local development) |
| Initiate login URI | `https://coa-pink-seven.vercel.app/sign-in` |
| Sign-out URIs | `https://coa-pink-seven.vercel.app` (and `https://coa-pink-seven.vercel.app/login` if you like) |

Sign-up URL, User invitation URL and Password reset URL can stay unset.

Use the project's stable `*.vercel.app` domain, never a per-deployment URL: those change on every deploy.

## Setting it up from scratch

Do it in this order, because later steps need the addresses of the earlier ones.

### 1. OpenRouter: a capped key
Create a **new API key** for this deployment and set a **credit limit** on it (for example $5). Every upload costs real money, so do
this before anything is public.

### 2. Neon: the database
1. Create a project. Leave **Neon Auth**, the Data API and the other extras off: only Postgres is needed.
2. In the SQL editor run `CREATE EXTENSION IF NOT EXISTS vector;`
3. Click **Connect**, turn **Pooled connection off**, and copy the string. That is `DATABASE_URL`.

Why direct and not pooled: the backend sets its schema through the connection's `search_path` startup option (`in_schema` in
`backend/jobs.py`), and Neon's pooler refuses it with *"unsupported startup parameter in options: search_path"*.

### 3. WorkOS: sign-in
1. Make the environment yours: the local `.env` has a `WORKOS_CLAIM_TOKEN`, which means a temporary environment. Run the frontend
   locally, sign in, and claim it into a WorkOS account if offered (or check that it already appears in the dashboard).
2. Note the **client id** and the **API key** (`sk_...`, copyable only when created).
3. Generate the cookie password: `openssl rand -base64 32`.
4. The redirect URIs are added in step 7, once the Vercel address exists.

### 4. Render: the backend
1. New → **Web Service**, connect the GitHub repository.
2. **Language** Docker, **Root Directory** `backend`, **Instance type** Free, **one instance** only (the job queue is in memory).
3. **Health Check Path** `/health`.
4. Add the backend variables above. Set `CORS_ORIGINS` to `http://localhost:3000` for now.
5. Deploy and note the address. Check it (the first request after sleeping takes about a minute):
   ```bash
   curl https://coa-j8vv.onrender.com/health
   ```
   Expected answer: `{"status":"ok"}`. On startup the backend runs the Alembic migrations and creates the agent's tables.

### 5. Vercel: the frontend
1. Import the repository, **Root Directory** `frontend`, preset Next.js.
2. Add the frontend variables above.
3. Deploy. Note the stable `*.vercel.app` domain.

### 6. Connect the backend to the frontend
In Render set `CORS_ORIGINS` to the Vercel address (exactly) and let it redeploy. Verify:
```bash
curl -i -X OPTIONS https://coa-j8vv.onrender.com/jobs -H "Origin: https://coa-pink-seven.vercel.app" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization"
```
The answer must be a 200 with `access-control-allow-origin: https://coa-pink-seven.vercel.app`.

### 7. WorkOS: register the addresses
Add the redirect URI, the initiate login URI and the sign-out URI from the table above. No redeploy is needed.

### 8. Resend: the mail for a non-conforming lot (optional)
1. In Resend, create an API key with **sending access** only.
2. In Render set `RESEND_API_KEY`, `NOTIFY_EMAIL` and `APP_URL` (and `SMTP_FROM` once a domain is verified). Render restarts the service.
3. Upload `backend/docs/sample_coa_defective.pdf`: when the run is done, the mail should arrive, and the activity log's `notify_quality_team` step
   should say `sent`. A conforming lot (`sample_coa_citric_acid.pdf`) sends nothing. If it says `not sent: ...`, the Render logs have the reason.

### 9. Smoke test
1. Open the Vercel address and sign in.
2. Upload `backend/docs/sample_coa_citric_acid.pdf`: after about 2 minutes it should show a report.
3. Upload `backend/docs/sample_coa_unclear_units.pdf`: it should stop and ask a question. Answer it, then approve or reject.
4. Open the certificate from the run page.

## Day to day

- **Deploying.** Vercel and Render redeploy on a push to the connected branch (check each project's Git settings). Keep the Backend and
  Frontend GitHub Actions checks required on `main` so that `main` stays green.
- **Changing a setting.** Render restarts the service when an environment variable changes. On Vercel, a `NEXT_PUBLIC_*` change needs a
  redeploy.
- **Logs.** Render → service → Logs for the backend. Vercel → Deployments → the deployment → Logs for the frontend; a failed sign-in logs
  `the sign-in did not complete:` with the reason.
- **Rotating a secret.** Make a new one, update it on the platform, redeploy. A new cookie password signs everyone out.
- **Cost.** Each run costs OpenRouter credit (stored per run as `cost_usd`). Watch the credit and keep the key's limit low.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Backend log: `unsupported startup parameter in options: search_path` | `DATABASE_URL` is Neon's **pooled** string | Use the direct string (no `-pooler` in the host). |
| WorkOS page: "This is not a valid redirect URI" | The address is not registered in WorkOS | Add it under Redirects, exactly as in `NEXT_PUBLIC_WORKOS_REDIRECT_URI`. |
| After signing out you land on `error.workos.com/.../app-homepage-url-not-found` (the sign-out itself worked) | `signOut()` in `frontend/app/auth/sign-out/route.ts` names no return address, and WorkOS has no sign-out URI to send the browser to | Set **Sign-out URIs** in WorkOS to the app's address. If it still fails, pass an absolute `returnTo` (an allowed sign-out URI) to `signOut()`. |
| Opening `/auth/callback` yourself sends you to `/login` | Normal: it only works with the one-time code WorkOS sends | Test by signing in from the home page. |
| Back on `/login` after signing in | The sign-in failed on the server | Read the Vercel logs: a wrong `WORKOS_API_KEY` or `WORKOS_COOKIE_PASSWORD` shows there. |
| "The server cannot be reached" and the backend's health check works | CORS: `CORS_ORIGINS` does not match the Vercel address (the preflight answers `Disallowed CORS origin`) | Set it exactly, redeploy Render, repeat the preflight check. |
| Same message, CORS is right | `NEXT_PUBLIC_API_URL` is wrong or Vercel was not redeployed after changing it | Fix it and redeploy. |
| Every request answers 401 | `WORKOS_CLIENT_ID` differs between Vercel and Render | Use the same value in both. |
| Requests answer 429 ("the server answered 429"), intermittent "server cannot be reached" while a run is active, reports that do not appear | The rate limit (`RATE_LIMIT`, default `60/minute` per address) is reached: the page polls once a second, and behind Render's proxy everyone may share one address. Not confirmed on this deployment: look for `429` in the Render logs | Set `RATE_LIMIT` to `600/minute` and `FORWARDED_ALLOW_IPS` to `*` on Render. Longer term, limit per signed-in person and count only requests that change something, not polling. |
| Every request answers 503 | `WORKOS_CLIENT_ID` is missing on Render | Add it. |
| First load after a quiet period takes about a minute | Render's free service was asleep | Wait: the page retries by itself. |

### Open issue: the report is sometimes missing

After the first deployment, in about two of three runs the report did not show. The cause is **not confirmed yet**. There are four
places it can fail:

| What the person sees | Where | Likely cause |
|---|---|---|
| The run is Failed, with an error | The agent run | An OpenRouter error (for example a credit limit), a reply cut off by `MAX_OUTPUT_TOKENS` (12,000, reasoning included), or "connection closed" after Neon went idle |
| Done, with a red alert "The report could not be generated" | `render_ui` in `backend/react_agent/tools.py` | The model's reply was not valid JSON twice, so the fallback alert was stored |
| Done, with "The report could not be displayed: its layout is invalid" | `frontend/components/report-renderer.tsx` | The JSON parsed, but the frontend's component catalog rejects it (the backend checks only that `root` exists in `elements`) |
| Skeleton, or "cannot be reached" | The request | The 15 s timeout on Render's free CPU, or a restart |

To find out, run this in Neon's SQL editor (read-only):

```sql
SELECT id, filename, status, error,
       ui_spec::jsonb -> 'elements' -> 'alert' -> 'props' ->> 'title' AS alert_title,
       length(ui_spec) AS spec_chars, output_tokens, cost_usd
FROM runs ORDER BY seq DESC LIMIT 6;
```

`render_ui` does not log why it rejected a reply, so the Render logs will not show it. Candidate fixes once the cause is known: log the
rejection (reply length and finish reason), validate the spec against the frontend's rules before storing it, raise the token cap or
lower the reasoning effort for this step.

## Limitations and risks of this setup

1. **PDFs are lost whenever Render restarts or sleeps** (15 idle minutes). "Open the CoA" then answers 404, and a job caught mid-restart
   fails. Fix: store the PDFs in Postgres (`bytea`) or object storage (Neon Object Storage or Cloudflare R2).
2. **Neon scales to zero after 5 idle minutes.** The agent's checkpointer holds one connection for the life of the process, which may
   die when the compute suspends (untested). Fix: a `psycopg_pool.ConnectionPool` with a health check.
3. **Never run two backend instances at once.** On startup `requeue_unfinished` turns every `running` job into `queued`, so two
   overlapping instances (for example during a deploy) would both run the same job. Keep one instance and a recreate deploy; later,
   claim jobs with `FOR UPDATE SKIP LOCKED`.
4. **Denial of wallet.** Anyone who can sign in can spend OpenRouter credit. Keep the key's credit limit low, restrict who can sign up in
   WorkOS (invite only), and consider a daily cap per person (`MAX_ACTIVE_JOBS_PER_USER` limits only concurrency).
5. **The WorkOS environment is a staging one.** Move to a production environment (own keys, own redirect URIs) before real use.
6. **Not for real lot-release decisions.** The free database has no SLA and few backups, while the decision, who took it and why live
   there. Supplier CoAs are also sent to third-party model providers through OpenRouter.
7. **Mail needs a Resend key.** Render's free plan blocks SMTP, so the mail goes through Resend's HTTP API. Without `RESEND_API_KEY` it is off. The default sender only delivers to the Resend account's own address: verify a domain to mail a team.
8. **Vercel Hobby is for non-commercial use.** Commercial use needs Pro.
9. **Preview deployments do not sign in or reach the API:** each has its own address, in neither `CORS_ORIGINS` nor the WorkOS redirects.
10. **Dependencies are unpinned** (`backend/requirements.txt` has no versions), so a rebuild can pull different packages.

## Next steps, in order

1. Find and fix the missing report (see the open issue).
2. Keep the PDFs somewhere that survives restarts (limitation 1).
3. Pool the checkpointer's connection (limitation 2).
4. Pin the backend dependencies; run the container as a non-root user with a `HEALTHCHECK` on `/health`.
5. Invite-only sign-up and a daily spend cap (limitation 4); a WorkOS production environment.
6. Monitoring (an uptime check on `/health`, Sentry) and a scheduled `pg_dump` backup.

## Sources

- [Render free tier overview](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)
- [Neon free plan limits](https://neon.com/faqs/free-plan-limits-and-quotas)
- [Neon Functions](https://neon.com/functions) and [Neon full-stack apps](https://neon.com/use-cases/full-stack-apps)
- [Neon connection errors](https://neon.com/docs/connect/connection-errors#unsupported-startup-parameter)
- [Vercel free tier limits 2026](https://deploywise.dev/blog/vercel-free-tier-limits-2026)
- [WorkOS AuthKit for Next.js](https://workos.com/docs/authkit/nextjs)
