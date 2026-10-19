from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

JWT_ALGORITHM = "HS256"
JWT_SUBJECT = "demo-user"
OAUTH_STATE_PURPOSE = "oauth_state"
OAUTH_STATE_TTL_MINUTES = 10

_bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": code, "message": message},
    )


def create_access_token() -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": JWT_SUBJECT,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def create_oauth_state() -> str:
    now = datetime.now(UTC)
    payload = {
        "purpose": OAUTH_STATE_PURPOSE,
        "iat": now,
        "exp": now + timedelta(minutes=OAUTH_STATE_TTL_MINUTES),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def verify_oauth_state(state: str) -> None:
    try:
        payload = jwt.decode(state, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_STATE",
                "message": "OAuth state is invalid or expired.",
            },
        ) from exc

    if payload.get("purpose") != OAUTH_STATE_PURPOSE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_STATE",
                "message": "OAuth state has an unexpected purpose.",
            },
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    if credentials is None:
        raise _unauthorized("AUTH_REQUIRED", "Missing Authorization bearer token.")

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=[JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized(
            "AUTH_REQUIRED", "JWT has expired. Please log in again."
        ) from exc
    except jwt.PyJWTError as exc:
        raise _unauthorized("AUTH_REQUIRED", "Invalid JWT.") from exc

    subject = payload.get("sub")
    if subject != JWT_SUBJECT:
        raise _unauthorized("AUTH_REQUIRED", "Unexpected JWT subject.")
    return JWT_SUBJECT
