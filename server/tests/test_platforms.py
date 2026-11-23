"""Platform union geometry, persistence, and dependent world validation."""

import json

import pytest

from app.platform_service import PlatformError, PlatformService
from app.models import PlatformActionResultPacket


def rectangle(identifier, x1, y1, x2, y2, z=0):
    return dict(
        id=identifier, name=identifier, startX=x1, startY=y1, endX=x2, endY=y2, z=z
    )


def test_connected_bridge_island_and_diagonal_corner():
    geometry = PlatformService(state_file=None)
    geometry.restore_state(
        [
            rectangle("room", -3, -3, 0, 0),
            rectangle("bridge", 1, 0, 4, 0),
            rectangle("island", 5, 1, 6, 2),
            rectangle("upper", -3, -3, 0, 0, 40),
        ]
    )
    assert geometry.valid_step(0, 0, 0, 1, 0)
    assert not geometry.valid_step(4, 0, 0, 5, 1)
    assert not geometry.contains(4, 0, 40)
    assert geometry.covers_rectangle(-3, 0, 4, 0, 0)
    assert not geometry.covers_rectangle(-3, -1, 4, 0, 0)
    assert geometry.find_placement(8, 1, 0, (0, 0)) == (-3, 0)


def test_overlap_and_failed_mutation_preserve_original():
    geometry = PlatformService(state_file=None)
    before = geometry.dump_state()
    with pytest.raises(PlatformError, match="overlaps"):
        geometry.mutate(None, rectangle("overlap", 40, 40, 45, 45))
    assert geometry.dump_state() == before
    added = geometry.mutate(
        None, dict(name="Bridge", startX=45, endX=41, startY=-1, endY=-1, z=0)
    )
    assert (added.startX, added.endX) == (41, 45)
    with pytest.raises(PlatformError, match="support"):
        geometry.mutate(
            added.id,
            {},
            delete=True,
            validate_world=lambda _geometry: (_ for _ in ()).throw(
                PlatformError("support")
            ),
        )
    assert added.id in geometry.platforms
    renamed = geometry.mutate(
        added.id,
        {"name": "Renamed bridge"},
        validate_world=lambda _geometry: (_ for _ in ()).throw(
            PlatformError("support")
        ),
    )
    assert renamed.name == "Renamed bridge"


def test_restart_keeps_authored_platforms_and_deleted_defaults(tmp_path):
    path = tmp_path / "platforms.json"
    geometry = PlatformService(state_file=path)
    geometry.restore_state([rectangle("island", -10, 100, 2, 105, -40)])
    geometry.save_state()
    restarted = PlatformService(state_file=path)
    assert restarted.dump_state() == geometry.dump_state()
    assert not restarted.contains(0, 0, 0)
    assert restarted.spawn() == (-10, 100, -40)
    assert json.loads(path.read_text())[0]["id"] == "island"


def test_extreme_rectangles_are_checked_without_expanding_cells():
    geometry = PlatformService(state_file=None)
    geometry.restore_state([rectangle("large", -1000000, -1000000, 1000000, 1000000)])
    assert geometry.covers_rectangle(-999999, -999999, 999999, 999999, 0)


def test_corrupt_geometry_cannot_reinterpret_other_saved_world_files(
    make_world, tmp_path
):
    path = tmp_path / "platforms.json"
    path.write_text("[{truncated")
    structures = tmp_path / "structures.json"
    structures.write_text("important authored geometry")
    with pytest.raises(PlatformError, match="unreadable"):
        make_world(state_file=tmp_path / "items.json")
    assert structures.read_text() == "important authored geometry"
    assert path.read_text() == "[{truncated"
    assert not list(tmp_path.glob("*.unreadable-*"))


@pytest.mark.asyncio
async def test_platform_packets_validate_permissions_dependencies_and_request_identity(
    world,
):
    builder = world.join("Builder", x=4, y=4)
    denied = world.join("Guest", permissions=set())
    fields = dict(name="Bridge", startX=41, startY=4, endX=45, endY=4, z=0)
    await world.server._handle_message(
        denied, json.dumps(dict(type="platform_add", requestId="denied", **fields))
    )
    result = world.transport.last_packet_of_type(denied, PlatformActionResultPacket)
    assert not result.ok and result.requestId == "denied"
    await world.server._handle_message(
        builder, json.dumps(dict(type="platform_add", requestId="added", **fields))
    )
    result = world.transport.last_packet_of_type(builder, PlatformActionResultPacket)
    assert result.ok and result.requestId == "added"
    item = world.server.item_service.default_item(builder, "widget")
    item.x, item.y = 43, 4
    world.server.item_service.add_item(item)
    await world.server._handle_message(
        builder,
        json.dumps(
            dict(
                type="platform_delete", platformId=result.platformId, requestId="delete"
            )
        ),
    )
    rejected = world.transport.last_packet_of_type(builder, PlatformActionResultPacket)
    assert not rejected.ok and "support" in rejected.message
    assert result.platformId in world.server.platform_service.platforms


def test_legacy_checkpoint_upgrade_and_new_generation_missing_platforms_fail_closed(
    tmp_path,
):
    from .test_world_checkpoints import create_store
    from app.world_state import WorldStateStore, CheckpointError

    path = tmp_path / "items.json"
    legacy, *_ = create_store(path)
    checkpoint = legacy.capture("Old two floors", "owner")
    preview = legacy.preview(checkpoint["id"])
    legacy.restore(checkpoint["id"], preview["worldRevision"], "owner")

    from app.item_service import ItemService
    from app.structure_service import StructureService
    from app.ambiance_service import AmbianceService
    from app.region_service import RegionService

    upgraded = WorldStateStore(path)
    selected = upgraded.active_state_file()
    geometry = PlatformService(
        state_file=selected.with_name("platforms.json"), grid_size=50
    )
    upgraded.bind_services(
        ItemService(selected, geometry=geometry),
        StructureService(
            state_file=selected.with_name("structures.json"),
            grid_size=50,
            presets={},
            geometry=geometry,
        ),
        AmbianceService(
            state_file=selected.with_name("ambiances.json"),
            grid_size=50,
            geometry=geometry,
        ),
        RegionService(
            state_file=selected.with_name("regions.json"),
            grid_size=50,
            geometry=geometry,
        ),
        geometry,
    )
    assert geometry.contains(49, 49, 40)
    old_preview = upgraded.preview(checkpoint["id"])
    assert old_preview["changes"]["platforms"]["added"] == 0
    upgraded.restore(checkpoint["id"], old_preview["worldRevision"], "owner")
    active = upgraded.active_state_file()
    assert WorldStateStore(path).active_state_file() == active
    active.with_name("platforms.json").unlink()
    with pytest.raises(CheckpointError, match="platform dataset"):
        WorldStateStore(path)
