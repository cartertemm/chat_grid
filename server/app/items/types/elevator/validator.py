"""Elevator item validation."""

from __future__ import annotations

from math import isfinite

from ....elevator_geometry import parse_stops
from ....models import WorldItem
from ...emit_validation import validate_emit_direction, validate_emit_properties
from ...helpers import keep_only_known_params
from .definition import PARAM_KEYS


def _validate_duration(
    current_params: dict, next_params: dict, key: str, default: float
) -> float:
    """Validate one editable elevator duration in seconds."""

    try:
        value = float(next_params.get(key, current_params.get(key, default)))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be a number between 0 and 300.") from exc
    if not 0 <= value <= 300:
        raise ValueError(f"{key} must be between 0 and 300.")
    return round(value, 1)


def validate_update(item: WorldItem, next_params: dict) -> dict:
    """Validate editable timing and audio while preserving runtime state."""

    validated = dict(item.params)
    validated["doorOpenSeconds"] = _validate_duration(
        item.params, next_params, "doorOpenSeconds", 5
    )
    validated["floorZs"] = parse_stops(
        next_params.get("floorZs", item.params.get("floorZs", [0, 40]))
    )
    raw_speed = next_params.get("speed", item.params.get("speed", 10))
    try:
        speed = float(raw_speed)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(
            "Speed must be between 0.1 and 1000 Z units per second."
        ) from exc
    if isinstance(raw_speed, bool) or not isfinite(speed) or not 0.1 <= speed <= 1000:
        raise ValueError("Speed must be between 0.1 and 1000 Z units per second.")
    validated["speed"] = round(speed, 1)
    validated.update(validate_emit_direction(item.params, next_params))
    validated.update(validate_emit_properties(item.params, next_params))
    return keep_only_known_params(validated, PARAM_KEYS)
