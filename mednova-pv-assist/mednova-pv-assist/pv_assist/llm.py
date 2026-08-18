"""
Thin, optional LLM layer.

Design rules that matter for PV:
  1. The LLM never invents a code. It only reads narrative and returns
     structured judgements (which criteria are present, why). Coding is done
     by constrained matching against the licensed dictionary (see coding/).
  2. Everything is opt-in. If ANTHROPIC_API_KEY is unset, the system still runs
     on its deterministic rules — you just lose the narrative-reasoning lift.
  3. Where health data cannot leave your environment, set provider="none" and
     rely on the rules engines, or point `base_url` at a self-hosted model.
"""
from __future__ import annotations

import json
import os
from typing import Any


class LLMClient:
    def __init__(
        self,
        provider: str = "anthropic",
        model: str = "claude-sonnet-4-5",
        api_key: str | None = None,
    ):
        self.provider = provider
        self.model = model
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self._client = None
        if provider == "anthropic" and self.api_key:
            try:
                import anthropic
                self._client = anthropic.Anthropic(api_key=self.api_key)
            except ImportError:
                self._client = None

    @property
    def available(self) -> bool:
        return self._client is not None

    def judge_json(self, system: str, prompt: str, max_tokens: int = 1024) -> dict[str, Any] | None:
        """
        Ask the model for a strictly-JSON judgement. Returns None if the LLM
        is unavailable so callers can fall back to rules. Never raises on a
        bad response — a malformed judgement is treated as 'no opinion'.
        """
        if not self.available:
            return None
        try:
            msg = self._client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system + "\n\nRespond with ONLY valid JSON. No prose, no markdown fences.",
                messages=[{"role": "user", "content": prompt}],
            )
            text = "".join(b.text for b in msg.content if b.type == "text")
            text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            return json.loads(text)
        except Exception:
            return None
