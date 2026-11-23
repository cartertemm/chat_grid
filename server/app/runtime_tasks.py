"""Coordinate cancellation of tasks owned by the live world."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Iterable


def cancel_and_join(tasks: Iterable[asyncio.Task[None]]) -> Awaitable[None]:
    """Cancel every task before yielding control, then wait for cleanup."""
    pending = tuple(tasks)
    for task in pending:
        task.cancel()

    async def join() -> None:
        await asyncio.gather(*pending, return_exceptions=True)

    return join()
