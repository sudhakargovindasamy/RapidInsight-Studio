# sdv-service

Synthetic data generation sidecar. Trains an SDV model on a small set of example
rows and produces bulk rows that follow the same patterns.

Called by `datagen-service` over HTTP. Not exposed publicly.

Python, because SDV is a Python library with no Node equivalent.

---

## Setup

Requires Python 3.11+. Verified on **3.14.3** with `sdv 1.37.4`.

From the **repository root**, not this directory:

```bash
npm run setup:sdv --prefix backend
```

One command on every platform. It creates the environment, installs the
requirements, and verifies `import sdv` works before reporting success.

Then configure the service:

```bash
cd backend/services/sdv-service
cp .env.example .env            # then set INTERNAL_SERVICE_KEY
```

`INTERNAL_SERVICE_KEY` must match the value the Node services use.

> ### Why the venv lives outside the project (Windows)
>
> `setup:sdv` creates the environment at **`C:\sdvenv`**, not inside this
> service. That looks odd, and it is deliberate.
>
> SDV depends on `torch`, which ships licence files nested about thirteen
> folders deep:
>
> ```
> torch/licenses/third_party/kineto/libkineto/third_party/dynolog/
>   third_party/prometheus-cpp/3rdparty/civetweb/src/third_party/duktape-1.5.2
> ```
>
> Windows refuses any path over 260 characters. A repository cloned to
> `C:\Users\<name>\Desktop\<project>\` already spends ~67 of those, and
> `pip install` then aborts partway with
> `WinError 206: The filename or extension is too long` - leaving a half-installed
> environment that looks fine until `import sdv` fails.
>
> Measured on this repo: a venv at the project root failed. `C:\sdvenv` uses 9
> characters instead of ~78 and leaves roughly 70 spare.
>
> **If you have administrator rights**, the tidier fix is to lift the limit once
> and put the venv wherever you like:
>
> ```powershell
> New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
>   -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
> ```
>
> macOS and Linux have no such limit; there the venv goes in `~/.sdvenv`.

### Using a different location

The start scripts search, in order: `C:\sdvenv` (or `~/.sdvenv`),
`<repo>/.venv-sdv`, then `<service>/.venv`. To use somewhere else entirely:

```bash
set SDV_PYTHON=D:\envs\sdv\Scripts\python.exe     # Windows
export SDV_PYTHON=/opt/sdv/bin/python             # macOS / Linux
```

To change only where `setup:sdv` creates it, set `SDV_VENV_DIR` instead.

## Running

Started automatically with the rest of the backend:

```bash
npm run dev --prefix backend
```

Or on its own:

```bash
npm run dev:sdv --prefix backend
```

Check it:

```bash
curl http://localhost:3008/health
```

Interactive API docs at `http://localhost:3008/docs`.

---

## Endpoints

All require `x-internal-service-key` and `x-user-id` headers, matching the Node
services' `verifyInternalRequest`.

| Endpoint | Purpose |
|---|---|
| `POST /sdv/fit` | Train and cache a model. Used to warm the cache at upload time. |
| `POST /sdv/generate` | Fit if cold, then sample. What `datagen-service` calls. |
| `POST /sdv/sample` | Sample from an already-fitted model. 404 if not cached. |
| `GET /health` | Status, SDV version, cache stats. |

### Example

```jsonc
POST /sdv/generate
{
  "cache_key": "sha256-of-schema-plus-seed-rows",
  "table_name": "sales",
  "columns": [
    { "name": "city",       "sdtype": "categorical" },
    { "name": "country",    "sdtype": "categorical" },
    { "name": "segment",    "sdtype": "categorical",
      "allowed_values": ["basic", "premium", "vip"] },
    { "name": "unit_price", "sdtype": "numerical", "minimum": 0 },
    { "name": "order_date", "sdtype": "datetime",
      "datetime_format": "%Y-%m-%d" }
  ],
  "seed_rows": [ /* ~200-400 example rows */ ],
  "num_rows": 500,
  "constraints": [
    { "type": "inequality", "low_column": "order_date",
      "high_column": "delivery_date" },
    { "type": "fixed_combinations", "columns": ["city", "country"] }
  ],
  "random_seed": 42
}
```

The caller computes `cache_key`. This service never decides when a cache is
stale - it only honours the key it is given.

---

## Two things that are easy to get wrong

### 1. Never let SDV detect column types

SDV can infer types with `Metadata.detect_from_dataframe`. **We never use it.**

Measured 2026-08-05, sdv 1.37.4: a plain column named `city` holding
Tokyo/Paris/Berlin was auto-classified as personal information, and every value
was replaced with an invented placeholder (`Port Brenda`, `Amandabury`). SDV
decides this from the column *name*, so any schema with a `city`, `name`, `email`
or `phone` column is silently corrupted - and the output still looks plausible
enough to survive a glance.

Every column therefore arrives with an explicit `sdtype`. That is why
`columns` is a required field rather than a convenience.

### 2. The default synthesizer is TVAE, not GaussianCopula

Measured on a sales table whose seed data had a clear `segment -> price`
ordering (basic 50, premium 200, vip 600) and exact `city -> country` pairing:

| Synthesizer | Fit time | city/country | basic | premium | vip | Ordering held |
|---|---|---|---|---|---|---|
| GaussianCopula | 1.4s | 55% | 187 | 385 | 288 | ✗ |
| CTGAN | 77.5s | 26% | 179 | 193 | 168 | ✗ |
| **TVAE** | 95.5s | 88% | 86 | 154 | 191 | ✓ |

Only TVAE preserved the ordering; the other two inverted it. GaussianCopula is
fast and fine for numeric-only tables, but it scrambles correlations between a
category and a number - which is exactly what a dashboard is built on.

The fit cost is affordable because fitting happens **once, in the background, at
schema-upload time**. By the time a user clicks Generate Tables, the model is
cached and sampling is ~1s.

---

## Correlation quality, honestly

**Numeric ordering survives.** With TVAE, `basic < premium < vip` holds.
Magnitudes are compressed with thin seed data and sharpen as seed rows increase
(at 400 seed rows, premium landed at 203 against a truth of 200).

**Functional dependencies do not survive on their own.** A statistical model
learns that Tokyo and Japan are *correlated*, never that Tokyo *determines*
Japan. Measured 44-51% correct pairing.

Fix: a `fixed_combinations` constraint, which restricts generated combinations to
ones present in the seed rows. **This takes city/country from ~50% to 100%.**

> Use `fixed_combinations` for any column pair where one value determines
> another - city/country, product/category, state/region.

## Constraints

| Type | Meaning | Recommended |
|---|---|---|
| `fixed_combinations` | Listed columns may only appear in combinations seen in the seed rows. | **Yes** |
| `inequality` | `low_column <= high_column`. | ⚠️ see below |
| `range` | `low_column <= middle_column <= high_column`. | ⚠️ same caveat |

> ### ⚠️ Avoid `inequality` for date ordering
>
> Measured 2026-08-06: adding an `inequality` constraint to a table whose seed
> data had a clean `segment -> price` signal of 49/293/895 produced
> 187/290/254 - **the ordering inverted**. Without the constraint it came out
> 157/251/541, correctly ordered.
>
> SDV enforces `Inequality` by replacing the later column with a *difference*
> before fitting, and that transformation distorts the table's other
> correlations. It also triggers rejection sampling, which took one generation
> from 8s to 46s.
>
> `datagen-service` therefore does **not** send date-ordering constraints. It
> removes the later date from the column list entirely and computes it as
> `earlier + gap`, sampling the gap from the seed rows. Ordering then holds by
> construction, correlations survive, and generation stays fast.
>
> `fixed_combinations` was tested the same way and showed **no** such side
> effect - ordering held, and city/country pairing went from 85% to 100%.

These are **structural** rules - domain-independent. The same inequality that
stops a delivery preceding an order stops a discharge preceding an admission.

Domain rules (dosage vs body weight) are **not** enforced here. They come from
the realism of the seed rows, and are statistically likely rather than
guaranteed. See section 12 of `docs/sdv-migration-plan.md`.

Constraints cost sampling time: SDV generates, checks, and retries. Over-tight
constraints slow generation or fail it outright, returning a 422.

---

## Caching

Two tiers, both keyed by `cache_key`:

- **Disk** (`.artifacts/*.pkl` + `.json`) - survives restarts. Written
  atomically, so a killed process cannot leave a truncated pickle.
- **Memory** - small LRU in front, because loading a pickle costs ~100ms.

Concurrent requests for the same uncached key are serialised by a per-key lock,
so the model trains once rather than once per caller.

Measured: **37.5s cold, 1.5s warm.**

Artifacts are disposable. Pickles do not survive an SDV major-version upgrade,
which is why `requirements.txt` pins `sdv>=1.37,<2.0`. The seed rows are the
source of truth; delete `.artifacts/` any time and models refit on next use.

---

## Limits

Configured in `.env`:

| Setting | Default | Why |
|---|---|---|
| `SDV_MIN_SEED_ROWS` | 20 | Below this a model fits noise. Returns 422 - use the seed rows directly instead. |
| `SDV_MAX_SEED_ROWS` | 5000 | Fit time grows with seed size. |
| `SDV_MAX_SAMPLE_ROWS` | 100000 | |
| `SDV_MAX_COLUMNS` | 120 | Every column is correlated with every other. |
| `SDV_TVAE_EPOCHS` | 300 | Enough for ordering to hold. Raising it costs fit time roughly linearly. |
| `SDV_QUALITY_WARN_THRESHOLD` | 0.6 | Below this the response carries a warning. It does not fail - imperfect data may still beat none. |

## Post-processing we do that SDV does not

- **Numeric bounds** clipped to the schema's declared `minimum`/`maximum`. SDV's
  own `enforce_min_max_values` only knows the *training* range, which may be
  wider than the schema allows.
- **Categorical values** outside `allowed_values` replaced by a draw from the
  allowed set. Replacing rather than dropping keeps the row count exact.

Both are reported in the response's `warnings`.