"""Internal-request check, mirroring the Node services' verifyInternalRequest."""

import hmac

from fastapi import Header, HTTPException

from . import config


def verify_internal_request(
    x_internal_service_key: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> dict:
    """Reject anything that is not an authenticated internal call.

    Status codes match the Node middleware so the caller's error handling does
    not have to special-case this service.
    """
    if not config.INTERNAL_SERVICE_KEY:
        raise HTTPException(
            status_code=500,
            detail="INTERNAL_SERVICE_KEY is not configured.",
        )

    # compare_digest rather than == so a wrong key cannot be recovered by timing
    # the response.
    if not x_internal_service_key or not hmac.compare_digest(
        x_internal_service_key, config.INTERNAL_SERVICE_KEY
    ):
        raise HTTPException(status_code=403, detail="Forbidden internal request.")

    if not x_user_id:
        raise HTTPException(status_code=401, detail="Missing user context.")

    return {"id": x_user_id}