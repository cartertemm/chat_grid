"""Independent item copying through the authenticated packet entry point."""

from __future__ import annotations

import json

import pytest

from app.item_catalog import ITEM_TYPE_SEQUENCE
from app.item_service import ItemService
from app.models import ItemActionResultPacket


async def duplicate(world, actor, source):
    await world.server._handle_message(
        actor, json.dumps({"type": "item_duplicate", "itemId": source.id})
    )
    return world.transport.packets_of_type(actor, ItemActionResultPacket)[-1]


@pytest.mark.asyncio
@pytest.mark.parametrize("item_type", ITEM_TYPE_SEQUENCE)
async def test_duplicate_any_type_owned_by_another_user(make_world, item_type):
    world = make_world()
    owner = world.join("owner")
    copier = world.join("copier", permissions={"item.create"})
    source = world.server.item_service.default_item(owner, item_type)
    source.title = "Customized original"
    world.server.item_service.add_item(source)

    result = await duplicate(world, copier, source)

    assert result.ok
    copy = world.server.item_service.items[result.itemId]
    assert copy.id != source.id
    assert copy.title == source.title
    assert copy.createdBy == copy.updatedBy == copier.user_id
    assert source.createdBy == owner.user_id
    assert copy.version == 1
    assert copy.carrierId is None
    copy.params["independent"] = [1]
    assert "independent" not in source.params


@pytest.mark.asyncio
async def test_duplicate_piano_song_is_independent_and_persisted(make_world, tmp_path):
    path = tmp_path / "items.json"
    world = make_world(state_file=path)
    owner = world.join("owner")
    copier = world.join("copier")
    service = world.server.item_service
    source = service.default_item(owner, "piano")
    source.params.update(songId="original-song", instrument="organ")
    service.piano_songs["original-song"] = {"notes": [{"midi": 60}]}
    service.add_item(source)

    result = await duplicate(world, copier, source)
    assert result.ok
    copy = service.items[result.itemId]
    copy_song = copy.params["songId"]
    assert copy_song != "original-song"
    assert service.piano_songs[copy_song] == service.piano_songs["original-song"]
    service.piano_songs[copy_song]["notes"][0]["midi"] = 72
    assert service.piano_songs["original-song"]["notes"][0]["midi"] == 60
    # Removing the source and its recording must leave the new recording intact.
    world.server.item_runtime.piano.remove_item(source)
    service.remove_item(source.id)
    world.server._flush_state_save()
    reloaded = ItemService(path)
    assert reloaded.items[copy.id].params["instrument"] == "organ"
    assert reloaded.piano_songs[copy_song]["notes"][0]["midi"] == 72


@pytest.mark.asyncio
async def test_duplicate_resets_elevator_travel_and_carrier(make_world):
    world = make_world()
    actor = world.join("builder", z=40)
    service = world.server.item_service
    source = service.default_item(actor, "elevator")
    source.z = 0
    source.params.update(currentZ=40, targetZ=0, state="moving", doorOpen=True)
    service.add_item(source)
    result = await duplicate(world, actor, source)
    assert result.ok
    copy = service.items[result.itemId]
    assert copy.z == 0
    assert copy.params["currentZ"] == 40
    assert copy.params["targetZ"] is None
    assert copy.params["state"] == "idle"
    assert copy.params["doorOpen"] is False
    assert source.params["state"] == "moving"


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["permission", "quota", "remote", "carried"])
async def test_rejected_duplicate_creates_neither_item_nor_song(make_world, reason):
    world = make_world(max_items_per_user=1)
    owner = world.join("owner")
    actor = world.join(
        "copier", permissions=set() if reason == "permission" else {"item.create"}
    )
    service = world.server.item_service
    source = service.default_item(owner, "piano")
    source.params["songId"] = "song"
    service.piano_songs["song"] = {"notes": []}
    service.add_item(source)
    if reason == "quota":
        service.add_item(service.default_item(actor, "dice"))
    elif reason == "remote":
        actor.x += 1
    elif reason == "carried":
        source.carrierId = owner.id
    before = set(service.items)

    result = await duplicate(world, actor, source)

    assert not result.ok
    assert set(service.items) == before
    assert set(service.piano_songs) == {"song"}


@pytest.mark.asyncio
async def test_duplicate_consumes_the_shared_creation_budget(make_world):
    world = make_world()
    actor = world.join("copier")
    source = world.server.item_service.default_item(actor, "dice")
    world.server.item_service.add_item(source)
    for _ in range(10):
        assert (await duplicate(world, actor, source)).ok
    result = await duplicate(world, actor, source)
    assert not result.ok
    assert "quickly" in result.message
    assert len(world.server.item_service.items) == 11


@pytest.mark.asyncio
async def test_copied_song_save_failure_rolls_back_before_item_creation(
    make_world, monkeypatch
):
    world = make_world()
    actor = world.join("copier")
    service = world.server.item_service
    source = service.default_item(actor, "piano")
    source.params["songId"] = "song"
    service.piano_songs["song"] = {"notes": []}
    service.add_item(source)
    monkeypatch.setattr(service, "save_piano_songs", lambda: False)

    assert not (await duplicate(world, actor, source)).ok
    assert set(service.items) == {source.id}
    assert set(service.piano_songs) == {"song"}
