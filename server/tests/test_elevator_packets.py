"""Exercise elevator controls through the same packet path as a connected browser."""

import json

import pytest

from app.models import ItemActionResultPacket


@pytest.mark.asyncio
async def test_select_floor_requires_permission_and_the_correct_cabin(world):
    rider = world.join("Rider")
    car = world.server.item_service.default_item(rider, "elevator")
    car.params.update(floorZs=[0, 35, 40], state="door_open", doorOpen=True)
    world.server.item_service.add_item(car)
    request = json.dumps({"type": "elevator_select_floor", "itemId": car.id, "z": 35})

    await world.server._handle_message(rider, request)
    assert not world.transport.last_packet_of_type(rider, ItemActionResultPacket).ok
    assert car.params["requestedZs"] == []

    rider.elevator_id = car.id
    rider.permissions = set()
    await world.server._handle_message(rider, request)
    assert not world.transport.last_packet_of_type(rider, ItemActionResultPacket).ok
    assert car.params["requestedZs"] == []

    rider.permissions.add("item.use")
    await world.server._handle_message(rider, request)
    assert world.transport.last_packet_of_type(rider, ItemActionResultPacket).ok
    assert car.params["requestedZs"] == [35]


@pytest.mark.asyncio
async def test_builder_places_car_on_an_isolated_custom_platform(world):
    builder = world.join("Builder", x=70, y=70, z=70)
    world.server.platform_service.mutate(
        None, dict(name="Tower", startX=70, startY=70, endX=72, endY=72, z=70)
    )
    await world.server._handle_message(
        builder, json.dumps(dict(type="item_add", itemType="elevator"))
    )
    result = world.transport.last_packet_of_type(builder, ItemActionResultPacket)
    assert result.ok
    car = world.server.items[result.itemId]
    assert car.params["floorZs"] == [0, 40, 70] and car.params["currentZ"] == 70


def test_position_save_in_open_air_preserves_facing_and_safe_return(world, monkeypatch):
    rider = world.join("Rider", x=7, y=11, z=60, facing_deg=225)
    car = world.server.item_service.default_item(rider, "elevator")
    car.params.update(floorZs=[0, 60], currentZ=60)
    world.server.item_service.add_item(car)
    rider.elevator_id = car.id
    saved = []
    monkeypatch.setattr(
        world.server.auth_service, "set_last_position", lambda *args: saved.append(args)
    )

    world.server._persist_client_position(rider, force=True)

    assert saved == [(rider.user_id, 7, 11, 40, 225)]
    assert rider.z == 60 and rider.elevator_id == car.id
