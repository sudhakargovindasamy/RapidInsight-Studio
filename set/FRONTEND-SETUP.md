# Setup Guide (RapidInsight Studio – Frontend)

This is a React app (built with Vite). Follow the steps in order.

## What you need first

1. **Node.js 18 or newer** – download from https://nodejs.org. Check it with:
   ```
   node -v
   ```
2. **A Supabase project** – you need its URL and its public key (Step 3).
3. **The backend API running** – the frontend talks to it. By default it is expected at `http://localhost:3000`.

## Step 1 – Get the code

```
git clone <repo-url>
cd data-analytics-lab-rapidInsghtStudio-FE
```

## Step 2 – Install packages

```
npm install
```

## Step 3 – Create your `.env` file

1. Copy the example file:
   - Windows (PowerShell): `copy .env.example .env`
   - Mac/Linux: `cp .env.example .env`
2. Open `.env` and fill in these 3 values:

| Variable | What to put | Where to find it |
|---|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL, e.g. `https://abcd1234.supabase.co` | Supabase dashboard → Project Settings → API → **Project URL** |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Supabase **publishable / anon** key | Same page → **Publishable key** (or **anon public** key) |
| `VITE_API_BASE_URL` | Address of the backend API, e.g. `http://localhost:3000` | Wherever your backend runs. No trailing `/` |

Example:
```
VITE_SUPABASE_URL=https://abcd1234.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxx
VITE_API_BASE_URL=http://localhost:3000
```

Important:
- Only use the **publishable/anon** key. **Never** put the `service_role` / secret key here – it would be visible to everyone in the browser.
- If you see an `INTERNAL_SERVICE_KEY` line in your `.env`, you can delete it. The frontend does not use it (it belongs to the backend).
- Do not commit `.env` to git. It is private.

## Step 4 – Start the backend

Start the backend API project so it is running at the address you put in `VITE_API_BASE_URL`. (The backend is a separate project.)

## Step 5 – Run the app

```
npm run dev
```

Open **http://localhost:3006** in your browser.

## Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app for development (port 3006) |
| `npm run build` | Makes a production build in the `dist` folder |
| `npm run preview` | Serves the production build locally (port 3006) |

## Something not working?

| Problem | Fix |
|---|---|
| Error: `Missing Supabase environment variables.` | `.env` is missing or a value is empty. Check Step 3, then **stop and restart** `npm run dev`. |
| Changed `.env` but nothing changed | Restart `npm run dev`. Env values are only read at startup. |
| Login works but data does not load / network errors | Backend is not running or `VITE_API_BASE_URL` is wrong. Check Step 4. |
| CORS error in the browser console | Backend must allow `http://localhost:3006` as an allowed origin. |
| Port 3006 already in use | Close the other program using it, or change the port in `vite.config.js` and `package.json`. |
