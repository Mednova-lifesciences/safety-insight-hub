"""
Append-only audit trail.

Every suggestion, flag, or transformation this system makes gets written here
with a timestamp, the module, the case/record it touched, and the rationale.
Nothing in this system silently changes an ICSR — it records what it would
suggest, and a human decision (accept/reject) is logged back against it.

This is the difference between an inspection asset and an inspection liability.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any


class AuditTrail:
    def __init__(self, path: str = "audit_log.jsonl"):
        self.path = path
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

    def record(
        self,
        *,
        module: str,
        action: str,
        subject_id: str,
        detail: dict[str, Any],
        actor: str = "system",
        confidence: float | None = None,
    ) -> str:
        """Write one audit entry. Returns the entry id."""
        entry = {
            "entry_id": str(uuid.uuid4()),
            "ts_utc": datetime.now(timezone.utc).isoformat(),
            "module": module,
            "action": action,          # e.g. "seriousness_mismatch_flagged"
            "subject_id": subject_id,  # case number / record id
            "actor": actor,            # "system" | "llm:claude-..." | username
            "confidence": confidence,
            "detail": detail,
            "decision": None,          # filled in later by log_decision()
        }
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return entry["entry_id"]

    def log_decision(self, entry_id: str, decision: str, reviewer: str) -> None:
        """
        Append a human decision (accepted / rejected / amended) that references
        an earlier suggestion. We append rather than rewrite so the log stays
        immutable — the full history is reconstructable.
        """
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "entry_id": str(uuid.uuid4()),
                "ts_utc": datetime.now(timezone.utc).isoformat(),
                "module": "review",
                "action": "human_decision",
                "references": entry_id,
                "decision": decision,   # "accepted" | "rejected" | "amended"
                "actor": reviewer,
            }, ensure_ascii=False) + "\n")
