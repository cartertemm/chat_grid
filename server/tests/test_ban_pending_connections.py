from __future__ import annotations

import json
import uuid
from typing import cast

import pytest
from websockets.asyncio.server import ServerConnection

from app.client import ClientConnection
from app.models import AuthResultPacket

from .conftest import World


class ClosableSocket:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


async def log_in_without_joining(world: World) -> tuple[ClientConnection, str]:
    username = f"spare_{uuid.uuid4().hex[:8]}"
    world.server.auth_service.register(username, "password99")
    client = world.connect("spare")
    client.websocket = cast(ServerConnection, ClosableSocket())
    await world.server._handle_message(
        client,
        json.dumps({"type": "auth_login", "username": username, "password": "password99"}),
    )
    assert client.authenticated is True
    assert client.websocket not in world.server.clients
    return client, username


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("packet_type", "message"),
    [("admin_user_ban", "Account is disabled."), ("admin_user_delete", "Account deleted.")],
)
async def test_ban_and_delete_close_connections_that_have_not_joined(
    world: World, packet_type: str, message: str
) -> None:
    admin = world.join("admin")
    spare, username = await log_in_without_joining(world)

    await world.server._handle_message(
        admin, json.dumps({"type": packet_type, "username": username})
    )

    assert cast(ClosableSocket, spare.websocket).closed is True
    result = world.transport.last_packet_of_type(spare, AuthResultPacket)
    assert result.ok is False
    assert result.message == message


@pytest.mark.asyncio
@pytest.mark.parametrize("remove_account", ["disable", "delete"])
async def test_welcome_ready_rejects_an_account_that_is_no_longer_active(
    world: World, remove_account: str
) -> None:
    observer = world.join("observer")
    spare, username = await log_in_without_joining(world)
    if remove_account == "disable":
        world.server.auth_service.set_user_status(username, "disabled")
    else:
        world.server.auth_service.delete_user(username)
    world.transport.clear()

    await world.server._handle_message(spare, json.dumps({"type": "welcome_ready"}))

    assert spare.websocket not in world.server.clients
    assert spare.world_ready is False
    assert cast(ClosableSocket, spare.websocket).closed is True
    assert world.transport.last_packet_of_type(spare, AuthResultPacket).ok is False
    assert world.transport.packets_to(observer) == []
