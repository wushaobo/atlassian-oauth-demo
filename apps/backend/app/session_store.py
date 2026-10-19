from dataclasses import dataclass
from datetime import datetime


@dataclass
class AtlassianSession:
    """Atlassian OAuth tokens for the single demo user."""

    access_token: str
    refresh_token: str | None
    expires_at: datetime
    cloud_id: str
    site_url: str
    site_name: str


_session: AtlassianSession | None = None


def get_session() -> AtlassianSession | None:
    return _session


def set_session(session: AtlassianSession) -> None:
    global _session
    _session = session


def clear_session() -> None:
    global _session
    _session = None
