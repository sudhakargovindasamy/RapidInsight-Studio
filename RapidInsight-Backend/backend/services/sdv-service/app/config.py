"""Runtime configuration, read once at import."""

import os
from pathlib import Path

from dotenv import load_dotenv

SERVICE_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(SERVICE_ROOT / ".env")


def _int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default

    return value if value > 0 else default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


PORT = _int("PORT", 3008)

INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY", "")


def _artifact_dir() -> Path:
    raw = Path(os.getenv("SDV_ARTIFACT_DIR", ".artifacts"))

    # A relative path in a .env should mean "next to the service", not "wherever
    # uvicorn happened to be launched from".
    return raw if raw.is_absolute() else (SERVICE_ROOT / raw).resolve()


ARTIFACT_DIR = _artifact_dir()
ARTIFACT_MAX_COUNT = _int("SDV_ARTIFACT_MAX_COUNT", 200)
MEMORY_CACHE_SIZE = _int("SDV_MEMORY_CACHE_SIZE", 16)

MAX_SEED_ROWS = _int("SDV_MAX_SEED_ROWS", 5000)
MAX_SAMPLE_ROWS = _int("SDV_MAX_SAMPLE_ROWS", 100000)
MAX_COLUMNS = _int("SDV_MAX_COLUMNS", 120)
MIN_SEED_ROWS = _int("SDV_MIN_SEED_ROWS", 20)

WORKERS = _int("SDV_WORKERS", 2)

QUALITY_WARN_THRESHOLD = _float("SDV_QUALITY_WARN_THRESHOLD", 0.6)

# TVAE, not GaussianCopula. Measured on 2026-08-05 with a sales table whose
# seed data had segment -> price ordering (basic 50, premium 200, vip 600) and
# exact city -> country pairing:
#
#   GaussianCopula  fit  1.4s  city/country 55%  basic 187 premium 385 vip 288
#   CTGAN           fit 77.5s  city/country 26%  basic 179 premium 193 vip 168
#   TVAE            fit 95.5s  city/country 88%  basic  86 premium 154 vip 191
#
# Only TVAE preserved the segment -> price ordering at all; the other two
# inverted it. GaussianCopula is fast and fine for numeric-only tables, but it
# scrambles correlations between a category and a number - which is exactly the
# relationship a dashboard is built on. The extra fit time is affordable because
# fitting happens once, in the background, at schema-upload time.
DEFAULT_SYNTHESIZER = "tvae"

# gaussian_copula stays available for numeric-heavy tables where its speed wins,
# and ctgan for callers who want to try it. Both by explicit request only.
SUPPORTED_SYNTHESIZERS = ("tvae", "gaussian_copula", "ctgan")

# TVAE training passes. 300 was enough for the ordering to hold in testing;
# raising it costs fit time roughly linearly.
TVAE_EPOCHS = _int("SDV_TVAE_EPOCHS", 300)
CTGAN_EPOCHS = _int("SDV_CTGAN_EPOCHS", 300)

# The sdtypes we accept from the caller. Deliberately a small set - anything the
# caller cannot map onto one of these should not be sent to SDV at all.
SUPPORTED_SDTYPES = ("numerical", "categorical", "datetime", "boolean")