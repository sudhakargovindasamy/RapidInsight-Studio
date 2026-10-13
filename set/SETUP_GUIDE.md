# RapidInsight Studio — Backend Setup Guide (Local)

Follow the steps **in order**. Don't skip any. Total time: about 30–45 minutes (most of it is waiting for downloads).

---

## 0. What you are setting up

The backend is **9 small programs ("services")**. Each one runs on its own port. The **gateway** is the front door — the frontend only talks to the gateway, and the gateway forwards to the others.

| Service | Port | Language | What it does |
|---|---|---|---|
| gateway | 3000 | Node | Front door. Checks login, forwards requests |
| schema-service | 3001 | Node | Upload and store schemas |
| datagen-service | 3002 | Node | Asks sdv-service to generate data |
| table-service | 3003 | Node | Creates and fills tables |
| report-service | 3004 | Node | Reports (not started by `npm run dev`, see Step 7) |
| ai-service | 3005 | Node | Talks to the AI provider (Groq, etc.) |
| *(frontend)* | 3006 | — | The website (separate repo/folder) |
| project-service | 3007 | Node | Projects |
| sdv-service | 3008 | **Python** | Synthetic data generation |
| export-service | 3009 | Node | Exports (not started by `npm run dev`, see Step 7) |

You do **not** need to remember this. Just keep it handy in case a port is "already in use".

---

## 1. Install the tools (one time)

| Tool | Version | Check it works |
|---|---|---|
| Node.js | 20 or newer (24 works) | `node -v` |
| Python | 3.11 or newer (3.14 works) | `python --version` |
| Git | any | `git --version` |

**Windows only — IMPORTANT:** the Python install downloads a big library (`torch`). Windows can fail with `WinError 206: filename too long`. The setup script already avoids this by creating the Python environment at **`C:\sdvenv`**. Just make sure you can write to `C:\`.

---

## 2. Get the code

```bash
git clone <REPO_URL_FROM_YOUR_MENTOR>
cd data-analytics-lab-rapidInsghtStudio
git checkout development
```

Always work from the **`development`** branch (create your own branch from it for your tasks).

---

## 3. Install everything (one command)

```bash
cd backend
npm install
```

This single command:
1. installs the Node packages for **every** service, and
2. creates the Python environment and installs SDV (this is the slow part — **5–15 minutes**, several GB; let it finish).

When it ends you should see something like:
`sdv 1.37.x | torch 2.x.x` and `Done. sdv-service will use: ...`

If it fails near the end, read **Troubleshooting** at the bottom.

---

## 4. Get the secret values from your mentor

Ask your mentor for these **5 things**. They are shared secrets and are **never** put in Git or chat screenshots.

| # | What | Used by |
|---|---|---|
| 1 | `SUPABASE_URL` | gateway, project, schema, table |
| 2 | `SUPABASE_PUBLISHABLE_KEY` | gateway, project, schema, table |
| 3 | `SUPABASE_SERVICE_ROLE_KEY` | gateway, project, schema |
| 4 | `DATABASE_URL` (Supabase Postgres connection string) | project, schema, table |
| 5 | `AI_API_KEY` (or create your own Gemini key, see Step 5.6) | ai-service |


---

## 5. Create the `.env` file for each service

Each service has a file called `.env.example`. You copy it to `.env` and fill in the blanks.

**Do this for all services** — from the `backend` folder:

**Windows (PowerShell):**
```powershell
foreach ($s in 'gateway','project-service','schema-service','table-service','datagen-service','ai-service','report-service','export-service','sdv-service') {
  Copy-Item "services\$s\.env.example" "services\$s\.env"
}
```

**Mac / Linux:**
```bash
for s in gateway project-service schema-service table-service datagen-service ai-service report-service export-service sdv-service; do
  cp services/$s/.env.example services/$s/.env
done
```

Now open each `.env` and set the values below. Anything **not listed** can stay as it is — the defaults are fine.

Legend: 🔑 = paste your value from Step 4. Everything else = leave as written.

### 5.1 gateway — `services/gateway/.env`
```env
NODE_ENV=development
PORT=3000
TRUST_PROXY=false
SHUTDOWN_TIMEOUT_MS=10000

FRONTEND_ORIGIN=http://localhost:3006

SUPABASE_URL=🔑
SUPABASE_PUBLISHABLE_KEY=🔑
SUPABASE_SERVICE_ROLE_KEY=🔑
INTERNAL_SERVICE_KEY=🔑 (the one you generated)

PROJECT_SERVICE_URL=http://localhost:3007
SCHEMA_SERVICE_URL=http://localhost:3001
DATAGEN_SERVICE_URL=http://localhost:3002
TABLE_SERVICE_URL=http://localhost:3003
REPORT_SERVICE_URL=http://localhost:3004
AI_SERVICE_URL=http://localhost:3005
SDV_SERVICE_URL=http://localhost:3008
EXPORT_SERVICE_URL=http://localhost:3009
```

### 5.2 project-service — `services/project-service/.env`
```env
PORT=3007

SUPABASE_URL=🔑
SUPABASE_PUBLISHABLE_KEY=🔑
SUPABASE_SERVICE_ROLE_KEY=🔑
INTERNAL_SERVICE_KEY=🔑

DATABASE_URL=🔑
```

### 5.3 schema-service — `services/schema-service/.env`
```env
PORT=3001

SUPABASE_URL=🔑
SUPABASE_PUBLISHABLE_KEY=🔑
SUPABASE_SERVICE_ROLE_KEY=🔑
INTERNAL_SERVICE_KEY=🔑

DATABASE_URL=🔑

SCHEMA_BUCKET=schemas
MAX_SCHEMA_FILE_SIZE_MB=5

AI_SERVICE_URL=http://localhost:3005
SEED_REQUEST_TIMEOUT_MS=300000
SEED_STALE_AFTER_MS=420000
```

### 5.4 table-service — `services/table-service/.env`
```env
PORT=3003

SUPABASE_URL=🔑
SUPABASE_PUBLISHABLE_KEY=🔑
INTERNAL_SERVICE_KEY=🔑

DATABASE_URL=🔑

AI_SERVICE_URL=http://localhost:3005
DATAGEN_SERVICE_URL=http://localhost:3002

DATAGEN_TIMEOUT_MS=900000
AI_STEP_DELAY_MS=3000
```

### 5.5 datagen-service — `services/datagen-service/.env`
```env
PORT=3002

INTERNAL_SERVICE_KEY=🔑

SDV_SERVICE_URL=http://localhost:3008
SDV_TIMEOUT_MS=300000
```

### 5.6 ai-service — `services/ai-service/.env`

The AI service needs **one AI provider** to work. 

#### Step 1 (Gemini): Create your own API key

1. Open **https://aistudio.google.com/apikey** and sign in with your Google account.
2. Click **Create API key**.
3. If asked, choose a project (or **Create API key in new project**).
4. Copy the key (it starts with `AIza...`). Paste it in your private notepad.
5. Never post this key in chat, Git, or screenshots. If it leaks, go back to the same page, delete it, and create a new one.

> The free tier has per-minute limits. You may see `429` messages while data is generated. That's normal, the service waits and retries by itself.

#### Step 2 (Gemini): Put it in the `.env`

Open `services/ai-service/.env` and set it **exactly** like this:

```env
PORT=3005
INTERNAL_SERVICE_KEY=🔑 (the one you generated in Step 4)

AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
AI_API_KEY=PASTE_YOUR_GEMINI_KEY_HERE

SEED_AI_MODEL=gemini-3.5-flash-lite
SEED_BATCH_DELAY_MS=1500
AI_MIN_REQUEST_GAP_MS=1200
AI_MAX_RATE_LIMIT_WAIT_MS=90000
AI_MAX_ATTEMPTS=3
```

Rules:
- `AI_API_KEY=AIza...` has no quotes and no spaces.
- `AI_MODEL` and `SEED_AI_MODEL` must both be **Gemini** model names. Mixing providers (e.g. a `llama-...` model with `AI_PROVIDER=gemini`) will fail.


#### Step 3 (Gemini): Restart and test

1. In the terminal running the backend press `Ctrl + C`, then run `npm run dev` again. `.env` is only read at startup.
2. Check the ai-service health:
   ```bash
   curl http://localhost:3005/health
   ```
3. Upload a schema with **Generate mock data** in the app. If it works, your key is good.

If you see `GEMINI_API_KEY_MISSING`, the `AI_API_KEY` line is empty or misspelled. If you see `400` / `403`, the key is wrong or was deleted: create a new one.

### 5.7 report-service — `services/report-service/.env`
```env
PORT=3004
INTERNAL_SERVICE_KEY=🔑
```

### 5.8 export-service — `services/export-service/.env`
```env
PORT=3009
INTERNAL_SERVICE_KEY=🔑
```

### 5.9 sdv-service (Python) — `services/sdv-service/.env`
```env
PORT=3008
INTERNAL_SERVICE_KEY=🔑

SDV_ARTIFACT_DIR=.artifacts
SDV_ARTIFACT_MAX_COUNT=200
SDV_MEMORY_CACHE_SIZE=16
SDV_MAX_SEED_ROWS=5000
SDV_MAX_SAMPLE_ROWS=100000
SDV_MAX_COLUMNS=120
SDV_MIN_SEED_ROWS=20
SDV_WORKERS=2
SDV_QUALITY_WARN_THRESHOLD=0.6
SDV_TVAE_EPOCHS=300
SDV_CTGAN_EPOCHS=300
```

---

## 6. Quick check of your `.env` files (the 3 golden rules)

1. ✅ `INTERNAL_SERVICE_KEY` is **identical** in all 9 files. (A mismatch = `401 Unauthorized` between services.)
2. ✅ No leftover text like `replace-me` or `your-project.supabase.co`.
3. ✅ No spaces around `=` and no quotes. Write `PORT=3001`, not `PORT = "3001"`.

---

## 7. Start the backend

From the `backend` folder:

```bash
npm run dev
```

This starts **gateway, project, schema, table, datagen, ai and sdv** together, with colored labels per service. Leave this terminal open.

> `report-service` (3004) and `export-service` (3009) are **not** included in `npm run dev`. Only start them if your task needs them, in two extra terminals:
> ```bash
> npm run dev --prefix services/report-service
> npm run dev --prefix services/export-service
> ```

**The first start is slow for sdv-service** (Python loads a big library). Wait until you see it say it's running on port 3008.

---

## 8. Check that it works

Open a **second** terminal and run:

```bash
curl http://localhost:3000/health
curl http://localhost:3008/health
```

Both should answer with a status like `ok`. If both do, you're done 🎉

Optional: open http://localhost:3008/docs to see the sdv-service API page.

To run the website: follow the frontend's own README. It must run on **port 3006** and call the gateway at `http://localhost:3000`.

---

## 9. Everyday commands

| I want to… | Command (from `backend`) |
|---|---|
| Start everything | `npm run dev` |
| Stop everything | `Ctrl + C` in that terminal |
| Check sdv-service | `npm run check:sdv` |
| Reinstall Python part only | `npm run setup:sdv` |
| Reinstall Node packages of one service | `cd services/<name>` then `npm install` |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE` / "port already in use" | Something else is using that port, or you started the backend twice. Close the old terminal, or find the process: Windows `netstat -ano \| findstr :3000` then `taskkill /PID <id> /F`. |
| `401 Unauthorized` between services | `INTERNAL_SERVICE_KEY` differs somewhere. Make all 9 identical, then restart. |
| `WinError 206 filename too long` during install | Run `set SDV_VENV_DIR=C:\sdvenv` then `npm run setup:sdv`. |
| `import sdv` fails / sdv-service won't start | Run `npm run setup:sdv` again and read the last error. Needs Python 3.11+. |
| Data generation fails | sdv-service must be running (`npm run check:sdv`). There is no fallback generator. |
| `429` / rate-limit messages in ai-service | Normal on free AI plans. It retries on its own — just wait. |
| `Cannot find module ...` | Run `npm install` inside that service's folder. |
| Changed a `.env` but nothing changed | Stop (`Ctrl+C`) and run `npm run dev` again. `.env` is only read at startup. |
| Gateway says it can't reach a service | That service crashed. Scroll up in the terminal to its colored label and read its error. |

---

## Safety rules (please read)

- **Never commit `.env` files.** Only `.env.example` goes in Git. Run `git status` before every commit.
- **Never share keys** in chat screenshots, tickets, or PRs.
- Don't run SQL on the shared database unless your mentor approved it.
- Stuck for more than 20 minutes? Ask. Send: the **service name**, the **exact error text** (copy/paste), and **which step** you were on.
