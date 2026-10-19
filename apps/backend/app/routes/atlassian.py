from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status

from .. import atlassian
from ..security import get_current_user
from ..session_store import (
    AtlassianSession,
    clear_session,
    get_session,
    set_session,
)

router = APIRouter(
    prefix="/api/atlassian",
    tags=["atlassian"],
    dependencies=[Depends(get_current_user)],
)


def _require_session() -> AtlassianSession:
    session = get_session()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "AUTH_REQUIRED",
                "message": "No active Confluence session. Please log in.",
            },
        )
    return session


def _token_payload(session: AtlassianSession) -> dict[str, str]:
    return {
        "access_token": session.access_token,
        "expires_at": session.expires_at.isoformat(),
        "site_name": session.site_name,
        "site_url": session.site_url,
    }


@router.get("/token")
async def token() -> dict[str, str]:
    return _token_payload(_require_session())


@router.post("/refresh")
async def refresh() -> dict[str, str]:
    session = _require_session()
    if not session.refresh_token:
        clear_session()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "REAUTH_REQUIRED",
                "message": "No refresh token is available. Please log in again.",
            },
        )

    try:
        tokens = await atlassian.refresh_tokens(session.refresh_token)
    except atlassian.AtlassianError as exc:
        if exc.code == "invalid_grant":
            clear_session()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "REAUTH_REQUIRED",
                    "message": (
                        "Refresh token expired or revoked. Please log in again."
                    ),
                },
            ) from exc
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": "ATLASSIAN_API_ERROR", "message": exc.message},
        ) from exc

    session.access_token = tokens["access_token"]
    session.refresh_token = tokens.get("refresh_token") or session.refresh_token
    session.expires_at = datetime.now(UTC) + timedelta(
        seconds=int(tokens.get("expires_in") or 3600)
    )
    set_session(session)
    return _token_payload(session)


@router.get("/spaces")
async def spaces() -> dict[str, object]:
    session = _require_session()
    if session.expires_at <= datetime.now(UTC) + timedelta(seconds=30):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "ATLASSIAN_TOKEN_EXPIRED",
                "message": "Atlassian access token has expired. Click Refresh.",
            },
        )

    try:
        result = await atlassian.get_spaces(
            session.cloud_id,
            session.access_token,
        )
    except atlassian.AtlassianError as exc:
        if exc.status_code == 401 or exc.code == "ATLASSIAN_TOKEN_EXPIRED":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "ATLASSIAN_TOKEN_EXPIRED",
                    "message": (
                        "Atlassian access token is invalid or expired. "
                        "Click Refresh."
                    ),
                },
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "ATLASSIAN_API_ERROR", "message": exc.message},
        ) from exc

    return {"spaces": result, "count": len(result)}
