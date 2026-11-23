"""Durable checkpoint transactions share all registered world datasets."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.ambiance_service import AmbianceService
from app.item_service import ItemService
from app.models import AmbianceRegion, NamedRegion, WallDoor, WallStructure
from app.region_service import RegionService
from app.structure_service import StructureService
from app.world_state import CheckpointError, WorldDataset, WorldStateStore
import app.world_state as storage


def create_store(path: Path):
    """Construct the same services against the selected durable generation."""

    store = WorldStateStore(path)
    selected = store.active_state_file()
    assert selected is not None
    items = ItemService(selected)
    structures = StructureService(
        state_file=selected.with_name("structures.json"), grid_size=50, presets={}
    )
    ambiances = AmbianceService(
        state_file=selected.with_name("ambiances.json"), grid_size=50
    )
    regions = RegionService(state_file=selected.with_name("regions.json"), grid_size=50)
    store.bind_services(items, structures, ambiances, regions)
    return store, items, structures, ambiances, regions


def test_checkpoint_restores_all_authored_datasets_and_generation_survives_restart(
    tmp_path, world
):
    """Restore one generation including a carried piano, song, door, and region."""

    path = tmp_path / "items.json"
    store, items, structures, ambiances, regions = create_store(path)
    client = world.connect("builder", x=4, y=5)
    piano = items.default_item(client, "piano")
    piano.carrierId = "builder"
    piano.params["songId"] = "item:recording"
    items.items[piano.id] = piano
    items.piano_songs["item:recording"] = {"notes": []}
    wall = WallStructure(
        id="wall",
        floorZ=0,
        orientation="horizontal",
        startX=4,
        startY=5,
        length=2,
        title="Studio",
        movementBlocked=True,
        soundTransmission=0.2,
        occlusionLowpassHz=900,
        height=40,
        preset="brick",
        doors=[
            WallDoor(
                id="door", offset=0, hasPin=True, unlockMode="keypad", isLocked=True
            )
        ],
    )
    structures.restore_state(
        [{**wall.model_dump(), "doorPins": {"door": "$argon2id$private-verifier"}}]
    )
    regions.regions["region"] = NamedRegion(
        id="region", name="Studio", floorZ=0, startX=1, startY=1, endX=8, endY=8
    )
    ambiances.ambiances["amb"] = AmbianceRegion(
        id="amb",
        name="Waves",
        soundId="missing",
        floorZ=0,
        startX=1,
        startY=1,
        endX=8,
        endY=8,
    )
    checkpoint = store.capture("Before remodeling", "builder")
    assert checkpoint["counts"] == {
        "items": 1,
        "structures": 1,
        "ambiances": 1,
        "regions": 1,
        "piano_songs": 1,
    }
    assert "private-verifier" not in json.dumps(checkpoint)
    items.items.clear()
    items.piano_songs.clear()
    structures.restore_state([])
    regions.regions.clear()
    ambiances.ambiances.clear()
    preview = store.preview(checkpoint["id"])
    assert preview["changes"]["items"]["added"] == 1
    assert preview["warnings"] == ["Missing ambiance sound: missing."]
    result = store.restore(checkpoint["id"], preview["worldRevision"], "builder")
    assert result["backup"]["label"] == "Before restore"
    assert items.items[piano.id].carrierId is None
    assert structures.door_pins["door"] == "$argon2id$private-verifier"
    assert regions.regions["region"].name == "Studio"
    assert items.piano_songs == {"item:recording": {"notes": []}}
    items.items[piano.id].title = "Restored piano"
    store.save()
    reloaded, loaded_items, loaded_walls, _, loaded_regions = create_store(path)
    assert loaded_items.items[piano.id].title == "Restored piano"
    assert loaded_walls.structures["wall"].doors[0].isLocked
    assert loaded_regions.regions["region"].name == "Studio"
    assert reloaded.active_state_file() != path


def test_stale_preview_and_corrupt_checkpoint_preserve_live_world(tmp_path):
    """A stale or corrupt candidate cannot publish a generation."""

    store, _, _, _, regions = create_store(tmp_path / "items.json")
    checkpoint = store.capture("Empty", "builder")
    preview = store.preview(checkpoint["id"])
    regions.regions["new"] = NamedRegion(
        id="new", name="New", floorZ=0, startX=1, startY=1, endX=2, endY=2
    )
    with pytest.raises(CheckpointError, match="world changed"):
        store.restore(checkpoint["id"], preview["worldRevision"], "builder")
    assert len(regions.regions) == 1
    assert store.root is not None
    (store.root / checkpoint["id"] / "regions.json").write_text("[] ", encoding="utf-8")
    (store.root / checkpoint["id"] / "regions.json").write_text(
        '[{"id":"bad"}]', encoding="utf-8"
    )
    with pytest.raises(CheckpointError):
        store.preview(checkpoint["id"])
    assert store.list_checkpoints()["checkpoints"] == []


@pytest.mark.parametrize("failure", ["dataset", "manifest", "pointer"])
def test_restore_write_failure_keeps_previous_live_generation(
    tmp_path, monkeypatch, failure
):
    """Failure before publication leaves memory and restart on the prior generation."""

    path = tmp_path / "items.json"
    store, _, _, _, regions = create_store(path)
    checkpoint = store.capture("Empty", "builder")
    regions.regions["new"] = NamedRegion(
        id="new", name="New", floorZ=0, startX=1, startY=1, endX=2, endY=2
    )
    store.save()
    preview = store.preview(checkpoint["id"])
    write = storage.write_json_atomic

    def fail(path, payload):
        generation_file = "world-generations" in str(path)
        if generation_file and (
            (failure == "dataset" and path.name == "items.json")
            or (failure == "manifest" and path.name == "manifest.json")
            or (failure == "pointer" and path.name == "current.json")
        ):
            raise OSError("Disk full")
        write(path, payload)

    monkeypatch.setattr(storage, "write_json_atomic", fail)
    with pytest.raises(OSError, match="Disk full"):
        store.restore(checkpoint["id"], preview["worldRevision"], "builder")
    assert len(regions.regions) == 1
    assert store.generations is not None
    assert not list(store.generations.glob(".*.tmp"))
    _, _, _, _, reloaded_regions = create_store(path)
    assert len(reloaded_regions.regions) == 1


def test_new_dataset_registration_automatically_participates_in_checkpoint_and_restore(
    tmp_path,
):
    """A live dataset registration is the only required checkpoint membership hook."""

    store, *_ = create_store(tmp_path / "items.json")
    extra = {"authored": {"color": "blue"}}
    paths = []
    store.register(
        WorldDataset(
            "future",
            "future.json",
            lambda: dict(extra),
            lambda value: value,
            lambda value: (extra.clear(), extra.update(value)),
            paths.append,
            lambda: True,
        )
    )
    checkpoint = store.capture("Future", "builder")
    extra["authored"] = {"color": "red"}
    preview = store.preview(checkpoint["id"])
    assert preview["changes"]["future"]["modified"] == 1
    store.restore(checkpoint["id"], preview["worldRevision"], "builder")
    assert extra == {"authored": {"color": "blue"}}
    assert paths[-1].name == "future.json"


def test_checkpoint_listing_ignores_unpublished_capture_and_rejects_configuration_mismatch(
    tmp_path, monkeypatch
):
    """Incomplete directories remain invisible and changed grid config is rejected."""

    store, *_ = create_store(tmp_path / "items.json")
    checkpoint = store.capture("Valid", "builder")
    assert store.root is not None
    (store.root / ".unfinished.tmp").mkdir()
    assert store.list_checkpoints()["total"] == 1
    store.world_config = {"gridSize": 100, "floors": [0, 40]}
    with pytest.raises(CheckpointError):
        store.preview(checkpoint["id"])


def test_generation_missing_a_dataset_fails_closed_on_startup(tmp_path):
    """A selected generation cannot silently start as an incomplete world."""

    path = tmp_path / "items.json"
    store, *_ = create_store(path)
    checkpoint = store.capture("Valid", "builder")
    store.restore(
        checkpoint["id"], store.preview(checkpoint["id"])["worldRevision"], "builder"
    )
    assert store.active_directory is not None
    (store.active_directory / "regions.json").unlink()
    with pytest.raises(CheckpointError, match="incomplete"):
        create_store(path)


def test_listing_reuses_validated_immutable_checkpoints_until_files_change(
    tmp_path, monkeypatch
):
    """Repeated browsing does not rehash the entire checkpoint history."""

    store, *_ = create_store(tmp_path / "items.json")
    checkpoint = store.capture("First", "builder")
    calls = []
    read = store._read

    def track(identifier):
        calls.append(identifier)
        return read(identifier)

    monkeypatch.setattr(store, "_read", track)
    assert store.list_checkpoints()["total"] == 1
    assert store.list_checkpoints()["total"] == 1
    assert calls == [checkpoint["id"]]


def test_capture_failure_leaves_no_staging_directories(tmp_path, monkeypatch):
    """A failed checkpoint write does not accumulate hidden staging directories."""

    store, *_ = create_store(tmp_path / "items.json")

    def fail(path, payload):
        raise OSError("Disk full")

    monkeypatch.setattr(storage, "write_json_atomic", fail)
    with pytest.raises(OSError):
        store.capture("Failed", "builder")
    assert store.root is not None
    assert list(store.root.iterdir()) == []


@pytest.mark.parametrize("manifest", [None, [], "invalid", 42])
def test_malformed_manifest_is_rejected_by_preview_and_listing(tmp_path, manifest):
    """Every malformed manifest shape yields a controlled checkpoint error."""

    store, *_ = create_store(tmp_path / "items.json")
    checkpoint = store.capture("Valid", "builder")
    assert store.root is not None
    (store.root / checkpoint["id"] / "manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    with pytest.raises(CheckpointError):
        store.preview(checkpoint["id"])
    assert store.list_checkpoints()["checkpoints"] == []


def test_unreadable_selector_in_readable_directory_fails_closed(tmp_path, monkeypatch):
    """An inaccessible selector cannot silently select the legacy world."""

    read = Path.read_text

    def denied(path, *args, **kwargs):
        if path.name == "current.json":
            raise PermissionError("Denied")
        return read(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", denied)
    with pytest.raises(CheckpointError, match="unreadable"):
        WorldStateStore(tmp_path / "items.json")


@pytest.mark.parametrize("retry_succeeds", [True, False])
def test_pointer_sync_failure_after_replace_applies_selected_complete_world(
    tmp_path, monkeypatch, retry_succeeds
):
    """A late fsync failure cannot leave running memory on the prior generation."""

    path = tmp_path / "items.json"
    store, _, _, _, regions = create_store(path)
    checkpoint = store.capture("Empty", "builder")
    regions.regions["new"] = NamedRegion(
        id="new", name="New", floorZ=0, startX=1, startY=1, endX=2, endY=2
    )
    store.save()
    preview = store.preview(checkpoint["id"])
    write = storage.write_json_atomic

    def fail_after_replace(path, payload):
        write(path, payload)
        if path.name == "current.json":
            if not retry_succeeds:

                def failed_retry(directory):
                    raise OSError("Storage is still unavailable")

                monkeypatch.setattr(storage, "_sync_directory", failed_retry)
            raise OSError("Directory sync failed after replace")

    monkeypatch.setattr(storage, "write_json_atomic", fail_after_replace)
    result = store.restore(checkpoint["id"], preview["worldRevision"], "builder")
    assert result["durable"] is retry_succeeds
    assert regions.regions == {}
    assert create_store(path)[4].regions == {}


def test_ambiguous_generation_selector_stops_server_instead_of_resuming_mutations(
    tmp_path, monkeypatch
):
    """An unreadable pointer after a failed commit forces a process restart."""

    store, *_ = create_store(tmp_path / "items.json")
    checkpoint = store.capture("Empty", "builder")
    preview = store.preview(checkpoint["id"])
    write = storage.write_json_atomic
    read = Path.read_text

    def fail(path, payload):
        if path.name == "current.json":
            raise OSError("Commit interrupted")
        write(path, payload)

    def deny(path, *args, **kwargs):
        if path.name == "current.json":
            raise PermissionError("Selector unreadable")
        return read(path, *args, **kwargs)

    monkeypatch.setattr(storage, "write_json_atomic", fail)
    monkeypatch.setattr(Path, "read_text", deny)
    with pytest.raises(SystemExit, match="ambiguous"):
        store.restore(checkpoint["id"], preview["worldRevision"], "builder")
