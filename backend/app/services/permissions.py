"""Individual administrator permissions.

What an administrator may do with a survey = the permission switch set by the Super Admin
AND the access level they have to that survey:

* the surveys they created themselves: full;
* "all surveys": the level chosen for all surveys;
* surveys picked one by one: the level chosen for each.

Super Admins can do everything. Analysts only look: results and (if allowed) export.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import Survey, SurveyManager, User

PERMISSIONS = (
    "survey_create",  # create surveys
    "survey_edit",  # edit survey title, description and settings
    "survey_delete",
    "question_manage",  # add, edit, delete, duplicate, reorder questions
    "question_type",  # change a question's type
    "option_manage",  # add and remove answer options
    "timer_manage",  # dates, time limits
    "anonymity_manage",  # anonymous / named / registration
    "logic_manage",  # conditional jumps
    "media_manage",  # pictures and videos
    "template_manage",
    "publish",  # publish, pause, resume, finish
    "results_view",
    "export",  # Excel / CSV / PDF
    "participants_manage",  # who may answer and how often
)

VIEW_PERMS = {"results_view", "export"}
EDIT_PERMS = VIEW_PERMS | {
    "survey_edit",
    "question_manage",
    "question_type",
    "option_manage",
    "timer_manage",
    "anonymity_manage",
    "logic_manage",
    "media_manage",
    "participants_manage",
}
FULL_PERMS = EDIT_PERMS | {"publish", "survey_delete"}
LEVELS = {"view": VIEW_PERMS, "edit": EDIT_PERMS, "full": FULL_PERMS}
# permissions that are not about one particular survey
GLOBAL_PERMS = {"survey_create", "template_manage"}

ANALYST_PERMS = VIEW_PERMS

# ready-made sets the Super Admin can start from
TEMPLATES: dict[str, dict[str, bool]] = {
    "full": {p: True for p in PERMISSIONS},
    "create_edit": {
        p: p
        not in {"survey_delete", "publish", "export", "anonymity_manage", "participants_manage"}
        for p in PERMISSIONS
    },
    "view_stats": {p: p in VIEW_PERMS for p in PERMISSIONS},
}


def normalize(perms: dict | None, role: str) -> dict[str, bool]:
    """A complete, clean {permission: bool} dict for storing. Unknown keys are dropped."""
    perms = perms or {}
    out = {p: bool(perms.get(p, False)) for p in PERMISSIONS}
    if role == "analyst":
        out = {p: out[p] and p in ANALYST_PERMS for p in PERMISSIONS}
    return out


def default_for(role: str) -> dict[str, bool]:
    if role == "analyst":
        return dict(TEMPLATES["view_stats"])
    return dict(TEMPLATES["full"])


def granted(user: User) -> set[str]:
    """Permission switches that are on for this user (whatever the survey)."""
    role = user.access_role
    if role == "super_admin":
        return set(PERMISSIONS)
    if role not in ("admin", "analyst"):
        return set()
    stored = user.permissions if user.permissions is not None else default_for(role)
    perms = normalize(stored, role)
    return {p for p, on in perms.items() if on}


def survey_level(db: Session, user: User, survey: Survey) -> str | None:
    role = user.access_role
    if role == "super_admin":
        return "full"
    if role not in ("admin", "analyst"):
        return None
    levels = []
    if role == "admin" and survey.owner_id == user.id:
        levels.append("full")
    if user.all_surveys:
        levels.append(user.all_surveys_level)
    row = db.scalar(select(SurveyManager).where(SurveyManager.survey_id == survey.id, SurveyManager.user_id == user.id))
    if row is not None:
        levels.append(row.level)
    levels = [lv for lv in levels if lv in LEVELS]
    if not levels:
        return None
    best = max(levels, key=lambda lv: len(LEVELS[lv]))
    return "view" if role == "analyst" else best


def survey_permissions(db: Session, user: User, survey: Survey) -> set[str]:
    level = survey_level(db, user, survey)
    if level is None:
        return set()
    return granted(user) & LEVELS[level]


def has(user: User, perm: str) -> bool:
    return perm in granted(user)


def require(user: User, perm: str) -> None:
    """For actions not tied to a survey (create a survey, upload a picture...)."""
    if perm not in granted(user):
        raise ApiError(403, code_for(perm))


def require_on(db: Session, user: User, survey: Survey, perm: str) -> None:
    if survey_level(db, user, survey) is None:
        raise ApiError(403, "forbidden")
    if perm not in survey_permissions(db, user, survey):
        raise ApiError(403, code_for(perm))


def code_for(perm: str) -> str:
    return {"publish": "no_publish_right", "export": "no_export_right"}.get(perm, "no_permission")
