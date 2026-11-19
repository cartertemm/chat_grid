"""Server-authoritative named region geometry and persistence."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import json
import logging
from pathlib import Path
import uuid

from pydantic import ValidationError

from .client import ClientConnection
from .models import NamedRegion
from .state_files import read_state_text, set_aside_unreadable, write_json_atomic

LOGGER = logging.getLogger("chgrid.server.regions")

DEFAULT_FLOOR_ELEVATIONS = (0, 40)


class RegionError(ValueError):
    """Describe a rejected named-region mutation or saved dataset."""


class RegionService:
    """Own named rectangles, validation and durable world persistence."""

    def __init__(
        self,
        *,
        state_file: Path | None,
        grid_size: int,
        floor_elevations: Iterable[int] = DEFAULT_FLOOR_ELEVATIONS,
    ) -> None:
        """Load named regions from the configured world dataset."""

        self.state_file = state_file
        self.grid_size = max(1, int(grid_size))
        self.floor_elevations = frozenset(int(value) for value in floor_elevations)
        self.regions: dict[str, NamedRegion] = {}
        self.load_state()

    def add_region(self, client: ClientConnection) -> NamedRegion:
        """Create a one-cell region at the caller's position and floor."""

        if client.z not in self.floor_elevations:
            raise RegionError("Regions can only be added on a valid floor.")
        region = NamedRegion(
            id=str(uuid.uuid4()),
            name="Region",
            floorZ=client.z,
            startX=client.x,
            startY=client.y,
            endX=client.x,
            endY=client.y,
        )
        self._validate_region(region)
        self.regions[region.id] = region
        return region

    def update_region(
        self,
        region_id: str,
        *,
        name: str | None = None,
    ) -> NamedRegion:
        """Replace supplied editable properties while preserving all geometry."""

        current = self._get(region_id)
        if name is None:
            raise RegionError("No region property was supplied.")
        values = current.model_dump()
        if name is not None:
            values["name"] = name.strip()
        updated = self._validated_replacement(values)
        self.regions[updated.id] = updated
        return updated

    def resize_region(
        self,
        region_id: str,
        *,
        edge: str,
        delta: int,
    ) -> NamedRegion:
        """Move one rectangle edge by one cell and validate the result."""

        current = self._get(region_id)
        if edge not in {"west", "east", "south", "north"}:
            raise RegionError("Unknown region edge.")
        if delta not in {-1, 1}:
            raise RegionError("Region resize delta must be -1 or 1.")
        values = current.model_dump()
        coordinate = {
            "west": "startX",
            "east": "endX",
            "south": "startY",
            "north": "endY",
        }[edge]
        values[coordinate] += delta
        resized = self._validated_replacement(values)
        self.regions[resized.id] = resized
        return resized

    def slide_region(
        self,
        region_id: str,
        *,
        axis: str,
        delta: int,
    ) -> NamedRegion:
        """Translate a complete rectangle by one cell along one axis."""

        current = self._get(region_id)
        if axis not in {"x", "y"}:
            raise RegionError("Unknown region slide axis.")
        if delta not in {-1, 1}:
            raise RegionError("Region slide delta must be -1 or 1.")
        values = current.model_dump()
        start_coordinate = "startX" if axis == "x" else "startY"
        end_coordinate = "endX" if axis == "x" else "endY"
        values[start_coordinate] += delta
        values[end_coordinate] += delta
        moved = self._validated_replacement(values)
        self.regions[moved.id] = moved
        return moved

    def remove(self, region_id: str) -> NamedRegion:
        """Remove and return one complete region region."""

        region = self._get(region_id)
        del self.regions[region_id]
        return region

    def save_state(self) -> None:
        """Atomically persist all regions to the configured state file."""

        if self.state_file is None:
            return
        try:
            payload = [
                region.model_dump(mode="json") for region in self.regions.values()
            ]
            write_json_atomic(self.state_file, payload)
        except Exception as exc:
            LOGGER.warning("failed to persist regions to %s: %s", self.state_file, exc)

    def load_state(self) -> None:
        """Load a complete valid region list or preserve its unreadable source."""

        if self.state_file is None:
            return
        try:
            text = read_state_text(self.state_file)
            if text is None:
                return
            raw = json.loads(text)
            if not isinstance(raw, list):
                raise RegionError("Region state must be a list.")
            loaded: dict[str, NamedRegion] = {}
            for entry in raw:
                region = NamedRegion.model_validate(entry)
                self._validate_region(region)
                if region.id in loaded:
                    raise RegionError(f"Duplicate region id: {region.id}")
                loaded[region.id] = region
            self.regions = loaded
            LOGGER.info("loaded %d regions from %s", len(loaded), self.state_file)
        except Exception as exc:
            if not set_aside_unreadable(self.state_file, exc):
                self.state_file = None

    def _get(self, region_id: str) -> NamedRegion:
        """Return one region or raise a mutation-friendly error."""

        region = self.regions.get(region_id)
        if region is None:
            raise RegionError("Region not found.")
        return region

    def _validated_replacement(
        self,
        values: Mapping[str, object],
    ) -> NamedRegion:
        """Validate a candidate before replacing the current map entry."""

        try:
            candidate = NamedRegion.model_validate(values)
        except ValidationError as exc:
            raise RegionError(self._validation_message(exc)) from exc
        self._validate_region(candidate)
        return candidate

    def _validate_region(
        self,
        region: NamedRegion,
    ) -> None:
        """Validate inclusive bounds and floor membership."""

        if region.startX > region.endX or region.startY > region.endY:
            raise RegionError("Region must have a positive area.")
        if not (
            0 <= region.startX < self.grid_size
            and 0 <= region.endX < self.grid_size
            and 0 <= region.startY < self.grid_size
            and 0 <= region.endY < self.grid_size
        ):
            raise RegionError("Region would extend outside the world.")
        if region.floorZ not in self.floor_elevations:
            raise RegionError("Regions can only be added on a valid floor.")

    @staticmethod
    def _validation_message(exc: ValidationError) -> str:
        """Extract a compact user-facing message from model validation errors."""

        errors = exc.errors()
        if not errors:
            return "Invalid region."
        message = errors[0].get("msg")
        return str(message) if message else "Invalid region."
