from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel

from .. import atlassian
from ..config import settings
from ..security import create_access_token, create_oauth_state, verify_oauth_state
from ..session_store import AtlassianSession, clear_session, set_session

router = APIRouter(prefix="/api/auth", tags=["auth"])


class ExchangeRequest(BaseModel):
    code: str
    state: str


def _redirect_to_frontend_callback(params: dict[str, str]) -> RedirectResponse:
    frontend = settings.frontend_url.rstrip("/")
    return RedirectResponse(
        f"{frontend}/oauth2/callback?{urlencode(params)}",
        status_code=302,
    )


@router.get("/login")
async def login() -> RedirectResponse:
    if not settings.atlassian_client_id or not settings.atlassian_client_secret:
        return _redirect_to_frontend_callback(
            {
                "error": (
                    "Atlassian OAuth client credentials are not configured "
                    "on the server."
                )
            }
        )
    return RedirectResponse(
        atlassian.build_authorize_url(create_oauth_state()),
        status_code=302,
    )


@router.post("/exchange")
async def exchange(payload: ExchangeRequest) -> dict[str, str]:
    verify_oauth_state(payload.state)

    try:
        tokens = await atlassian.exchange_code(payload.code)
        access_token = tokens.get("access_token")
        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "code": "OAUTH_EXCHANGE_FAILED",
                    "message": "Atlassian did not return an access token.",
                },
            )
        resources = await atlassian.get_accessible_resources(access_token)
    except atlassian.AtlassianError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message},
        ) from exc

    if not resources:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "NO_CONFLUENCE_SITE",
                "message": "No accessible Atlassian sites were returned.",
            },
        )

    site = resources[0]
    expires_in = int(tokens.get("expires_in") or 3600)
    set_session(
        AtlassianSession(
            access_token=access_token,
            refresh_token=tokens.get("refresh_token"),
            expires_at=datetime.now(UTC) + timedelta(seconds=expires_in),
            cloud_id=str(site.get("id", "")),
            site_url=str(site.get("url", "")),
            site_name=str(site.get("name", "")),
        )
    )
    return {"token": create_access_token()}


@router.post("/logout", status_code=204)
async def logout() -> Response:
    clear_session()
    return Response(status_code=204)
