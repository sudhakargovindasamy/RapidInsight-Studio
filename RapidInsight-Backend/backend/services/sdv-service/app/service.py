"""Fitting, sampling, and the post-processing that SDV does not do for us."""

import math
import random
import time
import warnings

import numpy as np
import pandas as pd

from . import config
from .constraints_builder import build_constraints
from .metadata_builder import build_dataframe, build_metadata
from .models import ColumnSpec, ConstraintSpec
from .synthesizer_cache import cache


class SdvServiceError(Exception):
    """Something the caller can act on. Carries an HTTP status."""

    def __init__(self, message: str, status_code: int = 400, code: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def _build_synthesizer(name: str, metadata):
    """Construct a synthesizer. Only the deep models take an epochs argument."""
    from sdv.single_table import (
        CTGANSynthesizer,
        GaussianCopulaSynthesizer,
        TVAESynthesizer,
    )

    if name == "tvae":
        return TVAESynthesizer(metadata, epochs=config.TVAE_EPOCHS)

    if name == "ctgan":
        return CTGANSynthesizer(metadata, epochs=config.CTGAN_EPOCHS)

    return GaussianCopulaSynthesizer(metadata)


def _seed_everything(random_seed: int | None) -> None:
    """Make a run reproducible.

    SDV's sample() takes no seed argument, so the randomness has to be pinned at
    the numpy/random level before calling it.
    """
    if random_seed is None:
        return

    random.seed(random_seed)
    np.random.seed(random_seed % (2**32))


def fit_model(
    *,
    cache_key: str,
    table_name: str,
    columns: list[ColumnSpec],
    seed_rows: list[dict],
    constraints: list[ConstraintSpec],
    synthesizer_name: str,
    random_seed: int | None,
) -> tuple[object, dict, bool]:
    """Return (synthesizer, meta, cache_hit), training only if needed."""
    cached = cache.get(cache_key)

    if cached is not None:
        return cached.synthesizer, cached.meta, True

    # Serialise concurrent requests for the same key so the model is trained
    # once rather than once per caller.
    with cache.lock_for(cache_key):
        cached = cache.get(cache_key)

        if cached is not None:
            return cached.synthesizer, cached.meta, True

        return _train(
            cache_key=cache_key,
            table_name=table_name,
            columns=columns,
            seed_rows=seed_rows,
            constraints=constraints,
            synthesizer_name=synthesizer_name,
            random_seed=random_seed,
        )


def _train(
    *,
    cache_key: str,
    table_name: str,
    columns: list[ColumnSpec],
    seed_rows: list[dict],
    constraints: list[ConstraintSpec],
    synthesizer_name: str,
    random_seed: int | None,
) -> tuple[object, dict, bool]:
    if len(seed_rows) < config.MIN_SEED_ROWS:
        raise SdvServiceError(
            f"{len(seed_rows)} seed rows is below the minimum of "
            f"{config.MIN_SEED_ROWS}. A copula fitted on fewer rows models noise "
            f"rather than structure - use the seed rows directly instead.",
            status_code=422,
            code="INSUFFICIENT_SEED_ROWS",
        )

    if len(seed_rows) > config.MAX_SEED_ROWS:
        raise SdvServiceError(
            f"{len(seed_rows)} seed rows exceeds the limit of "
            f"{config.MAX_SEED_ROWS}.",
            status_code=422,
            code="TOO_MANY_SEED_ROWS",
        )

    _seed_everything(random_seed)

    metadata = build_metadata(table_name, columns)
    frame = build_dataframe(seed_rows, columns)

    synthesizer = _build_synthesizer(synthesizer_name, metadata)

    if constraints:
        synthesizer.add_constraints(
            build_constraints(constraints, columns, table_name)
        )

    started = time.perf_counter()

    try:
        # SDV is noisy about metadata-saving best practice on every fit. The
        # advice does not apply here: our metadata is rebuilt from the caller's
        # schema each time, never recovered from the pickle.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            synthesizer.fit(frame)
    except Exception as error:
        raise SdvServiceError(
            f"Fitting failed: {error}",
            status_code=422,
            code="FIT_FAILED",
        ) from error

    fitted_in_ms = int((time.perf_counter() - started) * 1000)

    quality = _evaluate(frame, synthesizer, metadata)

    meta = {
        "cache_key": cache_key,
        "table_name": table_name,
        "synthesizer": synthesizer_name,
        "seed_row_count": len(frame),
        "fitted_in_ms": fitted_in_ms,
        "quality": quality,
        "columns": [column.model_dump() for column in columns],
    }

    cache.put(cache_key, synthesizer, meta)

    return synthesizer, meta, False


def _evaluate(frame: pd.DataFrame, synthesizer, metadata) -> dict:
    """Score the model against the data it was trained on.

    Scoring is best-effort: a failure here means we cannot report how good the
    model is, which is not a reason to refuse to use it.
    """
    try:
        from sdv.evaluation import evaluate_quality, run_diagnostic

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")

            comparison = synthesizer.sample(num_rows=len(frame))

            quality = evaluate_quality(frame, comparison, metadata, verbose=False)
            diagnostic = run_diagnostic(frame, comparison, metadata, verbose=False)

        return {
            "score": float(quality.get_score()),
            "diagnostic": float(diagnostic.get_score()),
        }
    except Exception:
        return {"score": None, "diagnostic": None}


def sample_rows(
    *,
    synthesizer,
    num_rows: int,
    columns: list[ColumnSpec],
    random_seed: int | None,
) -> tuple[list[dict], list[str]]:
    _seed_everything(random_seed)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            frame = synthesizer.sample(num_rows=num_rows)
    except Exception as error:
        # Over-tight constraints are the usual cause: SDV rejects and retries
        # rows until it gives up.
        raise SdvServiceError(
            f"Sampling failed: {error}. If constraints are set, they may be too "
            f"restrictive for the seed data.",
            status_code=422,
            code="SAMPLE_FAILED",
        ) from error

    frame, warns = _post_process(frame, columns)

    return _to_records(frame, columns), warns


def _post_process(
    frame: pd.DataFrame, columns: list[ColumnSpec]
) -> tuple[pd.DataFrame, list[str]]:
    """Enforce the schema limits SDV does not know about.

    SDV's own enforce_min_max_values clamps to the range it saw while training.
    The user's schema may declare a tighter range than the seed rows happened to
    cover, and a copula can also produce values outside its training range, so
    the declared bounds are applied here regardless.
    """
    warns: list[str] = []

    for column in columns:
        if column.name not in frame.columns:
            continue

        if column.sdtype == "numerical":
            series = frame[column.name]

            if column.minimum is not None:
                below = int((series < column.minimum).sum())

                if below:
                    warns.append(
                        f"{column.name}: clipped {below} value(s) up to the "
                        f"declared minimum {column.minimum}."
                    )

                series = series.clip(lower=column.minimum)

            if column.maximum is not None:
                above = int((series > column.maximum).sum())

                if above:
                    warns.append(
                        f"{column.name}: clipped {above} value(s) down to the "
                        f"declared maximum {column.maximum}."
                    )

                series = series.clip(upper=column.maximum)

            frame[column.name] = series

        elif column.sdtype == "categorical" and column.allowed_values:
            allowed = set(column.allowed_values)
            series = frame[column.name]
            offending = ~series.isin(allowed) & series.notna()
            count = int(offending.sum())

            if count:
                # Replacing rather than dropping keeps the requested row count
                # exact. Drawing from the allowed list at random preserves the
                # column's spread better than defaulting to a single value.
                replacements = np.random.choice(
                    list(allowed), size=count, replace=True
                )
                frame.loc[offending, column.name] = replacements

                warns.append(
                    f"{column.name}: replaced {count} value(s) outside the "
                    f"allowed set."
                )

    return frame, warns


def _to_records(frame: pd.DataFrame, columns: list[ColumnSpec]) -> list[dict]:
    """Convert to JSON-safe records.

    pandas types (Timestamp, numpy int64, NaN) do not survive JSON encoding, so
    each is converted to something the Node caller can read directly.
    """
    formats = {
        column.name: (column.datetime_format or "%Y-%m-%d")
        for column in columns
        if column.sdtype == "datetime"
    }

    records: list[dict] = []

    for row in frame.to_dict(orient="records"):
        clean: dict = {}

        for key, value in row.items():
            if key in formats:
                clean[key] = (
                    None if pd.isna(value) else pd.Timestamp(value).strftime(formats[key])
                )
                continue

            if value is None or value is pd.NA:
                clean[key] = None
                continue

            if isinstance(value, (np.integer,)):
                clean[key] = int(value)
            elif isinstance(value, (np.floating, float)):
                clean[key] = None if math.isnan(float(value)) else float(value)
            elif isinstance(value, (np.bool_, bool)):
                clean[key] = bool(value)
            elif isinstance(value, pd.Timestamp):
                clean[key] = value.isoformat()
            else:
                clean[key] = None if pd.isna(value) else value

        records.append(clean)

    return records