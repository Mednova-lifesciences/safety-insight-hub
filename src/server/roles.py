"""Canonical application roles and server-side permissions."""

from typing import Final

# MAH-side pharmacovigilance staff.
FIELD_ASSOCIATE: Final = "FIELD_ASSOCIATE"
PV_COORDINATOR: Final = "PV_COORDINATOR"
PV_MANAGER: Final = "PV_MANAGER"

# NAFDAC's assessors. All three are administrators and share the
# administrator sign-in door, but they are three consecutive STEPS of one
# assessment rather than three tiers of seniority: the Review Officer
# screens an incoming periodic report and decides whether it goes forward
# or back to the MAH, the Evaluator performs the scientific review, and the
# Peer Reviewer checks that review and countersigns it. They replaced a
# single ADMIN role that did all three jobs at once.
REVIEW_OFFICER: Final = "REVIEW_OFFICER"
EVALUATOR: Final = "EVALUATOR"
PEER_REVIEWER: Final = "PEER_REVIEWER"

# Roles a person may sign THEMSELVES up as, given the organisation's private
# invite code. PV_MANAGER is absent on purpose: it is minted only by
# CREATE_ORG, for the person who creates the organisation.
#
# The three assessor roles are here so NAFDAC's staff can register without a
# DBA, but the invite code stays mandatory — PEER_REVIEWER in particular
# carries the authority to countersign a regulatory assessment.
JOINABLE_ROLES: Final = frozenset(
    {FIELD_ASSOCIATE, PV_COORDINATOR, REVIEW_OFFICER, EVALUATOR, PEER_REVIEWER}
)

ROLE_ALIASES: Final = {
    "FIELD_ASSOCIATE": FIELD_ASSOCIATE,
    "PV_COORDINATOR": PV_COORDINATOR,
    "COORDINATOR": PV_COORDINATOR,
    "PV_MANAGER": PV_MANAGER,
    "MANAGER": PV_MANAGER,
    "REVIEW_OFFICER": REVIEW_OFFICER,
    "EVALUATOR": EVALUATOR,
    "PEER_REVIEWER": PEER_REVIEWER,
}

# has_permission() is deny-by-default (see .get(permission, set()) below), so
# a permission missing from this map is refused for EVERY role, whatever the
# frontend believes. Any permission added to the Permission union in
# lib/auth.tsx has to be added here too or the endpoint guarding on it will
# reject every caller.
PERMISSION_ROLES: Final = {
    "case.create": {FIELD_ASSOCIATE, PV_COORDINATOR, PV_MANAGER},
    "case.view": {FIELD_ASSOCIATE, PV_COORDINATOR, PV_MANAGER},
    "case.assign": {PV_COORDINATOR, PV_MANAGER},
    "audit.view.all": {PV_COORDINATOR, PV_MANAGER},
    "follow_up.view": {FIELD_ASSOCIATE, PV_COORDINATOR, PV_MANAGER},
    "follow_up.create": {FIELD_ASSOCIATE, PV_COORDINATOR, PV_MANAGER},
    "intake.manage": {FIELD_ASSOCIATE, PV_COORDINATOR, PV_MANAGER},
    "linelist.process": {PV_COORDINATOR, PV_MANAGER},
    # Opening the PSUR surface. Everyone who touches a periodic report holds
    # this; what they may CHANGE once there is governed by the three
    # permissions below, so that no one role can screen a report, review it,
    # and countersign its own review.
    "psur.review": {
        PV_COORDINATOR,
        PV_MANAGER,
        REVIEW_OFFICER,
        EVALUATOR,
        PEER_REVIEWER,
    },
    "psur.screen": {REVIEW_OFFICER},
    "psur.evaluate": {PV_COORDINATOR, PV_MANAGER, EVALUATOR},
    "psur.peer_review": {PEER_REVIEWER},
}


def normalize_role(role: str) -> str:
    try:
        return ROLE_ALIASES[role.strip().upper()]
    except (AttributeError, KeyError) as error:
        raise ValueError(f"Unsupported application role: {role}") from error


def has_permission(role: str, permission: str) -> bool:
    return normalize_role(role) in PERMISSION_ROLES.get(permission, set())
