from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes import atlassian, auth

app = FastAPI(title="Atlassian Confluence OAuth Demo", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url.rstrip("/")],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(atlassian.router)


@app.get("/api/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
