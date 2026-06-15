"""Skill loader — dynamically loads SKILL.md files based on current conditions."""

import os
from pathlib import Path

from loguru import logger

SKILLS_DIR = Path(os.getenv("SKILLS_DIR", "backend/skills"))


class SkillLoader:
    """
    Reads SKILL.md files at startup, selects relevant ones per cycle.
    Reduces average context size by only loading what's needed.
    """

    def __init__(self) -> None:
        self._cache: dict[str, str] = {}
        self._load_all()

    def _load_all(self) -> None:
        if not SKILLS_DIR.exists():
            logger.warning("Skills directory not found: {}", SKILLS_DIR)
            return
        for skill_dir in SKILLS_DIR.iterdir():
            skill_file = skill_dir / "SKILL.md"
            if skill_dir.is_dir() and skill_file.exists():
                content = skill_file.read_text()
                self._cache[skill_dir.name] = content
                logger.info("Skill loaded: {} ({} chars)", skill_dir.name, len(content))

    def get_relevant_skills(
        self,
        regime: str,
        instrument: str,
        consecutive_losses: int,
        position_size_inr: float,
        iv_percentile: float,
    ) -> dict[str, str]:
        relevant: dict[str, str] = {}

        if regime in ("TRENDING_UP", "TRENDING_DOWN", "BREAKOUT_IMMINENT"):
            relevant["smc_entry"] = self._cache.get("smc_entry", "")

        if regime == "RANGING" and iv_percentile > 50:
            relevant["options_strategy"] = self._cache.get("options_strategy", "")

        if instrument == "XAUUSD_PERP":
            relevant["xauusd_commodity"] = self._cache.get("xauusd_commodity", "")

        if consecutive_losses >= 2:
            relevant["post_loss_protocol"] = self._cache.get("post_loss_protocol", "")

        if regime == "BREAKOUT_IMMINENT":
            relevant["breakout_trading"] = self._cache.get("breakout_trading", "")

        if position_size_inr > 500_000:
            relevant["scaling_execution"] = self._cache.get("scaling_execution", "")

        relevant = {k: v for k, v in relevant.items() if v}
        logger.debug("Skills loaded for cycle: {}", list(relevant.keys()))
        return relevant

    def format_for_prompt(self, skills: dict[str, str]) -> str:
        if not skills:
            return ""
        sections = [
            f"=== SKILL: {name.upper().replace('_', ' ')} ===\n{content}"
            for name, content in skills.items()
        ]
        return "\n\n".join(sections)

    def get_status(self) -> dict:
        return {
            "available_skills": list(self._cache.keys()),
            "skill_sizes": {name: len(content) for name, content in self._cache.items()},
        }


skill_loader = SkillLoader()
