"""Serving stored images and managing the app logo.

Image URLs are opened by <img> tags, which can't send the Authorization header,
so GET endpoints here are public. Only images that passed validation are stored.
"""

import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from ..auth import require_role
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError
from ..models import StoredFile, User
from ..services import audit, files

router = APIRouter(prefix="/api", tags=["files"])
super_only = require_role("super_admin")

LOGO_KEY = "logo"
LOGO_MAX_BYTES = 2 * 1024 * 1024
LOGO_TYPES = (".png", ".jpg", ".webp")
UPLOAD_NAME = re.compile(r"^[0-9a-f]{32}\.(png|jpg|gif|webp)$")


def _image_response(row: StoredFile, cache: str) -> Response:
    return Response(
        row.content,
        media_type=row.content_type,
        headers={"Cache-Control": cache, "X-Content-Type-Options": "nosniff"},
    )


@router.get("/branding")
def branding(db: Session = Depends(get_db)):
    """Current logo URL; null means the built-in FTI logo is used."""
    row = db.get(StoredFile, LOGO_KEY)
    if row is None:
        return {"logo_url": None}
    return {"logo_url": f"/api/files/logo?v={int(row.created_at.timestamp())}"}


@router.get("/files/logo")
def get_logo(db: Session = Depends(get_db)):
    row = db.get(StoredFile, LOGO_KEY)
    if row is None:
        raise ApiError(404, "not_found")
    # the URL carries ?v=<version>, so it can be cached for long
    return _image_response(row, "public, max-age=31536000, immutable")


@router.put("/admin/branding/logo")
async def upload_logo(file: UploadFile = File(...), user: User = Depends(super_only), db: Session = Depends(get_db)):
    data = await file.read(LOGO_MAX_BYTES + 1)
    ext = files.validate_image(data, LOGO_MAX_BYTES, LOGO_TYPES)
    files.put(db, LOGO_KEY, data, ext)
    audit.log(db, user, "settings.logo", "settings", None, size=len(data))
    db.commit()
    return branding(db)


@router.delete("/admin/branding/logo")
def reset_logo(user: User = Depends(super_only), db: Session = Depends(get_db)):
    row = db.get(StoredFile, LOGO_KEY)
    if row is not None:
        db.delete(row)
        audit.log(db, user, "settings.logo_reset", "settings", None)
        db.commit()
    return {"logo_url": None}


@router.get("/uploads/{name}")
def get_upload(name: str, db: Session = Depends(get_db)):
    if not UPLOAD_NAME.match(name):
        raise ApiError(404, "not_found")
    row = db.get(StoredFile, f"upload/{name}")
    if row is not None:
        return _image_response(row, "public, max-age=31536000, immutable")
    # pictures uploaded before images moved into the database
    legacy = Path(get_settings().upload_dir) / name
    if legacy.is_file():
        return FileResponse(legacy, headers={"X-Content-Type-Options": "nosniff"})
    raise ApiError(404, "not_found")
