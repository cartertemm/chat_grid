"""World checkpoints drain concurrent operations without blocking normal peers."""

import asyncio

import pytest

from app.world_gate import WorldMutationGate


@pytest.mark.asyncio
async def test_checkpoint_drains_active_operations_and_defers_new_operations():
    gate = WorldMutationGate()
    release = asyncio.Event()
    order: list[str] = []

    async def normal(name):
        async with gate.operation():
            order.append(name)
            await release.wait()

    async def checkpoint():
        async with gate.operation(exclusive=True):
            order.append("checkpoint")
            await asyncio.sleep(0)

    first = asyncio.create_task(normal("first"))
    second = asyncio.create_task(normal("second"))
    await asyncio.sleep(0)
    assert order == ["first", "second"]
    writer = asyncio.create_task(checkpoint())
    await asyncio.sleep(0)
    third = asyncio.create_task(normal("third"))
    await asyncio.sleep(0)
    assert order == ["first", "second"]
    release.set()
    await asyncio.gather(first, second, writer, third)
    assert order == ["first", "second", "checkpoint", "third"]


@pytest.mark.asyncio
async def test_cancelled_checkpoint_does_not_leave_operations_blocked():
    gate = WorldMutationGate()
    release = asyncio.Event()

    async def writer():
        async with gate.operation(exclusive=True):
            await release.wait()

    async with gate.operation():
        task = asyncio.create_task(writer())
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        async with asyncio.timeout(1):
            async with gate.operation():
                pass
