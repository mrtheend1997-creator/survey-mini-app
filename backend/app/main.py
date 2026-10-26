import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import admin_data, admin_surveys, admin_users, public

log = logging.getLogger("fti")
settings = get_settings()



@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.dev_mode:
        log.warning("DEV_MODE is ON: requests without Telegram signature are accepted. Never use in production!")
    if not settings.bot_token:
        log.warning("BOT_TOKEN is not set: Telegram login will not work.")
    yield


app = FastAPI(lifespan=lifespan, title="FTI Survey API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

origins = [o.strip() for o in settings.webapp_url.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(public.router)
app.include_router(admin_surveys.router)
app.include_router(admin_data.router)
app.include_router(admin_users.router)

Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.get("/api/health")
def health():
    return {"ok": True}

