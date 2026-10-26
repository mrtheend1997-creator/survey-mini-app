"""Image validation and storage in the database (see models.StoredFile)."""

from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import StoredFile, utcnow

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}


def detect_image(head: bytes) -> str | None:
    """File extension from the file's real content (magic bytes), not from its name."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


def validate_image(data: bytes, max_bytes: int, allowed: tuple[str, ...] = tuple(IMAGE_TYPES)) -> str:
    """Return the extension of a valid image or raise ApiError."""
    if len(data) > max_bytes:
        raise ApiError(413, "file_too_large")
    ext = detect_image(data[:16])
    if ext is None or ext not in allowed:
        raise ApiError(415, "file_type")
    return ext


def put(db: Session, key: str, data: bytes, ext: str) -> StoredFile:
    row = db.get(StoredFile, key)
    if row is None:
        row = StoredFile(key=key)
        db.add(row)
    row.content = data
    row.content_type = IMAGE_TYPES[ext]
    row.size = len(data)
    row.created_at = utcnow()
    return row
