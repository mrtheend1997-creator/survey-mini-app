"""Super Admin: the regions and districts list used by "Region → district" questions."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_role
from ..db import get_db
from ..errors import ApiError
from ..models import Region, User, utcnow
from ..schemas import RegionIn, RegionPatch
from ..services import audit
from .public import list_regions

router = APIRouter(prefix="/api/admin/regions", tags=["admin-regions"])
super_only = require_role("super_admin")


def _live(db: Session, region_id: int) -> Region:
    r = db.get(Region, region_id)
    if r is None or r.deleted_at is not None:
        raise ApiError(404, "not_found")
    return r


@router.get("")
def get_regions(user: User = Depends(super_only), db: Session = Depends(get_db)):
    return list_regions(user, db)


@router.post("")
def add_region(body: RegionIn, user: User = Depends(super_only), db: Session = Depends(get_db)):
    if body.parent_id is not None:
        parent = _live(db, body.parent_id)
        if parent.parent_id is not None:  # only two levels: region → district
            raise ApiError(422, "invalid_answer")
    pos = db.scalar(select(func.coalesce(func.max(Region.position), -1)).where(Region.parent_id == body.parent_id)) + 1
    r = Region(parent_id=body.parent_id, position=pos, name_uz=body.name_uz.strip(), name_ru=body.name_ru.strip())
    db.add(r)
    db.flush()
    audit.log(db, user, "region.create", "region", r.id, name=r.name_uz)
    db.commit()
    return {"id": r.id}


@router.patch("/{region_id}")
def rename_region(region_id: int, body: RegionPatch, user: User = Depends(super_only), db: Session = Depends(get_db)):
    r = _live(db, region_id)
    if body.name_uz is not None:
        r.name_uz = body.name_uz.strip()
    if body.name_ru is not None:
        r.name_ru = body.name_ru.strip()
    audit.log(db, user, "region.update", "region", r.id, name=r.name_uz)
    db.commit()
    return {"ok": True}


@router.delete("/{region_id}")
def delete_region(region_id: int, user: User = Depends(super_only), db: Session = Depends(get_db)):
    """Hidden from new answers; old answers that point to it still show its name."""
    r = _live(db, region_id)
    now = utcnow()
    r.deleted_at = now
    for child in db.scalars(select(Region).where(Region.parent_id == r.id, Region.deleted_at.is_(None))):
        child.deleted_at = now
    audit.log(db, user, "region.delete", "region", r.id, name=r.name_uz)
    db.commit()
    return {"ok": True}
