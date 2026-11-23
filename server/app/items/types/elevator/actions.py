"""Elevator item action fallback."""

from __future__ import annotations

from typing import Callable

from ....item_types import ItemUseResult
from ....models import WorldItem


def use_item(
    item: WorldItem, _nickname: str, _clock_formatter: Callable[[dict], str]
) -> ItemUseResult:
    """Return the fallback message when server elevator routing is unavailable."""

    return ItemUseResult(
        self_message=f"{item.title} is unavailable.",
        others_message="",
    )


def secondary_use_item(
    item: WorldItem, _nickname: str, _clock_formatter: Callable[[dict], str]
) -> ItemUseResult:
    """Report the elevator car's landing or travel state."""

    return ItemUseResult(
        self_message=describe_car(item, lambda _x, _y, z: f"height {z}"),
        others_message="",
    )


def describe_car(item: WorldItem, floor_name: Callable[[int, int, int], str]) -> str:
    """Describe the last stop, door and active trip using names at the shaft."""
    current_z = int(item.params.get("currentZ", item.z))
    current_name = floor_name(item.x, item.y, current_z)
    state = item.params.get("state")
    if state == "moving":
        target_z = int(item.params.get("targetZ", current_z))
        direction = "up" if target_z > current_z else "down"
        target_name = floor_name(item.x, item.y, target_z)
        return f"{item.title} is headed to {target_name}, traveling {direction}, from {current_name}."
    if state in {"opening", "arriving", "closing"}:
        door_state = "opening" if state == "arriving" else state
    else:
        door_state = "open" if item.params.get("doorOpen") else "closed"
    return f"{item.title} is on {current_name}, door {door_state}."
