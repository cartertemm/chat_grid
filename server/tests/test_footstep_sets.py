"""Installed platform sound sets and durable missing-asset behavior."""

import json

import pytest

from app.footstep_sets import discover_footstep_sets
from app.models import PlatformActionResultPacket
from app.platform_service import PlatformError, PlatformService


def test_discovery_uses_real_safe_folders_and_natural_sample_order(tmp_path):
    directory = tmp_path / "wood_floor"
    directory.mkdir()
    for name in ("step-10.ogg", "step-2.ogg", "notes.txt"):
        (directory / name).write_bytes(b"sample")
    (tmp_path / "empty").mkdir()
    (tmp_path / "unsafe name").mkdir()
    (tmp_path / "unsafe name" / "step-1.ogg").write_bytes(b"sample")
    catalog = discover_footstep_sets(tmp_path)
    assert [(entry.id, entry.title) for entry in catalog] == [
        ("default", "Default"),
        ("wood_floor", "Wood Floor"),
    ]
    assert catalog[1].urls == [
        "/sounds/steps/wood_floor/step-2.ogg",
        "/sounds/steps/wood_floor/step-10.ogg",
    ]


def test_discovery_does_not_publish_symlinked_assets(tmp_path):
    root = tmp_path / "steps"
    default = root / "default"
    default.mkdir(parents=True)
    outside = tmp_path / "private.ogg"
    outside.write_bytes(b"private")
    try:
        (default / "linked.ogg").symlink_to(outside)
        (root / "external").symlink_to(tmp_path, target_is_directory=True)
    except OSError:
        pytest.skip("Creating symlinks is unavailable on this host.")
    assert [(entry.id, entry.urls) for entry in discover_footstep_sets(root)] == [
        ("default", [])
    ]


def test_missing_sets_keep_old_platforms_editable_and_default_available(tmp_path):
    geometry = PlatformService(state_file=None, sounds_dir=tmp_path)
    assert geometry.platforms["ground"].footstepSet == "default"
    geometry.mutate("ground", {"footstepSet": "default"})
    raw = geometry.dump_state()
    raw[1].pop("footstepSet")
    raw[0]["footstepSet"] = "previously-installed"
    geometry.restore_state(raw)
    assert geometry.platforms["second-floor"].footstepSet == "default"
    geometry.mutate("ground", {"name": "Renamed"})
    assert geometry.platforms["ground"].footstepSet == "previously-installed"
    with pytest.raises(PlatformError, match="Unknown"):
        geometry.mutate("ground", {"footstepSet": "not-installed"})
    geometry.mutate("ground", {"footstepSet": "default"})


@pytest.mark.asyncio
async def test_platform_footsteps_validate_live_packets_and_survive_checkpoint(
    make_world, tmp_path
):
    sounds = tmp_path / "steps"
    wood = sounds / "wood"
    wood.mkdir(parents=True)
    (wood / "step-1.ogg").write_bytes(b"sample")
    world = make_world(state_file=tmp_path / "items.json", footstep_sounds_dir=sounds)
    server = world.server
    actor = world.join("Builder")
    await server._handle_message(
        actor,
        json.dumps(
            {"type": "platform_update", "platformId": "ground", "footstepSet": "wood"}
        ),
    )
    assert world.transport.last_packet_of_type(actor, PlatformActionResultPacket).ok
    checkpoint = server.world_store.capture("Wood floor", actor.id)
    server.platform_service.mutate("ground", {"footstepSet": "default"})
    preview = server.world_store.preview(checkpoint["id"])
    server.world_store.restore(checkpoint["id"], preview["worldRevision"], actor.id)
    assert server.platform_service.platforms["ground"].footstepSet == "wood"
    restarted = make_world(
        state_file=tmp_path / "items.json", footstep_sounds_dir=tmp_path / "missing"
    )
    assert restarted.server.platform_service.platforms["ground"].footstepSet == "wood"
    restarted.server.platform_service.mutate(
        "ground", {"name": "Retained sound choice"}
    )
