"""Elevator authored configuration and durable geometry regressions."""

from __future__ import annotations

import json

import pytest

from app.elevator_geometry import parse_stops
from app.item_type_handlers import get_item_type_handler
from app.models import ItemActionResultPacket
from app.platform_service import PlatformService


@pytest.mark.parametrize(
    "raw",
    ["0", "0,0", "0,,40", "0,forty", "0,40.5", "0,1000001", [False, 40], []],
)
def test_stops_reject_malformed_or_unbounded_values(raw):
    with pytest.raises(ValueError):
        parse_stops(raw)


def test_stops_and_speed_use_canonical_server_values(world):
    item = world.server.item_service.default_item(world.join("Owner"), "elevator")
    validator = get_item_type_handler("elevator").validate_update
    updated = validator(item, {**item.params, "floorZs": "40, -20, 0", "speed": 10})
    assert updated["floorZs"] == [-20, 0, 40]
    assert updated["speed"] == 10
    assert "travelSeconds" not in updated
    for speed in (0, -1, float("nan"), float("inf"), True, 1001, 10**400):
        with pytest.raises(ValueError, match="Speed"):
            validator(item, {**item.params, "speed": speed})


def test_landing_finds_nearest_surface_below_same_shaft():
    geometry = PlatformService(state_file=None)
    geometry.mutate(
        None, dict(name="Midway", startX=10, startY=10, endX=15, endY=15, z=25)
    )
    geometry.mutate(
        None, dict(name="Nearby", startX=20, startY=20, endX=25, endY=25, z=30)
    )
    assert geometry.landing_position(10, 10, 35) == (10, 10, 25)
    assert geometry.highest_platform_below(10, 10, 25).z == 0
    assert geometry.landing_position(10, 10, 25) == (10, 10, 25)
    assert geometry.landing_position(100, 100, 100) is None


@pytest.mark.asyncio
async def test_stop_edit_reparks_empty_car_and_requires_boardable_stop(world):
    server = world.server
    owner = world.join("Owner", x=10, y=10)
    item = server.item_service.default_item(owner, "elevator")
    server.item_service.add_item(item)
    server.platform_service.mutate(
        None, dict(name="Studio", startX=10, startY=10, endX=15, endY=15, z=20)
    )
    await server._handle_message(
        owner,
        json.dumps(
            dict(
                type="item_update",
                itemId=item.id,
                params={"floorZs": "20,60", "speed": 12},
            )
        ),
    )
    assert world.transport.last_packet_of_type(owner, ItemActionResultPacket).ok
    assert item.z == item.params["currentZ"] == 20
    assert item.params["floorZs"] == [20, 60]
    assert item.params["doorOpen"] is False
    owner.z = 20
    await server._handle_message(
        owner,
        json.dumps(
            dict(type="item_update", itemId=item.id, params={"floorZs": "30,60"})
        ),
    )
    assert not world.transport.last_packet_of_type(owner, ItemActionResultPacket).ok
    assert item.params["floorZs"] == [20, 60]
    assert item.z == 20


@pytest.mark.asyncio
async def test_stop_edit_rejects_riders_and_pending_calls(world):
    server = world.server
    owner = world.join("Owner")
    item = server.item_service.default_item(owner, "elevator")
    server.item_service.add_item(item)
    for updates in ({"state": "moving"}, {"requestedZs": [40]}, {}):
        item.params.update(state="idle", requestedZs=[])
        item.params.update(updates)
        owner.elevator_id = item.id if not updates else None
        await server._handle_message(
            owner,
            json.dumps(
                dict(type="item_update", itemId=item.id, params={"floorZs": "0,20,40"})
            ),
        )
        assert not world.transport.last_packet_of_type(owner, ItemActionResultPacket).ok
        assert item.params["floorZs"] == [0, 40]


def test_checkpoint_keeps_nonzero_shaft_with_air_stops_and_restart(
    make_world, tmp_path
):
    path = tmp_path / "items.json"
    world = make_world(state_file=path)
    server = world.server
    server.platform_service.mutate(
        None, dict(name="Basement", startX=-10, startY=-10, endX=-5, endY=-5, z=-20)
    )
    builder = world.join("Owner", x=-8, y=-8, z=-20)
    item = server.item_service.default_item(builder, "elevator")
    item.params.update(floorZs=[-20, 10, 70], currentZ=10, speed=15, requestedZs=[70])
    server.item_service.add_item(item)
    checkpoint = server.world_store.capture("Air stops", "owner")
    preview = server.world_store.preview(checkpoint["id"])
    server.world_store.restore(checkpoint["id"], preview["worldRevision"], "owner")
    restored = server.items[item.id]
    assert restored.z == -20
    assert restored.params["currentZ"] == 10
    assert restored.params["requestedZs"] == []
    restarted = make_world(state_file=path).server
    assert restarted.items[item.id].params["floorZs"] == [-20, 10, 70]
    assert restarted.items[item.id].params["speed"] == 15


@pytest.mark.asyncio
async def test_platform_delete_requires_one_boardable_stop(world):
    from app.models import PlatformActionResultPacket

    server = world.server
    owner = world.join("Owner", x=10, y=10, z=0)
    item = server.item_service.default_item(owner, "elevator")
    item.params["floorZs"] = [0, 60]
    server.item_service.add_item(item)
    await server._handle_message(
        owner, json.dumps(dict(type="platform_delete", platformId="ground"))
    )
    result = world.transport.last_packet_of_type(owner, PlatformActionResultPacket)
    assert not result.ok and "at least one stop" in result.message
    assert "ground" in server.platform_service.platforms
