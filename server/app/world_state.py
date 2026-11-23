"""Registered authored-world datasets and durable manual checkpoints.

A restore stages every registered dataset in one generation and switches one
atomic pointer. Startup and subsequent live saves follow that pointer.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import suppress
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Protocol, cast
import re
import uuid

from .ambiance_service import AmbianceService
from .item_service import ItemService
from .region_service import RegionService
from .platform_service import PlatformService
from .state_files import _sync_directory, write_json_atomic
from .structure_service import StructureService

LOGGER = logging.getLogger("chgrid.server.checkpoints")
SCHEMA_VERSION = 1
PAGE_SIZE = 25


class CheckpointError(ValueError):
    """Describe an unavailable, invalid, or stale world checkpoint."""


@dataclass(frozen=True)
class WorldDataset:
    """One durable dataset registered once for live saves and checkpoints.

    `normalize` validates without mutating the live world. `apply` must accept
    the resulting normalized value without failure, because it runs after the
    complete generation has been selected durably.
    """

    name: str
    filename: str
    export: Callable[[], object]
    normalize: Callable[[object], object]
    apply: Callable[[object], None]
    set_path: Callable[[Path], None]
    writable: Callable[[], bool]


def _encoded(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode()


def _digest(value: object) -> str:
    return hashlib.sha256(_encoded(value)).hexdigest()


class DurableService(Protocol):
    """Service boundary shared by live storage and checkpoint codecs."""

    state_file: Path | None

    def dump_state(self) -> list[dict]:
        """Encode authored state."""
        ...

    def restore_state(self, raw: object) -> None:
        """Validate and apply authored state."""
        ...


class WorldStateStore:
    """Coordinate a world's shared persistence and immutable checkpoints."""

    def __init__(self, state_file: Path | None) -> None:
        """Resolve the active durable generation before services load files."""

        self.original_state_file = state_file
        self.root = state_file.parent / "world-checkpoints" if state_file else None
        self.generations = (
            state_file.parent / "world-generations" if state_file else None
        )
        self.datasets: dict[str, WorldDataset] = {}
        self._listing_cache: dict[str, tuple[tuple, dict]] = {}
        self.source_grid = ""
        self.world_config: dict = {}
        self.ambiance_sound_ids: set[str] = set()
        self.active_directory = state_file.parent if state_file else None
        self.using_generation = False
        if self.generations:
            pointer_path = self.generations / "current.json"
            try:
                text = pointer_path.read_text(encoding="utf-8")
            except FileNotFoundError:
                if pointer_path.is_symlink():
                    raise CheckpointError("The active generation pointer is broken.")
                return
            except PermissionError as exc:
                try:
                    # Preserve the established startup behavior when the entire
                    # legacy state directory is unavailable. A readable parent
                    # with an inaccessible generation selector must fail closed.
                    list(self.generations.parent.iterdir())
                except PermissionError:
                    self.active_directory = None
                    LOGGER.error(
                        "World state directory is unavailable; persistence is disabled."
                    )
                    return
                raise CheckpointError(
                    "The active generation pointer is unreadable."
                ) from exc
            except OSError as exc:
                raise CheckpointError(
                    "The active generation pointer is unreadable."
                ) from exc
            try:
                pointer = json.loads(text)
                if not isinstance(pointer, dict):
                    raise CheckpointError("The active generation pointer is invalid.")
                generation = self._identifier(pointer.get("generation"))
                directory = self.generations / generation
                if not directory.is_dir():
                    raise CheckpointError("The active world generation is missing.")
            except (OSError, ValueError) as exc:
                raise CheckpointError(
                    "The active generation pointer is invalid."
                ) from exc
            self.active_directory = directory
            self.using_generation = True
            try:
                manifest = json.loads(
                    (directory / "manifest.json").read_text(encoding="utf-8")
                )
                if (
                    "platforms" in manifest.get("checksums", {})
                    and not (directory / "platforms.json").is_file()
                ):
                    raise CheckpointError(
                        "The active world platform dataset is missing."
                    )
            except CheckpointError:
                raise
            except (OSError, ValueError, AttributeError) as exc:
                raise CheckpointError(
                    "The active world manifest is unreadable."
                ) from exc

    @staticmethod
    def _identifier(value: object) -> str:
        if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}", value):
            raise CheckpointError("Invalid checkpoint identifier.")
        return value

    def active_state_file(self) -> Path | None:
        """Return the item path selected by the durable generation pointer."""

        if self.original_state_file is None or self.active_directory is None:
            return None
        return self.active_directory / self.original_state_file.name

    def register(self, dataset: WorldDataset) -> None:
        """Register a dataset for live persistence, capture, and restore."""

        if (
            dataset.name in self.datasets
            or Path(dataset.filename).name != dataset.filename
        ):
            raise ValueError("Dataset name or filename is invalid or duplicated.")
        if any(entry.filename == dataset.filename for entry in self.datasets.values()):
            raise ValueError("Dataset filenames must be unique.")
        self.datasets[dataset.name] = dataset

    def bind_services(
        self,
        items: ItemService,
        structures: StructureService,
        ambiances: AmbianceService,
        regions: RegionService,
        platforms: PlatformService | None = None,
    ) -> None:
        """Register the same codecs used by each service's ordinary persistence."""

        self.ambiance_sound_ids = {entry.id for entry in ambiances.ambiance_types}
        self.world_config = {
            "gridSize": structures.grid_size,
            "floors": sorted(regions.floor_elevations),
        }
        platform_copy = (
            PlatformService(state_file=None, grid_size=structures.grid_size)
            if platforms
            else None
        )
        item_copy = ItemService(geometry=platform_copy)
        structure_copy = StructureService(
            state_file=None,
            grid_size=structures.grid_size,
            presets=structures.presets,
            geometry=platform_copy,
        )
        ambiance_copy = AmbianceService(
            state_file=None,
            grid_size=ambiances.grid_size,
            sounds_dir=ambiances.sounds_dir,
            floor_elevations=ambiances.floor_elevations,
            geometry=platform_copy,
        )
        region_copy = RegionService(
            state_file=None,
            grid_size=regions.grid_size,
            floor_elevations=regions.floor_elevations,
            geometry=platform_copy,
        )
        services: tuple[tuple[str, DurableService, DurableService], ...] = (
            ("items", items, item_copy),
            ("structures", structures, structure_copy),
            ("ambiances", ambiances, ambiance_copy),
            ("regions", regions, region_copy),
        )
        if platforms is not None and platform_copy is not None:
            self._register_service(
                "platforms", "platforms.json", platforms, platform_copy
            )
        for name, service, staged in services:
            filename = (
                self.original_state_file.name
                if name == "items" and self.original_state_file
                else f"{name}.json"
            )
            self._register_service(name, filename, service, staged)

        def songs(value: object) -> object:
            item_copy.restore_piano_songs(value)
            return item_copy.dump_piano_songs()

        self.register(
            WorldDataset(
                "piano_songs",
                "piano_songs.json",
                items.dump_piano_songs,
                songs,
                items.restore_piano_songs,
                lambda path: setattr(items, "piano_songs_file", path),
                lambda: items.piano_songs_file is not None,
            )
        )

        if self.using_generation and self.active_directory is not None:
            manifest = json.loads(
                (self.active_directory / "manifest.json").read_text(encoding="utf-8")
            )
            if (
                not isinstance(manifest, dict)
                or manifest.get("schemaVersion") != SCHEMA_VERSION
                or manifest.get("worldConfig") != self.world_config
            ):
                raise CheckpointError(
                    "The active generation belongs to a different world configuration."
                )
            if (
                platforms is not None
                and not (self.active_directory / "platforms.json").exists()
                and "platforms" not in manifest.get("checksums", {})
            ):
                write_json_atomic(
                    self.active_directory / "platforms.json", platforms.dump_state()
                )
            if any(
                not dataset.writable()
                or not (self.active_directory / dataset.filename).is_file()
                for dataset in self.datasets.values()
            ):
                raise CheckpointError(
                    "The active world generation is incomplete or unreadable."
                )

    def _register_service(
        self, name: str, filename: str, service: DurableService, staged: DurableService
    ) -> None:
        def normalize(value: object) -> object:
            staged.restore_state(value)
            if isinstance(staged, StructureService):
                for wall in staged.structures.values():
                    for door in wall.doors:
                        if door.unlockDeadlineMs is not None:
                            door.unlockDeadlineMs = None
                            door.isLocked = True
            return staged.dump_state()

        def set_path(path: Path) -> None:
            service.state_file = path

        self.register(
            WorldDataset(
                name,
                filename,
                service.dump_state,
                normalize,
                service.restore_state,
                set_path,
                lambda: service.state_file is not None,
            )
        )

    def save(self) -> None:
        """Flush all registered live datasets through their durable codecs."""

        if self.active_directory is None:
            return
        for dataset in self.datasets.values():
            if dataset.writable():
                try:
                    write_json_atomic(
                        self.active_directory / dataset.filename, dataset.export()
                    )
                except Exception:
                    LOGGER.exception("Failed to save world dataset %s", dataset.name)

    def _snapshot(self) -> dict[str, object]:
        return {
            name: deepcopy(dataset.export()) for name, dataset in self.datasets.items()
        }

    def fingerprint(self) -> str:
        """Identify the exact authored state compared by a restore preview."""

        return _digest(self._snapshot())

    def _validate(self, data: dict[str, object]) -> dict[str, object]:
        if set(data) != set(self.datasets):
            raise CheckpointError(
                "Checkpoint datasets do not match this world version."
            )
        try:
            ordered = sorted(data, key=lambda name: name != "platforms")
            normalized = {
                name: self.datasets[name].normalize(data[name]) for name in ordered
            }
            if "platforms" in normalized:
                geometry = PlatformService(state_file=None)
                geometry.restore_state(normalized["platforms"])
                for item in cast(list[dict], normalized.get("items", [])):
                    if item["type"] == "elevator":
                        # ItemService.restore_state validated the shaft against the staged platforms.
                        continue
                    end_x = item.get("endX", item["x"])
                    end_y = item.get("endY", item["y"])
                    if not geometry.covers_rectangle(
                        item["x"], item["y"], end_x, end_y, item["z"]
                    ):
                        raise ValueError("Checkpoint item has no platform support.")
                    if item["type"] == "teleporter":
                        from .items.types.teleporter.validator import parse_destination

                        if not geometry.contains(
                            *parse_destination(
                                item.get("params", {}).get("destination", "0, 0, 0")
                            )
                        ):
                            raise ValueError(
                                "Checkpoint teleporter destination has no platform."
                            )
                for ambiance in cast(list[dict], normalized.get("ambiances", [])):
                    if ambiance["floorZ"] not in geometry.elevations:
                        raise ValueError(
                            "Checkpoint ambiance has no platform elevation."
                        )
            return normalized
        except (ValueError, TypeError, KeyError) as exc:
            raise CheckpointError("Checkpoint contains invalid world data.") from exc

    def _require_root(self) -> Path:
        if self.root is None:
            raise CheckpointError("Checkpoint storage is unavailable for this world.")
        if any(not dataset.writable() for dataset in self.datasets.values()):
            raise CheckpointError(
                "World storage is unreadable. Resolve it before using checkpoints."
            )
        return self.root

    def _publish(
        self, root: Path, identifier: str, data: dict[str, object], manifest: dict
    ) -> Path:
        root.mkdir(parents=True, exist_ok=True)
        _sync_directory(root.parent)
        temporary = root / f".{identifier}.tmp"
        temporary.mkdir(mode=0o700)
        try:
            for name, value in data.items():
                write_json_atomic(temporary / self.datasets[name].filename, value)
            write_json_atomic(temporary / "manifest.json", manifest)
            _sync_directory(temporary)
            target = root / identifier
            os.rename(temporary, target)
            _sync_directory(root)
            return target
        except BaseException:
            # Only generated files exist in this private staging directory.
            with suppress(OSError):
                for child in temporary.iterdir():
                    child.unlink()
                temporary.rmdir()
            raise

    def capture(self, label: str, creator: str) -> dict:
        """Publish a complete immutable checkpoint at the current mutation boundary."""

        label = label.strip()
        if len(label) > 100:
            raise CheckpointError("Checkpoint labels must be 100 characters or less.")
        data = self._validate(self._snapshot())
        identifier = uuid.uuid4().hex
        manifest = {
            "id": identifier,
            "label": label,
            "createdAt": int(datetime.now(UTC).timestamp() * 1000),
            "createdBy": creator,
            "schemaVersion": SCHEMA_VERSION,
            "sourceGrid": self.source_grid,
            "worldConfig": self.world_config,
            "counts": {
                name: len(value) if isinstance(value, (list, dict)) else 1
                for name, value in data.items()
            },
            "checksums": {name: _digest(value) for name, value in data.items()},
        }
        self._publish(self._require_root(), identifier, data, manifest)
        return self._summary(manifest)

    @staticmethod
    def _summary(manifest: dict) -> dict:
        if (
            not isinstance(manifest.get("label"), str)
            or len(manifest["label"]) > 100
            or not isinstance(manifest.get("createdBy"), str)
            or type(manifest.get("createdAt")) is not int
            or not isinstance(manifest.get("counts"), dict)
            or any(
                not isinstance(key, str) or type(value) is not int or value < 0
                for key, value in manifest["counts"].items()
            )
        ):
            raise CheckpointError("Checkpoint metadata is invalid.")
        return {
            key: manifest[key]
            for key in ("id", "label", "createdAt", "createdBy", "counts")
        }

    def _read(self, identifier: str) -> tuple[dict, dict[str, object]]:
        directory = self._require_root() / self._identifier(identifier)
        try:
            manifest = json.loads(
                (directory / "manifest.json").read_text(encoding="utf-8")
            )
            if not isinstance(manifest, dict):
                raise CheckpointError("Checkpoint manifest is invalid.")
            if (
                manifest.get("schemaVersion") != SCHEMA_VERSION
                or manifest.get("id") != identifier
            ):
                raise CheckpointError("Checkpoint manifest is incompatible.")
            if manifest.get("worldConfig") != self.world_config or (
                self.source_grid and manifest.get("sourceGrid") != self.source_grid
            ):
                raise CheckpointError(
                    "Checkpoint belongs to a different world configuration."
                )
            saved_names = set(manifest.get("checksums", {}))
            data = {
                name: json.loads(
                    (directory / dataset.filename).read_text(encoding="utf-8")
                )
                for name, dataset in self.datasets.items()
                if name in saved_names
            }
            if manifest.get("checksums") != {
                name: _digest(value) for name, value in data.items()
            }:
                raise CheckpointError("Checkpoint checksum validation failed.")
            self._summary(manifest)
            if manifest["counts"] != {
                name: len(value) if isinstance(value, (list, dict)) else 1
                for name, value in data.items()
            }:
                raise CheckpointError("Checkpoint counts do not match its datasets.")
            if "platforms" in self.datasets and "platforms" not in data:
                data["platforms"] = PlatformService(
                    state_file=None, grid_size=int(self.world_config["gridSize"])
                ).dump_state()
            return manifest, self._validate(data)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise CheckpointError(
                "Checkpoint is missing, corrupt, or incompatible."
            ) from exc

    def list_checkpoints(self, page: int = 0) -> dict:
        """List complete validated checkpoints newest first in pages of 25."""

        root = self._require_root()
        summaries = []
        for directory in root.iterdir() if root.exists() else []:
            if not re.fullmatch(r"[a-f0-9]{32}", directory.name):
                continue
            try:
                files = [
                    directory / "manifest.json",
                    *(
                        directory / dataset.filename
                        for dataset in self.datasets.values()
                        if (directory / dataset.filename).is_file()
                    ),
                ]
                signature = tuple(
                    (path.stat().st_size, path.stat().st_mtime_ns) for path in files
                )
                cached = self._listing_cache.get(directory.name)
                if cached is not None and cached[0] == signature:
                    summary = cached[1]
                else:
                    manifest, _ = self._read(directory.name)
                    summary = self._summary(manifest)
                    self._listing_cache[directory.name] = (signature, summary)
                summaries.append(summary)
            except (CheckpointError, OSError):
                self._listing_cache.pop(directory.name, None)
                LOGGER.warning("Skipping invalid checkpoint %s", directory.name)
        summaries.sort(
            key=lambda value: (value["createdAt"], value["id"]), reverse=True
        )
        page = max(0, page)
        return {
            "checkpoints": summaries[page * PAGE_SIZE : (page + 1) * PAGE_SIZE],
            "page": page,
            "total": len(summaries),
        }

    def preview(self, identifier: str) -> dict:
        """Compare a checkpoint with the complete current authored world."""

        manifest, candidate = self._read(identifier)
        current = self._validate(self._snapshot())
        changes = {}
        for name in candidate:
            before = self._entries(current[name])
            after = self._entries(candidate[name])
            changes[name] = {
                "added": len(after.keys() - before.keys()),
                "removed": len(before.keys() - after.keys()),
                "modified": sum(
                    before[key] != after[key] for key in before.keys() & after.keys()
                ),
            }
        return {
            "checkpoint": self._summary(manifest),
            "worldRevision": self.fingerprint(),
            "changes": changes,
            "warnings": self._warnings(candidate),
        }

    def _warnings(self, candidate: dict[str, object]) -> list[str]:
        warnings: list[str] = []
        ambiances = candidate.get("ambiances", [])
        if isinstance(ambiances, list):
            missing = sorted(
                {
                    str(entry["soundId"])
                    for entry in ambiances
                    if entry["soundId"] not in self.ambiance_sound_ids
                }
            )
            warnings.extend(
                f"Missing ambiance sound: {sound_id}." for sound_id in missing
            )
        songs = candidate.get("piano_songs", {})
        items = candidate.get("items", [])
        if isinstance(items, list) and isinstance(songs, dict):
            for item in items:
                song_id = str(item.get("params", {}).get("songId", ""))
                if (
                    item.get("type") == "piano"
                    and song_id.startswith("item:")
                    and song_id not in songs
                ):
                    warnings.append(f"Missing recorded song for {item['title']}.")
        return warnings

    @staticmethod
    def _entries(value: object) -> dict:
        if isinstance(value, dict):
            return value
        if isinstance(value, list):
            return {str(entry["id"]): entry for entry in value}
        return {"value": value}

    def restore(self, identifier: str, fingerprint: str, creator: str) -> dict:
        """Back up, validate, and atomically publish one complete world generation."""

        manifest, candidate = self._read(identifier)
        if fingerprint != self.fingerprint():
            raise CheckpointError(
                "The world changed since preview. Preview this checkpoint again."
            )
        backup = self.capture("Before restore", creator)
        if self.generations is None:
            raise CheckpointError("Persistent world storage is unavailable.")
        generation = uuid.uuid4().hex
        generation_manifest = {
            **manifest,
            "counts": {
                name: len(value) if isinstance(value, (list, dict)) else 1
                for name, value in candidate.items()
            },
            "checksums": {name: _digest(value) for name, value in candidate.items()},
        }
        directory = self._publish(
            self.generations, generation, candidate, generation_manifest
        )
        pointer_path = self.generations / "current.json"
        durable = True
        try:
            write_json_atomic(pointer_path, {"generation": generation})
        except OSError as exc:
            # fsync can fail after replacement. Determine which complete
            # generation is selected before any further mutation is allowed.
            try:
                selected = json.loads(pointer_path.read_text(encoding="utf-8"))
                selected_id = self._identifier(selected.get("generation"))
            except FileNotFoundError:
                if not self.using_generation:
                    raise exc
                raise SystemExit(
                    "World generation selection is ambiguous; restart required."
                ) from exc
            except (OSError, ValueError, AttributeError) as read_error:
                raise SystemExit(
                    "World generation selection is ambiguous; restart required."
                ) from read_error
            if selected_id != generation:
                if (
                    self.using_generation
                    and self.active_directory is not None
                    and selected_id == self.active_directory.name
                ):
                    raise
                raise SystemExit(
                    "World generation selection is ambiguous; restart required."
                ) from exc
            LOGGER.error(
                "Generation selector changed but directory sync failed; applying the selected complete generation."
            )
            try:
                _sync_directory(self.generations)
            except OSError:
                durable = False
        self.active_directory = directory
        self.using_generation = True
        for name, dataset in self.datasets.items():
            dataset.set_path(directory / dataset.filename)
            dataset.apply(candidate[name])
        return {
            "checkpoint": self._summary(manifest),
            "backup": backup,
            "durable": durable,
        }
