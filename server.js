// FitTrack Pro — Cloud Backend (Postgres on Neon, hosted on Render)
//
// Required env var: DATABASE_URL  (Neon Postgres connection string)
// Render auto-sets:  PORT
//
// Local testing: set DATABASE_URL first, then `npm start`

const express = require("express");
const { Pool } = require("pg");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("");
  console.error("❌  DATABASE_URL environment variable is required.");
  console.error("");
  console.error("   On Render: add it in Environment → Environment Variables.");
  console.error("   Locally:   set DATABASE_URL=postgresql://...  (then npm start)");
  console.error("");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL
  max: 5,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("Postgres pool error:", err.message);
});

// ─────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS weights (
      date TEXT PRIMARY KEY,
      weight REAL NOT NULL,
      logged_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workouts (
      id BIGINT PRIMARY KEY,
      date TEXT NOT NULL,
      split TEXT,
      day TEXT,
      duration INTEGER,
      data TEXT NOT NULL,
      logged_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);

    CREATE TABLE IF NOT EXISTS meals (
      id BIGINT PRIMARY KEY,
      date TEXT NOT NULL,
      meal TEXT NOT NULL,
      data TEXT NOT NULL,
      logged_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(date);

    CREATE TABLE IF NOT EXISTS water (
      date TEXT PRIMARY KEY,
      amount INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS measurements (
      date TEXT PRIMARY KEY,
      chest REAL,
      waist REAL,
      arms REAL,
      logged_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  console.log("✓ Schema ready");
}

// Handler wrapper for clean error responses
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error(`${req.method} ${req.path} →`, e.message);
    res.status(500).json({ error: e.message });
  }
};

// Run an array of statements in a single transaction
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// Express app
// ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString().slice(11, 19)}  ${req.method} ${req.path}`);
  next();
});

// ── Profile ──────────────────────────────────────────────────
app.get("/api/profile", wrap(async (_req, res) => {
  const r = await pool.query("SELECT data FROM profile WHERE id = 1");
  res.json(r.rows.length ? JSON.parse(r.rows[0].data) : null);
}));

app.put("/api/profile", wrap(async (req, res) => {
  await pool.query(`
    INSERT INTO profile (id, data) VALUES (1, $1)
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `, [JSON.stringify(req.body)]);
  res.json({ ok: true });
}));

// ── Weights ──────────────────────────────────────────────────
app.get("/api/weights", wrap(async (_req, res) => {
  const r = await pool.query("SELECT date, weight FROM weights ORDER BY date");
  res.json(r.rows);
}));

app.put("/api/weights", wrap(async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [];
  await tx(async (c) => {
    await c.query("DELETE FROM weights");
    for (const w of items) {
      await c.query("INSERT INTO weights (date, weight) VALUES ($1, $2)", [w.date, w.weight]);
    }
  });
  res.json({ ok: true, count: items.length });
}));

// ── Workouts ─────────────────────────────────────────────────
app.get("/api/workouts", wrap(async (_req, res) => {
  const r = await pool.query("SELECT data FROM workouts ORDER BY date, id");
  res.json(r.rows.map((row) => JSON.parse(row.data)));
}));

app.put("/api/workouts", wrap(async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [];
  await tx(async (c) => {
    await c.query("DELETE FROM workouts");
    for (const w of items) {
      await c.query(
        `INSERT INTO workouts (id, date, split, day, duration, data) VALUES ($1, $2, $3, $4, $5, $6)`,
        [w.id, w.date, w.split, w.day, w.duration || 0, JSON.stringify(w)]
      );
    }
  });
  res.json({ ok: true, count: items.length });
}));

// ── Meals ────────────────────────────────────────────────────
app.get("/api/meals", wrap(async (_req, res) => {
  const r = await pool.query("SELECT data FROM meals ORDER BY date, id");
  res.json(r.rows.map((row) => JSON.parse(row.data)));
}));

app.put("/api/meals", wrap(async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [];
  await tx(async (c) => {
    await c.query("DELETE FROM meals");
    for (const m of items) {
      await c.query(
        `INSERT INTO meals (id, date, meal, data) VALUES ($1, $2, $3, $4)`,
        [m.id, m.date, m.meal, JSON.stringify(m)]
      );
    }
  });
  res.json({ ok: true, count: items.length });
}));

// ── Water (object: { "YYYY-MM-DD": glasses }) ────────────────
app.get("/api/water", wrap(async (_req, res) => {
  const r = await pool.query("SELECT date, amount FROM water");
  const obj = {};
  r.rows.forEach((row) => (obj[row.date] = row.amount));
  res.json(obj);
}));

app.put("/api/water", wrap(async (req, res) => {
  const obj = req.body || {};
  await tx(async (c) => {
    await c.query("DELETE FROM water");
    for (const [d, a] of Object.entries(obj)) {
      await c.query("INSERT INTO water (date, amount) VALUES ($1, $2)", [d, a]);
    }
  });
  res.json({ ok: true });
}));

// ── Measurements ─────────────────────────────────────────────
app.get("/api/measurements", wrap(async (_req, res) => {
  const r = await pool.query("SELECT date, chest, waist, arms FROM measurements ORDER BY date");
  res.json(r.rows);
}));

app.put("/api/measurements", wrap(async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [];
  await tx(async (c) => {
    await c.query("DELETE FROM measurements");
    for (const m of items) {
      await c.query(
        `INSERT INTO measurements (date, chest, waist, arms) VALUES ($1, $2, $3, $4)`,
        [m.date, m.chest, m.waist, m.arms]
      );
    }
  });
  res.json({ ok: true, count: items.length });
}));

// ── Streak ───────────────────────────────────────────────────
app.get("/api/streak", wrap(async (_req, res) => {
  const r = await pool.query("SELECT value FROM kv WHERE key = 'streak'");
  res.json(r.rows.length ? JSON.parse(r.rows[0].value) : { count: 0, last: null });
}));

app.put("/api/streak", wrap(async (req, res) => {
  await pool.query(`
    INSERT INTO kv (key, value) VALUES ('streak', $1)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `, [JSON.stringify(req.body)]);
  res.json({ ok: true });
}));

// ── Reset everything ─────────────────────────────────────────
app.delete("/api/all", wrap(async (_req, res) => {
  await tx(async (c) => {
    await c.query("DELETE FROM profile");
    await c.query("DELETE FROM weights");
    await c.query("DELETE FROM workouts");
    await c.query("DELETE FROM meals");
    await c.query("DELETE FROM water");
    await c.query("DELETE FROM measurements");
    await c.query("DELETE FROM kv");
  });
  console.log("⚠ All data wiped.");
  res.json({ ok: true });
}));

// ── Export full backup ───────────────────────────────────────
app.get("/api/export", wrap(async (_req, res) => {
  const [profile, weights, workouts, meals, water, measurements, streak] = await Promise.all([
    pool.query("SELECT data FROM profile WHERE id = 1"),
    pool.query("SELECT date, weight FROM weights ORDER BY date"),
    pool.query("SELECT data FROM workouts ORDER BY date, id"),
    pool.query("SELECT data FROM meals ORDER BY date, id"),
    pool.query("SELECT date, amount FROM water"),
    pool.query("SELECT date, chest, waist, arms FROM measurements ORDER BY date"),
    pool.query("SELECT value FROM kv WHERE key = 'streak'"),
  ]);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="fittrack-backup-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.json({
    exported_at: new Date().toISOString(),
    profile: profile.rows.length ? JSON.parse(profile.rows[0].data) : null,
    weights: weights.rows,
    workouts: workouts.rows.map((r) => JSON.parse(r.data)),
    meals: meals.rows.map((r) => JSON.parse(r.data)),
    water: Object.fromEntries(water.rows.map((r) => [r.date, r.amount])),
    measurements: measurements.rows,
    streak: streak.rows.length ? JSON.parse(streak.rows[0].value) : null,
  });
}));

// ── Stats ────────────────────────────────────────────────────
app.get("/api/stats", wrap(async (_req, res) => {
  const counts = await Promise.all([
    pool.query("SELECT COUNT(*) AS n FROM weights"),
    pool.query("SELECT COUNT(*) AS n FROM workouts"),
    pool.query("SELECT COUNT(*) AS n FROM meals"),
    pool.query("SELECT COUNT(*) AS n FROM measurements"),
    pool.query("SELECT COUNT(*) AS n FROM water"),
  ]);
  res.json({
    weights: parseInt(counts[0].rows[0].n),
    workouts: parseInt(counts[1].rows[0].n),
    meals: parseInt(counts[2].rows[0].n),
    measurements: parseInt(counts[3].rows[0].n),
    water_days: parseInt(counts[4].rows[0].n),
  });
}));

// ─────────────────────────────────────────────────────────────
async function start() {
  try {
    await initSchema();
    app.listen(PORT, "0.0.0.0", () => {
      console.log("");
      console.log("  ╭─────────────────────────────────────────╮");
      console.log("  │   🟢  FitTrack Pro running              │");
      console.log(`  │   Port: ${String(PORT).padEnd(31)} │`);
      console.log("  │   Database: Neon Postgres               │");
      console.log("  ╰─────────────────────────────────────────╯");
      console.log("");
    });
  } catch (e) {
    console.error("Startup failed:", e.message);
    process.exit(1);
  }
}

start();
