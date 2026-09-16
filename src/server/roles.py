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
# invite code.
#
# PV_MANAGER is absent because it is minted only by CREATE_ORG, for the
# person who creates the organisation.
#
# The three assessor roles are absent because they are PROVISIONED, never
# self-served: an administrator creates the account and hands over initial
# credentials, which the person then changes. A Peer Reviewer can
# countersign a regulatory assessment, so who holds that role is the
# organisation's decision, not a claim someone can make about themselves.
# An invite code would not be enough — it is a shared secret that spreads.
#
# This is the enforcing copy. Even if a client sent role=PEER_REVIEWER, the
# signup handler falls back to PV_COORDINATOR because it is not in this set,
# and the Literal on SignUpRequest rejects it before that.
JOINABLE_ROLES: Final = frozenset({FIELD_ASSOCIATE, PV_COORDINATOR})

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
    # The assessor roles keep these: they are processing tools the single
    # ADMIN role ran before the split, not a step of the PSUR assessment.
    "linelist.process": {
        PV_COORDINATOR,
        PV_MANAGER,
        REVIEW_OFFICER,
        EVALUATOR,
        PEER_REVIEWER,
    },
    "e2b.generate": {
        PV_COORDINATOR,
        PV_MANAGER,
        REVIEW_OFFICER,
        EVALUATOR,
        PEER_REVIEWER,
    },
    # Opening the PSUR surface. Everyone who touches a periodic report holds
    # this; what they may CHANGE once there is governed by the three
    # permissions below, so that no one role can screen a report, review it,
    # and countersign its own review.
    # REVIEW_OFFICER is absent: the scientific review is not their step.
    "psur.review": {PV_COORDINATOR, PV_MANAGER, EVALUATOR, PEER_REVIEWER},
    "psur.screen": {REVIEW_OFFICER},
    "psur.evaluate": {PV_COORDINATOR, PV_MANAGER, EVALUATOR, PEER_REVIEWER},
    "psur.peer_review": {PEER_REVIEWER},
}


def normalize_role(role: str) -> str:
    try:
        return ROLE_ALIASES[role.strip().upper()]
    except (AttributeError, KeyError) as error:
        raise ValueError(f"Unsupported application role: {role}") from error


def has_permission(role: str, permission: str) -> bool:
    return normalize_role(role) in PERMISSION_ROLES.get(permission, set())
