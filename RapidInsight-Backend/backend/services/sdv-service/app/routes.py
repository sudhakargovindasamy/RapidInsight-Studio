"""Endpoints.

Fitting and sampling are CPU-bound and hold the thread for their duration, so
both run in a worker thread. Without that, a single fit would block the event
loop and /health would stop answering while a model trains.
"""

import anyio
from fastapi import APIRouter, Depends, HTTPException

from .auth import verify_internal_request
from .constraints_builder import ConstraintError
from .models import (
    ColumnSpec,
    FitRequest,
    FitResponse,
    GenerateRequest,
    GenerateResponse,
    ModelInfo,
    QualityReport,
    SampleRequest,
    SampleResponse,
)
from .service import SdvServiceError, fit_model, sample_rows
from .synthesizer_cache import InvalidCacheKey, cache

router = APIRouter(prefix="/sdv", dependencies=[Depends(verify_internal_request)])


def _translate(error: Exception) -> HTTPException:
    if isinstance(error, SdvServiceError):
        return HTTPException(status_code=error.status_code, detail=str(error))

    if isinstance(error, (ConstraintError, InvalidCacheKey)):
        return HTTPException(status_code=422, detail=str(error))

    return HTTPException(status_code=500, detail=f"SDV service error: {error}")


def _quality_of(meta: dict) -> QualityReport:
    quality = meta.get("quality") or {}

    return QualityReport(
        score=quality.get("score"),
        diagnostic=quality.get("diagnostic"),
    )


def _warnings_for(meta: dict) -> list[str]:
    from . import config

    score = (meta.get("quality") or {}).get("score")

    if score is not None and score < config.QUALITY_WARN_THRESHOLD:
        return [
            f"Model quality score {score:.2f} is below the "
            f"{config.QUALITY_WARN_THRESHOLD} threshold. The seed rows may be too "
            f"few or too repetitive."
        ]

    return []


@router.post("/fit", response_model=FitResponse)
async def fit(request: FitRequest) -> FitResponse:
    """Train and cache a model without sampling. Used to warm the cache."""
    try:
        _, meta, cache_hit = await anyio.to_thread.run_sync(
            lambda: fit_model(
                cache_key=request.cache_key,
                table_name=request.table_name,
                columns=request.columns,
                seed_rows=request.seed_rows,
                constraints=request.constraints,
                synthesizer_name=request.synthesizer,
                random_seed=request.random_seed,
            )
        )
    except Exception as error:
        raise _translate(error) from error

    return FitResponse(
        model=ModelInfo(
            cache_key=request.cache_key,
            cache_hit=cache_hit,
            synthesizer=meta["synthesizer"],
            seed_row_count=meta["seed_row_count"],
            fitted_in_ms=meta.get("fitted_in_ms"),
        ),
        quality=_quality_of(meta),
        warnings=_warnings_for(meta),
    )


@router.post("/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest) -> GenerateResponse:
    """Fit if the model is cold, then sample. The endpoint datagen-service uses."""
    try:
        synthesizer, meta, cache_hit = await anyio.to_thread.run_sync(
            lambda: fit_model(
                cache_key=request.cache_key,
                table_name=request.table_name,
                columns=request.columns,
                seed_rows=request.seed_rows,
                constraints=request.constraints,
                synthesizer_name=request.synthesizer,
                random_seed=request.random_seed,
            )
        )

        rows, sample_warnings = await anyio.to_thread.run_sync(
            lambda: sample_rows(
                synthesizer=synthesizer,
                num_rows=request.num_rows,
                columns=request.columns,
                random_seed=request.random_seed,
            )
        )
    except Exception as error:
        raise _translate(error) from error

    return GenerateResponse(
        rows=rows,
        num_rows=len(rows),
        model=ModelInfo(
            cache_key=request.cache_key,
            cache_hit=cache_hit,
            synthesizer=meta["synthesizer"],
            seed_row_count=meta["seed_row_count"],
            fitted_in_ms=meta.get("fitted_in_ms"),
        ),
        quality=_quality_of(meta),
        warnings=_warnings_for(meta) + sample_warnings,
    )


@router.post("/sample", response_model=SampleResponse)
async def sample(request: SampleRequest) -> SampleResponse:
    """Sample from an already-fitted model. Fails if the cache is cold."""
    try:
        cached = cache.get(request.cache_key)
    except InvalidCacheKey as error:
        raise _translate(error) from error

    if cached is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No fitted model for cache_key {request.cache_key}. "
                f"Call /sdv/fit or /sdv/generate first."
            ),
        )

    # The column specs were stored alongside the model at fit time, so the
    # caller does not have to resend them just to draw more rows.
    columns = [ColumnSpec(**column) for column in cached.meta.get("columns", [])]

    try:
        rows, sample_warnings = await anyio.to_thread.run_sync(
            lambda: sample_rows(
                synthesizer=cached.synthesizer,
                num_rows=request.num_rows,
                columns=columns,
                random_seed=request.random_seed,
            )
        )
    except Exception as error:
        raise _translate(error) from error

    return SampleResponse(
        rows=rows,
        num_rows=len(rows),
        model=ModelInfo(
            cache_key=request.cache_key,
            cache_hit=True,
            synthesizer=cached.meta["synthesizer"],
            seed_row_count=cached.meta["seed_row_count"],
            fitted_in_ms=cached.meta.get("fitted_in_ms"),
        ),
        warnings=sample_warnings,
    )