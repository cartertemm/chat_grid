"""Authoritative flat platform geometry and durable authored platforms."""

from __future__ import annotations

from collections.abc import Callable
import json
from bisect import bisect_right
from pathlib import Path
import uuid

from .models import Platform
from .state_files import read_state_text, write_json_atomic

MAX_PLATFORMS = 1000


class PlatformError(ValueError):
    """Describe an invalid platform or an unsupported world mutation."""


class PlatformService:
    """Own nonoverlapping flat rectangles and compact walkability queries."""

    def __init__(self, *, state_file: Path | None, grid_size: int = 41) -> None:
        """Load saved geometry or seed the legacy layout on first startup."""
        self.state_file = state_file
        self.grid_size = grid_size
        self.platforms = {
            key: Platform(
                id=key,
                name=name,
                startX=0,
                startY=0,
                endX=grid_size - 1,
                endY=grid_size - 1,
                z=z,
            )
            for key, name, z in (
                ("ground", "Ground floor", 0),
                ("second-floor", "Second floor", 40),
            )
        }
        if state_file is not None:
            try:
                raw = read_state_text(state_file)
                if raw is not None:
                    self.restore_state(json.loads(raw))
            except PermissionError as exc:
                try:
                    list(state_file.parent.iterdir())
                except PermissionError:
                    self.state_file = None
                else:
                    raise PlatformError(
                        "Saved platform geometry cannot be read."
                    ) from exc
            except (OSError, ValueError, TypeError) as exc:
                raise PlatformError(
                    "Saved platform geometry is unreadable. Repair it before starting the world."
                ) from exc

    @property
    def elevations(self) -> frozenset[int]:
        """Return elevations with at least one standing surface."""
        return frozenset(platform.z for platform in self.platforms.values())

    def contains(self, x: int, y: int, z: int) -> bool:
        """Return whether a standing cell exists at these coordinates."""
        return self.platform_at(x, y, z) is not None

    def platform_at(self, x: int, y: int, z: int) -> Platform | None:
        """Return the authored platform at one world cell."""
        for platform in self.platforms.values():
            if (
                platform.z == z
                and platform.startX <= x <= platform.endX
                and platform.startY <= y <= platform.endY
            ):
                return platform
        return None

    def valid_step(self, x: int, y: int, z: int, target_x: int, target_y: int) -> bool:
        """Require supported destinations and both cells around diagonal corners."""
        if max(abs(target_x - x), abs(target_y - y)) > 1 or not self.contains(
            target_x, target_y, z
        ):
            return False
        if x != target_x and y != target_y:
            return self.contains(x, target_y, z) and self.contains(target_x, y, z)
        return True

    def covers_rectangle(
        self, start_x: int, start_y: int, end_x: int, end_y: int, z: int
    ) -> bool:
        """Check full support by union of rectangles without enumerating cells."""
        if start_x > end_x or start_y > end_y:
            return False
        rectangles = [
            p
            for p in self.platforms.values()
            if p.z == z
            and p.endX >= start_x
            and p.startX <= end_x
            and p.endY >= start_y
            and p.startY <= end_y
        ]
        boundaries = sorted(
            {
                start_x,
                end_x + 1,
                *(max(start_x, p.startX) for p in rectangles),
                *(min(end_x + 1, p.endX + 1) for p in rectangles),
            }
        )
        for left, right in zip(boundaries, boundaries[1:]):
            cursor = start_y
            intervals = sorted(
                (max(start_y, p.startY), min(end_y, p.endY))
                for p in rectangles
                if p.startX <= left and p.endX >= right - 1
            )
            for low, high in intervals:
                if low > cursor:
                    break
                cursor = max(cursor, high + 1)
            if cursor <= end_y:
                return False
        return True

    def spawn(self) -> tuple[int, int, int]:
        """Prefer the origin, then the minimum corner of the first saved platform."""
        if self.contains(0, 0, 0):
            return 0, 0, 0
        platform = next(iter(self.platforms.values()))
        return platform.startX, platform.startY, platform.z

    def find_placement(
        self, width: int, depth: int, z: int, preferred_xy: tuple[int, int]
    ) -> tuple[int, int] | None:
        """Find full support near a requested anchor using rectangle boundaries."""
        platforms = [p for p in self.platforms.values() if p.z == z]
        if self.covers_rectangle(
            preferred_xy[0],
            preferred_xy[1],
            preferred_xy[0] + width - 1,
            preferred_xy[1] + depth - 1,
            z,
        ):
            return preferred_xy
        for platform in platforms:
            if (
                platform.endX - platform.startX + 1 >= width
                and platform.endY - platform.startY + 1 >= depth
            ):
                return platform.startX, platform.startY
        boundaries = sorted(
            {*(p.startX for p in platforms), *(p.endX + 1 for p in platforms)}
        )
        bands: list[list[tuple[int, int]]] = []
        for left in boundaries[:-1]:
            merged: list[tuple[int, int]] = []
            for low, high in sorted(
                (p.startY, p.endY) for p in platforms if p.startX <= left <= p.endX
            ):
                if merged and low <= merged[-1][1] + 1:
                    merged[-1] = (merged[-1][0], max(high, merged[-1][1]))
                else:
                    merged.append((low, high))
            bands.append(merged)
        xs = sorted(
            {*(p.startX for p in platforms), *(p.endX - width + 1 for p in platforms)}
        )
        for x in xs:
            if not boundaries or x < boundaries[0] or x + width > boundaries[-1]:
                continue
            first = bisect_right(boundaries, x) - 1
            last = bisect_right(boundaries, x + width - 1) - 1
            intervals = bands[first]
            for index in range(first + 1, last + 1):
                intervals = self._intersect_intervals(intervals, bands[index])
                if not intervals:
                    break
            for low, high in intervals:
                if high - low + 1 >= depth:
                    return x, low
        return None

    @staticmethod
    def _intersect_intervals(
        left: list[tuple[int, int]], right: list[tuple[int, int]]
    ) -> list[tuple[int, int]]:
        result = []
        first = second = 0
        while first < len(left) and second < len(right):
            low, high = (
                max(left[first][0], right[second][0]),
                min(left[first][1], right[second][1]),
            )
            if low <= high:
                result.append((low, high))
            if left[first][1] < right[second][1]:
                first += 1
            else:
                second += 1
        return result

    def mutate(
        self,
        platform_id: str | None,
        values: dict,
        *,
        delete: bool = False,
        validate_world: Callable[[PlatformService], None] | None = None,
    ) -> Platform:
        """Validate a proposed complete geometry before changing live state."""
        current = self.platforms.get(platform_id or "")
        if platform_id is not None and current is None:
            raise PlatformError("Platform not found.")
        if current is None and len(self.platforms) >= MAX_PLATFORMS:
            raise PlatformError("The world has reached its platform limit.")
        if not delete and not values:
            raise PlatformError("No platform property was supplied.")
        data = current.model_dump() if current else {"id": str(uuid.uuid4())}
        data.update(values)
        if "name" in data:
            data["name"] = data["name"].strip()
        if all(key in data for key in ("startX", "endX", "startY", "endY")):
            data["startX"], data["endX"] = sorted((data["startX"], data["endX"]))
            data["startY"], data["endY"] = sorted((data["startY"], data["endY"]))
        candidate = current if delete else Platform.model_validate(data)
        if candidate is None:
            raise PlatformError("Platform not found.")
        proposed = self.dump_state()
        if delete:
            proposed = [entry for entry in proposed if entry["id"] != candidate.id]
        elif current is None:
            proposed.append(candidate.model_dump())
        else:
            proposed = [
                candidate.model_dump() if entry["id"] == candidate.id else entry
                for entry in proposed
            ]
        staged = PlatformService(state_file=None, grid_size=self.grid_size)
        staged.restore_state(proposed)
        removes_support = delete or (
            current is not None
            and (
                candidate.z != current.z
                or candidate.startX > current.startX
                or candidate.startY > current.startY
                or candidate.endX < current.endX
                or candidate.endY < current.endY
            )
        )
        if validate_world is not None and removes_support:
            validate_world(staged)
        self.platforms = staged.platforms
        return candidate

    def dump_state(self) -> list[dict]:
        """Encode the shared live and checkpoint dataset."""
        return [platform.model_dump() for platform in self.platforms.values()]

    def restore_state(self, raw: object) -> None:
        """Validate all IDs, bounds and overlaps before replacing geometry."""
        if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_PLATFORMS:
            raise PlatformError("A world needs between 1 and 1000 platforms.")
        loaded: dict[str, Platform] = {}
        for entry in raw:
            platform = Platform.model_validate(entry)
            if platform.startX > platform.endX or platform.startY > platform.endY:
                raise PlatformError("Platform corners must describe a positive area.")
            if platform.id in loaded:
                raise PlatformError("Duplicate platform identity.")
            for other in loaded.values():
                if (
                    platform.z == other.z
                    and platform.startX <= other.endX
                    and platform.endX >= other.startX
                    and platform.startY <= other.endY
                    and platform.endY >= other.startY
                ):
                    raise PlatformError(f"Platform overlaps {other.name}.")
            loaded[platform.id] = platform
        self.platforms = loaded

    def save_state(self) -> None:
        """Persist validated authored geometry atomically."""
        if self.state_file is not None:
            write_json_atomic(self.state_file, self.dump_state())
