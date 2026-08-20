"""Canonical application roles and server-side permissions."""

from typing import Final

FIELD_ASSOCIATE: Final = "FIELD_ASSOCIATE"
PV_COORDINATOR: Final = "PV_COORDINATOR"
PV_MANAGER: Final = "PV_MANAGER"
ADMIN: Final = "ADMIN"

ROLE_ALIASES: Final = {
    "FIELD_ASSOCIATE": FIELD_ASSOCIATE,
    "PV_COORDINATOR": PV_COORDINATOR,
    "COORDINATOR": PV_COORDINATOR,
    "PV_MANAGER": PV_MANAGER,
    "MANAGER": PV_MANAGER,
    "ADMIN": ADMIN,
}

PERMISSION_ROLES: Final = {
    "case.create": {FIELD_ASSOCIATE, PV_COORDINATOR, ADMIN},
    "case.view": {FIELD_ASSOCIATE, PV_COORDINATOR, PV_MANAGER, ADMIN},
    "case.assign": {PV_COORDINATOR, PV_MANAGER, ADMIN},
    "audit.view.all": {PV_COORDINATOR, PV_MANAGER, ADMIN},
    "follow_up.view": {FIELD_ASSOCIATE, PV_COORDINATOR, PV_MANAGER, ADMIN},
    "follow_up.create": {FIELD_ASSOCIATE, PV_COORDINATOR, PV_MANAGER, ADMIN},
    "intake.manage": {FIELD_ASSOCIATE, PV_COORDINATOR, PV_MANAGER, ADMIN},
    "linelist.process": {PV_COORDINATOR, PV_MANAGER, ADMIN},
    "psur.review": {PV_COORDINATOR, PV_MANAGER, ADMIN},
}


def normalize_role(role: str) -> str:
    try:
        return ROLE_ALIASES[role.strip().upper()]
    except (AttributeError, KeyError) as error:
        raise ValueError(f"Unsupported application role: {role}") from error


def has_permission(role: str, permission: str) -> bool:
    return normalize_role(role) in PERMISSION_ROLES.get(permission, set())
