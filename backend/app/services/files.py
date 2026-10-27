"""File validation and storage in the database (see models.StoredFile)."""

import io
import zipfile

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


DOCUMENT_TYPES = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain; charset=utf-8",
}
CONTENT_TYPES = {**IMAGE_TYPES, **DOCUMENT_TYPES}
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
# folder every genuine Office Open XML file of that kind has inside its zip
OOXML_DIRS = {".docx": "word/", ".xlsx": "xl/", ".pptx": "ppt/"}


def detect_file(data: bytes, filename: str) -> str | None:
    """Real type of an attached file, checked from its content (the name alone is not trusted).

    Old Office formats (.doc/.xls/.ppt) share one container signature, so for them the name's
    extension decides which of the three it is.
    """
    name_ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if name_ext == ".jpeg":
        name_ext = ".jpg"
    image = detect_image(data[:16])
    if image:
        return image
    if data.startswith(b"%PDF-"):
        return ".pdf"
    if data.startswith(OLE_MAGIC):
        return name_ext if name_ext in (".doc", ".xls", ".ppt") else None
    if data.startswith(b"PK\x03\x04") and name_ext in OOXML_DIRS:
        try:
            names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        except zipfile.BadZipFile:
            return None
        if "[Content_Types].xml" in names and any(n.startswith(OOXML_DIRS[name_ext]) for n in names):
            return name_ext
        return None
    if name_ext == ".txt" and b"\x00" not in data:
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            return None
        return ".txt"
    return None


def put(db: Session, key: str, data: bytes, ext: str, name: str = "") -> StoredFile:
    row = db.get(StoredFile, key)
    if row is None:
        row = StoredFile(key=key)
        db.add(row)
    row.content = data
    row.content_type = CONTENT_TYPES[ext]
    row.size = len(data)
    row.name = name[:255]
    row.created_at = utcnow()
    return row
