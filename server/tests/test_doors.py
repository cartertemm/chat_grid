"""Door behavior through the same packet entry point as real clients."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.client import ClientConnection
from app.models import DoorActionResultPacket, StructureUpsertPacket, WorldSoundPacket
from app.structure_service import StructureError, StructureService

from .conftest import World


@pytest.fixture
def door_world(make_world, tmp_path: Path):
    world = make_world(
        state_file=tmp_path / "items.json",
        structure_presets={"brick": {"title": "Wall", "movementBlocked": True}},
    )
    owner = world.join("Owner", x=4, y=4)
    guest = world.join("Guest", x=4, y=5, role="user", permissions=set())
    wall = world.server.structure_service.add_wall(
        owner, preset_id="brick", direction="north"
    )
    wall = world.server.structure_service.resize_wall(wall.id, endpoint="end", delta=1)
    wall = world.server.structure_service.resize_wall(wall.id, endpoint="end", delta=1)
    return world, owner, guest, wall.id


async def action(
    world: World, client: ClientConnection, wall_id: str, operation: str, **values
):
    await world.server._handle_message(
        client,
        json.dumps(
            {
                "type": "door_action",
                "structureId": wall_id,
                "action": operation,
                **values,
            }
        ),
    )
    return world.transport.last_packet_of_type(client, DoorActionResultPacket)


async def add(door_world, **values):
    world, owner, _, wall_id = door_world
    result = await action(world, owner, wall_id, "add", offset=0)
    assert result.ok
    door_id = result.doorId
    if values:
        result = await action(world, owner, wall_id, "update", doorId=door_id, **values)
        assert result.ok
    return door_id


async def pin(world, client, wall_id, door_id, digits="0042"):
    for digit in digits:
        result = await action(
            world, client, wall_id, "keypad_digit", doorId=door_id, digit=digit
        )
    return result


def door(world, wall_id, door_id):
    return next(
        d
        for d in world.server.structure_service.structures[wall_id].doors
        if d.id == door_id
    )


@pytest.mark.asyncio
async def test_shared_unlock_does_not_move_door(door_world):
    world, owner, guest, wall_id = door_world
    door_id = await add(door_world, pin="0042")
    assert (await action(world, owner, wall_id, "lock", doorId=door_id)).ok
    result = await action(world, owner, wall_id, "open", doorId=door_id)
    assert result.keypadActive
    world.transport.clear()
    assert (await pin(world, owner, wall_id, door_id)).ok
    assert not door(world, wall_id, door_id).isLocked
    assert not door(world, wall_id, door_id).isOpen
    assert world.transport.packets_of_type(owner, WorldSoundPacket) == []
    assert (await action(world, guest, wall_id, "open", doorId=door_id)).ok
    assert door(world, wall_id, door_id).isOpen
    assert (
        world.transport.last_packet_of_type(guest, WorldSoundPacket).sound
        == "/sounds/door_open.ogg"
    )
    assert (await action(world, guest, wall_id, "close", doorId=door_id)).ok
    assert (
        world.transport.last_packet_of_type(guest, WorldSoundPacket).sound
        == "/sounds/door_close.ogg"
    )
    assert not door(world, wall_id, door_id).isLocked


@pytest.mark.asyncio
@pytest.mark.parametrize("policy", ["unlock", "lock", "both"])
async def test_pin_requirement_for_each_manual_operation(door_world, policy):
    world, owner, _, wall_id = door_world
    door_id = await add(door_world, pin="0042", pinRequiredFor=policy)
    result = await action(world, owner, wall_id, "lock", doorId=door_id)
    assert result.keypadActive == (policy in {"lock", "both"})
    if result.keypadActive:
        assert (await pin(world, owner, wall_id, door_id)).ok
    assert door(world, wall_id, door_id).isLocked
    result = await action(world, owner, wall_id, "unlock", doorId=door_id)
    assert result.keypadActive == (policy in {"unlock", "both"})
    if result.keypadActive:
        assert (await pin(world, owner, wall_id, door_id)).ok
    assert not door(world, wall_id, door_id).isLocked


@pytest.mark.asyncio
@pytest.mark.parametrize("seconds", [0, 1, 300])
async def test_deadline_relocks_without_closing_and_survives_restart(
    door_world, monkeypatch, seconds
):
    world, owner, _, wall_id = door_world
    now = [1_000_000]
    monkeypatch.setattr(world.server.door_runtime, "now_ms", lambda: now[0])
    door_id = await add(door_world, pin="0042", unlockTimeoutSeconds=seconds)
    await action(world, owner, wall_id, "lock", doorId=door_id)
    await action(world, owner, wall_id, "unlock", doorId=door_id)
    await pin(world, owner, wall_id, door_id)
    await action(world, owner, wall_id, "open", doorId=door_id)
    world.server.structure_service.save_state()
    restored = StructureService(
        state_file=world.server.structure_service.state_file,
        grid_size=world.server.grid_size,
        presets=world.server.structure_service.presets,
    )
    assert restored.structures[wall_id].doors[0].unlockDeadlineMs == (
        now[0] + seconds * 1000 if seconds else None
    )
    now[0] += 301_000
    await world.server.door_runtime.expire()
    assert door(world, wall_id, door_id).isLocked == (seconds > 0)
    assert door(world, wall_id, door_id).isOpen
    await action(world, owner, wall_id, "close", doorId=door_id)
    assert door(world, wall_id, door_id).isLocked == (seconds > 0)


@pytest.mark.asyncio
async def test_one_sided_free_exit_preserves_lock(door_world):
    world, owner, guest, wall_id = door_world
    door_id = await add(door_world, pin="0042", keypadSides="negative")
    await action(world, owner, wall_id, "lock", doorId=door_id)
    result = await action(world, guest, wall_id, "open", doorId=door_id)
    assert result.ok and not result.keypadActive
    assert door(world, wall_id, door_id).isLocked
    await action(world, guest, wall_id, "close", doorId=door_id)
    assert (await action(world, owner, wall_id, "open", doorId=door_id)).keypadActive


@pytest.mark.asyncio
async def test_keypad_exclusive_and_second_user_does_not_extend_deadline(
    door_world, monkeypatch
):
    world, owner, guest, wall_id = door_world
    now = [0]
    monkeypatch.setattr(world.server.door_runtime, "now_ms", lambda: now[0])
    door_id = await add(door_world, pin="0042")
    await action(world, owner, wall_id, "unlock", doorId=door_id)
    now[0] = 9000
    result = await action(world, guest, wall_id, "unlock", doorId=door_id)
    assert not result.ok and result.message == "Keypad in use."
    now[0] = 10_000
    result = await action(world, guest, wall_id, "unlock", doorId=door_id)
    assert result.keypadActive
    assert (await pin(world, guest, wall_id, door_id)).ok


@pytest.mark.asyncio
async def test_keypad_releases_on_walk_away_and_disconnect(door_world):
    world, owner, guest, wall_id = door_world
    door_id = await add(door_world, pin="0042")
    await action(world, owner, wall_id, "unlock", doorId=door_id)
    await action(world, owner, wall_id, "keypad_digit", doorId=door_id, digit="0")
    owner.x = 8
    assert (await action(world, guest, wall_id, "unlock", doorId=door_id)).keypadActive
    world.server.door_runtime.release_client(guest)
    owner.x = 4
    assert (await action(world, owner, wall_id, "unlock", doorId=door_id)).keypadActive


@pytest.mark.asyncio
async def test_failures_are_bounded_and_pin_is_private(door_world, caplog):
    world, owner, _, wall_id = door_world
    door_id = await add(door_world, pin="0042")
    for _ in range(5):
        assert (
            await action(world, owner, wall_id, "unlock", doorId=door_id)
        ).keypadActive
        assert not (await pin(world, owner, wall_id, door_id, "9999")).ok
    assert not (await action(world, owner, wall_id, "unlock", doorId=door_id)).ok
    payload = world.transport.last_packet_of_type(
        owner, StructureUpsertPacket
    ).model_dump_json()
    assert (
        "0042" not in payload and "$argon2" not in payload and "doorPins" not in payload
    )
    await world.server._handle_message(
        owner,
        json.dumps(
            {
                "type": "door_action",
                "structureId": wall_id,
                "action": "update",
                "pin": "999999999",
            }
        ),
    )
    assert "999999999" not in caplog.text


@pytest.mark.asyncio
async def test_multiple_doors_resize_rotate_and_restored_wall_edge(door_world):
    world, owner, _, wall_id = door_world
    first = await add(door_world)
    second = (await action(world, owner, wall_id, "add", offset=2)).doorId
    service = world.server.structure_service
    with pytest.raises(StructureError):
        service.resize_wall(wall_id, endpoint="start", delta=1)
    wall = service.resize_wall(wall_id, endpoint="start", delta=-1)
    assert [d.offset for d in wall.doors] == [1, 3]
    wall = service.rotate_wall(wall_id, orientation="vertical")
    assert [d.offset for d in wall.doors] == [1, 3]
    assert service.blocking_wall_for_move(x=3, y=6, z=0, next_x=2, next_y=6)
    await action(world, owner, wall_id, "remove", doorId=first)
    assert len(service.structures[wall_id].doors) == 1
    assert service.structures[wall_id].doors[0].id == second


@pytest.mark.asyncio
async def test_creation_permissions_clearing_pin_and_invalid_placement(door_world):
    world, owner, guest, wall_id = door_world
    assert not (await action(world, guest, wall_id, "add", offset=0)).ok
    assert not (await action(world, owner, wall_id, "add", offset=3)).ok
    door_id = await add(door_world, pin="0042", unlockTimeoutSeconds=20)
    assert not (await action(world, owner, wall_id, "add", offset=0)).ok
    await action(world, owner, wall_id, "lock", doorId=door_id)
    await action(world, owner, wall_id, "update", doorId=door_id, pin="")
    current = door(world, wall_id, door_id)
    assert (
        not current.isLocked and not current.hasPin and current.unlockDeadlineMs is None
    )
    assert door_id not in world.server.structure_service.door_pins
    guest.x = 8
    assert not (await action(world, guest, wall_id, "open", doorId=door_id)).ok


@pytest.mark.asyncio
async def test_pin_verification_rechecks_location_after_worker_wait(
    door_world, monkeypatch
):
    import asyncio

    world, owner, _, wall_id = door_world
    door_id = await add(door_world, pin="0042")
    await action(world, owner, wall_id, "lock", doorId=door_id)
    await action(world, owner, wall_id, "unlock", doorId=door_id)
    for digit in "004":
        await action(world, owner, wall_id, "keypad_digit", doorId=door_id, digit=digit)
    started, resume = asyncio.Event(), asyncio.Event()

    async def delayed_worker(func, *args):
        started.set()
        await resume.wait()
        return func(*args)

    monkeypatch.setattr(asyncio, "to_thread", delayed_worker)
    submitted = asyncio.create_task(
        action(world, owner, wall_id, "keypad_digit", doorId=door_id, digit="2")
    )
    await started.wait()
    owner.x = 8
    resume.set()
    assert not (await submitted).ok
    assert door(world, wall_id, door_id).isLocked


@pytest.mark.asyncio
async def test_title_edit_keeps_deadline_and_free_side_can_use_busy_door(
    door_world, monkeypatch
):
    world, owner, guest, wall_id = door_world
    now = [1000]
    monkeypatch.setattr(world.server.door_runtime, "now_ms", lambda: now[0])
    door_id = await add(
        door_world, pin="0042", keypadSides="negative", unlockTimeoutSeconds=5
    )
    await action(world, owner, wall_id, "lock", doorId=door_id)
    await action(world, owner, wall_id, "unlock", doorId=door_id)
    await pin(world, owner, wall_id, door_id)
    deadline = door(world, wall_id, door_id).unlockDeadlineMs
    now[0] += 1000
    await action(world, owner, wall_id, "update", doorId=door_id, title="Studio")
    assert door(world, wall_id, door_id).unlockDeadlineMs == deadline
    await action(world, owner, wall_id, "lock", doorId=door_id)
    await action(world, owner, wall_id, "unlock", doorId=door_id)
    assert (await action(world, guest, wall_id, "open", doorId=door_id)).ok
    assert door(world, wall_id, door_id).isOpen
    assert not (await pin(world, owner, wall_id, door_id)).ok
