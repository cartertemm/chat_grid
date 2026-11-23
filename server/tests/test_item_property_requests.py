"""Correlate property acknowledgements with delayed browser editor requests."""

import json

import pytest

from app.models import ItemActionResultPacket


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "outcome", ["accepted", "missing", "denied", "unsupported", "limited"]
)
async def test_item_update_returns_request_id_on_every_outcome(
    world, monkeypatch, outcome
):
    owner = world.join("Builder", x=40, y=40)
    item = world.server.item_service.default_item(owner, "widget")
    world.server.item_service.add_item(item)
    packet = dict(
        type="item_update",
        itemId=item.id,
        requestId="item-property-9",
        params={"endX": 40},
    )
    if outcome == "missing":
        packet["itemId"] = "missing"
    elif outcome == "denied":
        owner.permissions = set()
    elif outcome == "unsupported":
        packet["params"] = {"endX": 41}
    elif outcome == "limited":
        monkeypatch.setattr(world.server, "_consume_rate_limit", lambda *_: False)

    await world.server._handle_message(owner, json.dumps(packet))

    result = world.transport.last_packet_of_type(owner, ItemActionResultPacket)
    assert result.requestId == "item-property-9"
    assert result.ok == (outcome == "accepted")
