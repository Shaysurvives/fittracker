# FitTrack Pro — Cloud Edition

Postgres-backed version for deployment on Render + Neon. Free tier compatible.

## What's different from the local version

- **Database:** Neon Postgres (cloud) instead of local SQLite
- **Hosting:** Render Web Service (free tier)
- **Env var required:** `DATABASE_URL` (your Neon connection string)
- **Frontend:** unchanged

## Deploy in 3 steps

### 1. Set DATABASE_URL on Render
After importing this repo into Render as a Web Service, go to Environment → Environment Variables and add:

```
Key:   DATABASE_URL
Value: <your Neon connection string>
```

Format: `postgresql://user:pass@host.neon.tech/dbname?sslmode=require`

### 2. Build & start commands (Render auto-detects, but verify)

```
Build command:  npm install
Start command:  npm start
```

### 3. Deploy

Render builds and starts the app. First request to your URL might take ~30 seconds (free-tier cold start). After that it's instant until idle for 15+ minutes.

## API endpoints

Same as the local version — see local README for full reference. Base URL is your Render URL (e.g. `https://fittrack-pro.onrender.com`).

## Local testing (optional)

```bash
set DATABASE_URL=<your_neon_url>
npm install
npm start
```

Open http://localhost:3000.
