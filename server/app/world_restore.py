"""Public world hydration and runtime reconciliation after an atomic restore."""

from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

from .acoustic_zones import client_position_packet
from .models import WorldRestoredPacket

if TYPE_CHECKING:
    from .server import SignalingServer


class PublicWorld(TypedDict):
    """Authored world data visible to roster members."""

    items: list[dict]
    structures: list[dict]
    regions: list[dict]
    ambiances: list[dict]
    platforms: list[dict]


def public_world(server: SignalingServer) -> PublicWorld:
    """Use the welcome packet's public representation for every full refresh."""
    return PublicWorld(
        platforms=server.platform_service.dump_state(),
        items=[
            server.item_runtime.outbound_item(item).model_dump(exclude_none=True)
            for item in server.items.values()
        ],
        structures=[
            wall.model_dump() for wall in server.structure_service.structures.values()
        ],
        regions=[
            region.model_dump() for region in server.region_service.regions.values()
        ],
        ambiances=[
            entry.model_dump() for entry in server.ambiance_service.ambiances.values()
        ],
    )


async def reconcile_world_restore(server: SignalingServer) -> None:
    """Retire old tasks before yielding, then publish the restored public world."""
    items_running = server.item_runtime.running
    doors_running = server.door_runtime.running
    doors_stopped = server.door_runtime.stop()
    try:
        await server.item_runtime.shutdown()
        await doors_stopped
        corrected = []
        for client in server.clients.values():
            prior = (client.x, client.y, client.z, client.elevator_id)
            client.elevator_id = None
            # Walls occupy edges. A valid tile remains a valid standing position.
            if not server.platform_service.contains(client.x, client.y, client.z):
                landing = (
                    server.platform_service.landing_position(
                        client.x, client.y, client.z
                    )
                    if prior[3] is not None
                    else None
                )
                client.x, client.y, client.z = (
                    landing or server.platform_service.spawn()
                )
            if (client.x, client.y, client.z, client.elevator_id) != prior:
                server._persist_client_position(client, force=True)
                corrected.append(client)
        await server.delivery.broadcast(
            WorldRestoredPacket(type="world_restored", **public_world(server))
        )
        for client in corrected:
            await server.delivery.broadcast(client_position_packet(client))
    finally:
        if items_running:
            server.item_runtime.start()
        if doors_running:
            server.door_runtime.start()
