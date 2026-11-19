"""Named places preserve bounds, permissions and durable state."""

import json
from pathlib import Path

import pytest

from app.models import RegionActionResultPacket, RegionUpsertPacket
from app.region_service import RegionError, RegionService


def test_regions_overlap_and_survive_restart(world, tmp_path: Path) -> None:
    service = RegionService(state_file=tmp_path / "regions.json", grid_size=5)
    builder = world.join("builder", x=1, y=1)
    closet = service.add_region(builder)
    studio = service.add_region(builder)
    service.update_region(closet.id, name="Closet")
    service.update_region(studio.id, name="Studio")
    service.resize_region(studio.id, edge="east", delta=1)
    service.resize_region(studio.id, edge="north", delta=1)
    service.save_state()

    loaded = RegionService(state_file=service.state_file, grid_size=5)
    assert loaded.regions == service.regions
    assert loaded.regions[closet.id].startX == 1
    before = loaded.regions[studio.id]
    with pytest.raises(RegionError, match="positive area"):
        loaded.resize_region(closet.id, edge="west", delta=1)
    with pytest.raises(RegionError):
        loaded.slide_region(studio.id, axis="x", delta=-1)
        loaded.slide_region(studio.id, axis="x", delta=-1)
    # First slide was valid. A rejected second step preserves that state.
    assert loaded.regions[studio.id].endX == before.endX - 1
    with pytest.raises(RegionError):
        loaded.update_region(studio.id, name="  ")


def test_unreadable_regions_are_preserved(tmp_path: Path) -> None:
    path = tmp_path / "regions.json"
    path.write_text('[{"id":"broken"}]')
    service = RegionService(state_file=path, grid_size=5)
    service.save_state()
    assert json.loads(path.read_text()) == []
    assert len(list(tmp_path.glob("regions.json.unreadable-*"))) == 1


@pytest.mark.asyncio
async def test_region_packets_enforce_permission_and_broadcast(world) -> None:
    outsider = world.join("outsider", permissions=set())
    await world.server._handle_message(outsider, json.dumps({"type": "region_add"}))
    assert world.server.region_service.regions == {}
    assert any(
        isinstance(packet, RegionActionResultPacket) and not packet.ok
        for _, packet in world.transport.all_deliveries()
    )
    builder = world.join("builder")
    await world.server._handle_message(builder, json.dumps({"type": "region_add"}))
    region = next(iter(world.server.region_service.regions.values()))
    assert any(
        isinstance(packet, RegionUpsertPacket)
        for _, packet in world.transport.all_deliveries()
    )
    await world.server._handle_message(
        builder,
        json.dumps({"type": "region_update", "regionId": region.id, "name": "Studio"}),
    )
    assert world.server.region_service.regions[region.id].name == "Studio"
    await world.server._handle_message(
        builder, json.dumps({"type": "region_delete", "regionId": region.id})
    )
    assert world.server.region_service.regions == {}
