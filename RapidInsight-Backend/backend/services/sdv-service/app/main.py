"""sdv-service - synthetic data generation sidecar.

Trains an SDV model on a small set of example rows and produces bulk rows that
follow the same patterns. Called by datagen-service; not exposed publicly.
"""

import sys

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from . import config
from .routes import router
from .synthesizer_cache import cache

app = FastAPI(
    title="sdv-service",
    description="Synthetic data generation for RapidInsight Studio.",
    version="1.0.0",
)

app.include_router(router)


@app.get("/health")
def health() -> dict:
    try:
        import sdv

        sdv_version = sdv.__version__
    except Exception as error:  # pragma: no cover - only if the install is broken
        sdv_version = f"unavailable: {error}"

    return {
        "success": True,
        "service": "sdv-service",
        "status": "healthy",
        "sdv_version": sdv_version,
        "python_version": sys.version.split()[0],
        "cache": cache.stats(),
    }


# The Node services all read {success, message} off a failed response. Matching
# that shape means callers do not need a special case for this service.
@app.exception_handler(404)
async def not_found(request, exc) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"success": False, "message": "SDV service route not found."},
    )


@app.exception_handler(Exception)
async def unhandled(request, exc) -> JSONResponse:  # pragma: no cover
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": f"Internal SDV service error: {exc}"},
    )


def main() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=config.PORT,
        reload=False,
    )


if __name__ == "__main__":
    main()