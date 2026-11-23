"""Shared elevator stop parsing and authored shaft support."""

from __future__ import annotations

import re

from .models import COORDINATE_LIMIT, WorldItem
from .platform_service import PlatformService


def parse_stops(value: object) -> list[int]:
    """Parse a compact editor string or durable integer list into ordered stops."""
    if isinstance(value, str):
        fields = value.split(",")
        if any(not re.fullmatch(r"[+-]?\d+", field.strip()) for field in fields):
            raise ValueError("Stops must be comma-delimited whole numbers.")
        stops = [int(field.strip()) for field in fields]
    elif isinstance(value, list) and all(type(stop) is int for stop in value):
        stops = list(value)
    else:
        raise ValueError("Stops must be comma-delimited whole numbers.")
    if not 2 <= len(stops) <= 100:
        raise ValueError("Use between 2 and 100 stops.")
    if len(set(stops)) != len(stops):
        raise ValueError("Stops must have distinct elevations.")
    if any(abs(stop) > COORDINATE_LIMIT for stop in stops):
        raise ValueError("Stop elevations must be between -1000000 and 1000000.")
    return sorted(stops)


def validate_shaft_support(item: WorldItem, geometry: PlatformService) -> None:
    """Require at least one supported stop where people can board the shaft."""
    stops = parse_stops(item.params.get("floorZs", [0, 40]))
    if not any(geometry.contains(item.x, item.y, z) for z in stops):
        raise ValueError("The elevator needs at least one stop on a platform.")
