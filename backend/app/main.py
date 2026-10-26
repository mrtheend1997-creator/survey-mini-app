import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import telegram_bot
from .config import get_settings
from .errors import ApiError
from .routers import admin_data, admin_surveys, admin_users, public

log = logging.getLogger("fti")
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.dev_mode:
        log.warning("DEV_MODE is ON: requests without Telegram signature are accepted. Never use in production!")
    if not settings.bot_token:
        log.warning("BOT_TOKEN is not set: Telegram login will not work.")
    if settings.telegram_webhook:
        # in the background so a slow Telegram API never delays startup
        threading.Thread(target=telegram_bot.register_webhook, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan, title="FTI Survey API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(public.router)
app.include_router(admin_surveys.router)
app.include_router(admin_data.router)
app.include_router(admin_users.router)
app.include_router(telegram_bot.router)

Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.get("/api/health")
def health():
    return {"ok": True}


# Optional: serve the built Mini App from the same address (single-service deployments such as Render).
static_root = Path(settings.static_dir) if settings.static_dir else None
if static_root and (static_root / "index.html").is_file():
    if (static_root / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=static_root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise ApiError(404, "not_found")
        file = (static_root / path).resolve()
        if path and file.is_file() and static_root.resolve() in file.parents:
            return FileResponse(file)
        return FileResponse(static_root / "index.html", headers={"Cache-Control": "no-cache"})
