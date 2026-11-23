"""Runtime retirement during live checkpoint restoration."""

import asyncio

import pytest

from app.models import BroadcastPositionPacket, WorldRestoredPacket
from app.world_restore import reconcile_world_restore


@pytest.mark.asyncio
async def test_restore_cancels_old_work_before_it_runs_and_releases_riders(world):
    server = world.server
    rider = world.join("Rider", x=3, y=4, z=40, elevator_id="removed-car")
    other = world.join("Listener", x=2, y=1, z=0)
    ran = []

    async def stale_move():
        ran.append(True)
        rider.x = 30

    # This runnable already occupies a place on the loop's ready queue.
    old_task = asyncio.create_task(stale_move())
    server.item_runtime.elevator._tasks["removed-car"] = old_task
    server.item_runtime.piano.active_keys_by_client[rider.id] = {"C4"}
    server.door_runtime.start()
    server.item_runtime.start()
    try:
        await reconcile_world_restore(server)
        assert old_task.cancelled() and not ran
        assert not server.item_runtime.piano.active_keys_by_client
        assert rider.elevator_id is None
        assert (rider.x, rider.y, rider.z) == (3, 4, 40)
        assert server.item_runtime.running and server.door_runtime.running
        for client in (other, rider):
            packets = world.transport.packets_to(client)
            assert isinstance(packets[0], WorldRestoredPacket)
            position = world.transport.last_packet_of_type(
                client, BroadcastPositionPacket
            )
            assert position.id == rider.id and position.acousticZoneId == "floor:40"
    finally:
        await server.item_runtime.shutdown()
        await server.door_runtime.stop()
