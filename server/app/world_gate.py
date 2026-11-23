"""Concurrent world operations with exclusive checkpoint publication."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator


class WorldMutationGate:
    """Drain ordinary operations before a checkpoint and defer new operations."""

    def __init__(self) -> None:
        """Create an idle shared operation gate."""

        self._condition = asyncio.Condition()
        self._readers = 0
        self._writer = False
        self._waiting_writers = 0

    @asynccontextmanager
    async def operation(self, *, exclusive: bool = False) -> AsyncIterator[None]:
        """Allow normal handlers concurrently, or exclusively drain them for restore."""

        async with self._condition:
            if exclusive:
                self._waiting_writers += 1
                try:
                    await self._condition.wait_for(
                        lambda: not self._writer and self._readers == 0
                    )
                    self._writer = True
                finally:
                    self._waiting_writers -= 1
                    self._condition.notify_all()
            else:
                await self._condition.wait_for(
                    lambda: not self._writer and self._waiting_writers == 0
                )
                self._readers += 1
        try:
            yield
        finally:
            async with self._condition:
                if exclusive:
                    self._writer = False
                else:
                    self._readers -= 1
                self._condition.notify_all()
