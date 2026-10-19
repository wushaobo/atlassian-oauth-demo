from typing import Any
from urllib.parse import urlencode

import httpx

from .config import settings

AUTHORIZE_URL = "https://auth.atlassian.com/authorize"
TOKEN_URL = "https://auth.atlassian.com/oauth/token"
ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources"
CONFLUENCE_API_BASE = "https://api.atlassian.com/ex/confluence"

HTTP_TIMEOUT_SECONDS = 20.0


class AtlassianError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def build_authorize_url(state: str) -> str:
    params = {
        "audience": "api.atlassian.com",
        "client_id": settings.atlassian_client_id,
        "scope": settings.atlassian_scopes,
        "redirect_uri": settings.atlassian_redirect_uri,
        "state": state,
        "response_type": "code",
        "prompt": "consent",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def _response_error(response: httpx.Response, default_code: str) -> AtlassianError:
    payload: Any
    try:
        payload = response.json()
    except ValueError:
        payload = {}

    code = default_code
    message = ""
    if isinstance(payload, dict):
        if payload.get("error"):
            code = str(payload["error"])
        message = str(
            payload.get("error_description")
            or payload.get("message")
            or ""
        )
    if not message:
        message = response.text[:300] or (
            f"Atlassian API returned HTTP {response.status_code}."
        )

    status_code = response.status_code
    if status_code not in (400, 401, 403):
        status_code = 502
    return AtlassianError(code=code, message=message, status_code=status_code)


async def _post_token(payload: dict[str, str]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        response = await client.post(
            TOKEN_URL,
            json=payload,
            headers={"Accept": "application/json"},
        )

    if response.status_code != 200:
        raise _response_error(response, "token_request_failed")
    return response.json()


async def exchange_code(code: str) -> dict[str, Any]:
    return await _post_token(
        {
            "grant_type": "authorization_code",
            "client_id": settings.atlassian_client_id,
            "client_secret": settings.atlassian_client_secret,
            "code": code,
            "redirect_uri": settings.atlassian_redirect_uri,
        }
    )


async def refresh_tokens(refresh_token: str) -> dict[str, Any]:
    return await _post_token(
        {
            "grant_type": "refresh_token",
            "client_id": settings.atlassian_client_id,
            "client_secret": settings.atlassian_client_secret,
            "refresh_token": refresh_token,
        }
    )


async def get_accessible_resources(access_token: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        response = await client.get(
            ACCESSIBLE_RESOURCES_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
        )

    if response.status_code != 200:
        raise _response_error(response, "accessible_resources_failed")
    payload = response.json()
    return payload if isinstance(payload, list) else []


async def get_spaces(cloud_id: str, access_token: str) -> list[dict[str, str]]:
    url = f"{CONFLUENCE_API_BASE}/{cloud_id}/wiki/api/v2/spaces"
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        response = await client.get(
            url,
            params={"limit": 250},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
        )

    if response.status_code == 401:
        raise AtlassianError(
            code="ATLASSIAN_TOKEN_EXPIRED",
            message="Atlassian access token is invalid or expired.",
            status_code=401,
        )
    if response.status_code != 200:
        raise _response_error(response, "confluence_spaces_failed")

    payload = response.json()
    results = payload.get("results", []) if isinstance(payload, dict) else []
    return [
        {
            "id": str(item.get("id", "")),
            "key": str(item.get("key", "")),
            "name": str(item.get("name", "")),
        }
        for item in results
        if isinstance(item, dict)
    ]
