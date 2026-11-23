"""Discover installed platform footsteps without accepting arbitrary sound paths."""

from __future__ import annotations

import logging
from pathlib import Path
import re
from urllib.parse import quote

from .models import FootstepSet

LOGGER = logging.getLogger("chgrid.server.footsteps")
_SET_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}")


def default_footstep_sounds_dir() -> Path:
    """Locate the shipped step directories beside the server checkout."""
    return (
        Path(__file__).resolve().parents[2] / "client" / "public" / "sounds" / "steps"
    )


def _natural_name(path: Path) -> tuple:
    return tuple(
        (1, int(part)) if part.isdigit() else (0, part.casefold())
        for part in re.split(r"(\d+)", path.name)
    )


def discover_footstep_sets(sounds_dir: Path) -> list[FootstepSet]:
    """Publish nonempty Ogg directories, with a default entry for browser fallback."""
    discovered = {"default": FootstepSet(id="default", title="Default", urls=[])}
    try:
        for directory in sorted(sounds_dir.iterdir(), key=_natural_name):
            if (
                directory.is_symlink()
                or not directory.is_dir()
                or not _SET_ID.fullmatch(directory.name)
            ):
                continue
            samples = sorted(
                (
                    path
                    for path in directory.iterdir()
                    if not path.is_symlink()
                    and path.is_file()
                    and path.suffix.casefold() == ".ogg"
                ),
                key=_natural_name,
            )
            if not samples:
                continue
            title = directory.name.replace("_", " ").replace("-", " ").title()
            discovered[directory.name] = FootstepSet(
                id=directory.name,
                title=title,
                urls=[
                    f"/sounds/steps/{quote(directory.name, safe='')}/{quote(path.name, safe='')}"
                    for path in samples
                ],
            )
    except OSError as exc:
        LOGGER.warning("Could not discover footstep sets in %s: %s", sounds_dir, exc)
    return list(discovered.values())
