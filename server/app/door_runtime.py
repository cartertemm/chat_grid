"""Door operations, PIN sessions and unlock deadlines for authored walls."""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import logging
from typing import Literal
import uuid

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

from .client import ClientConnection
from .models import DoorActionPacket, DoorActionResultPacket, WallDoor, WallStructure
from .structure_service import StructureError, StructureService

LOGGER = logging.getLogger("chgrid.server.doors")
KeypadAction = Literal["lock", "unlock"]


@dataclass
class KeypadSession:
    """Hold one player's partial input until submission or inactivity."""

    client: ClientConnection
    wall_id: str
    action: KeypadAction
    revision: int
    last_input_ms: int
    digits: str = ""
    checking: bool = False


class DoorRuntime:
    """Operate shared doors and keep temporary keypad input out of world state."""

    def __init__(
        self,
        structures: StructureService,
        *,
        now_ms: Callable[[], int],
        publish: Callable[[WallStructure], Awaitable[None]],
        notify: Callable[[ClientConnection, DoorActionResultPacket], Awaitable[None]],
        sound: Callable[[WallStructure, WallDoor, bool], Awaitable[None]],
    ) -> None:
        """Bind wall storage and existing delivery without owning a transport."""

        self.structures = structures
        self.now_ms = now_ms
        self.publish = publish
        self.notify = notify
        self.sound = sound
        self.sessions: dict[str, KeypadSession] = {}
        self.failures: dict[str, deque[int]] = {}
        self._task: asyncio.Task[None] | None = None
        # Four-digit gameplay codes have inherently low entropy. Keep only salted
        # verifiers in the private world file and bound online attempts below.
        self._hasher = PasswordHasher(time_cost=2, memory_cost=8192, parallelism=1)
        self._hash_slots = asyncio.Semaphore(2)

    def start(self) -> None:
        """Run deadline reconciliation while the server is serving."""

        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        """Cancel transient keypad work before shutdown."""

        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None
        self.sessions.clear()

    def release_client(self, client: ClientConnection) -> None:
        """Discard partial entry when a client disconnects."""

        for door_id, session in list(self.sessions.items()):
            if session.client is client:
                del self.sessions[door_id]

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(0.25)
            try:
                await self.expire()
            except Exception:
                LOGGER.exception("door deadline reconciliation failed")

    def _find(
        self, wall_id: str, door_id: str | None
    ) -> tuple[WallStructure, WallDoor]:
        wall = self.structures.structures.get(wall_id)
        if wall is None:
            raise StructureError("Wall not found.")
        door = next((door for door in wall.doors if door.id == door_id), None)
        if door is None:
            raise StructureError("Door not found.")
        return wall, door

    def _result(
        self,
        packet: DoorActionPacket,
        message: str,
        *,
        ok: bool = True,
        keypad: KeypadAction | None = None,
    ) -> DoorActionResultPacket:
        return DoorActionResultPacket(
            type="door_action_result",
            ok=ok,
            action=packet.action,
            message=message,
            structureId=packet.structureId,
            doorId=packet.doorId,
            keypadActive=keypad is not None,
            keypadAction=keypad,
        )

    async def expire(self) -> None:
        """Release abandoned keypads and relock expired doors without moving them."""

        now = self.now_ms()
        for door_id, session in list(self.sessions.items()):
            try:
                wall, door = self._find(session.wall_id, door_id)
                self.structures.door_side(wall, door, session.client)
                active = (
                    session.revision == door.revision
                    and now - session.last_input_ms < 10_000
                )
            except StructureError:
                active = False
            if not active:
                del self.sessions[door_id]
                await self.notify(
                    session.client,
                    DoorActionResultPacket(
                        type="door_action_result",
                        ok=False,
                        action="keypad_cancel",
                        message="Keypad entry ended.",
                        structureId=session.wall_id,
                        doorId=door_id,
                    ),
                )
        for wall in list(self.structures.structures.values()):
            changed = False
            for door in wall.doors:
                if door.unlockDeadlineMs is not None and now >= door.unlockDeadlineMs:
                    door.isLocked = door.unlockMode == "keypad"
                    door.unlockDeadlineMs = None
                    door.revision += 1
                    changed = True
            if changed:
                await self.publish(wall)
        for key, failures in list(self.failures.items()):
            while failures and failures[0] <= now - 30_000:
                failures.popleft()
            if not failures:
                del self.failures[key]

    async def handle(
        self,
        client: ClientConnection,
        packet: DoorActionPacket,
        *,
        can_edit: Callable[[], bool],
    ) -> DoorActionResultPacket:
        """Validate one action and publish the canonical wall before its result."""

        await self.expire()
        if packet.action in {"add", "update", "remove"}:
            if not can_edit():
                raise StructureError("Not authorized to edit world structures.")
            return await self._edit(packet, can_edit)
        wall, door = self._find(packet.structureId, packet.doorId)
        side = self.structures.door_side(wall, door, client)
        if packet.revision is not None and packet.revision != door.revision:
            raise StructureError("Door changed. Try again.")
        if packet.action == "keypad_cancel":
            session = self.sessions.get(door.id)
            if session is not None and session.client is client:
                del self.sessions[door.id]
            return self._result(packet, "Cancelled.")
        if packet.action == "keypad_digit":
            return await self._digit(client, packet, wall, door)
        if packet.action == "open":
            protected = door.keypadSides in {"both", side}
            if door.isLocked and protected:
                if door.pinRequiredFor in {"both", "unlock"}:
                    return self._begin(client, packet, door, "unlock")
                self._set_lock(door, "unlock")
                await self.publish(wall)
                return self._result(packet, "Unlocked. Press Enter to open.")
            if not door.isOpen:
                door.isOpen = True
                door.revision += 1
                await self.publish(wall)
                await self.sound(wall, door, True)
            return self._result(packet, f"{door.title} open.")
        if packet.action == "close":
            if door.isOpen:
                door.isOpen = False
                door.revision += 1
                await self.publish(wall)
                await self.sound(wall, door, False)
            return self._result(packet, f"{door.title} closed.")
        if packet.action not in {"lock", "unlock", "keypad_begin"}:
            raise StructureError("Unknown door action.")
        action: KeypadAction = (
            packet.keypadAction or "unlock"
            if packet.action == "keypad_begin"
            else "lock"
            if packet.action == "lock"
            else "unlock"
        )
        if action == "lock" and door.isOpen:
            raise StructureError("Close the door before locking it.")
        if door.unlockMode != "keypad" or not door.hasPin:
            raise StructureError("This door has no keypad lock.")
        needs_pin = door.pinRequiredFor in {"both", action}
        if (
            action == "unlock"
            and side not in {door.keypadSides}
            and door.keypadSides != "both"
        ):
            needs_pin = False
        if needs_pin:
            return self._begin(client, packet, door, action)
        if door.isLocked == (action == "lock"):
            return self._result(
                packet, "Already locked." if door.isLocked else "Already unlocked."
            )
        self._set_lock(door, action)
        await self.publish(wall)
        return self._result(
            packet, "Locked." if action == "lock" else "Unlocked. Press Enter to open."
        )

    def _begin(
        self,
        client: ClientConnection,
        packet: DoorActionPacket,
        door: WallDoor,
        action: KeypadAction,
    ) -> DoorActionResultPacket:
        if not self._attempt_allowed(client, door):
            raise StructureError("Too many PIN attempts. Please wait.")
        current = self.sessions.get(door.id)
        if current is not None:
            if current.client is not client:
                raise StructureError("Keypad in use.")
            # Repeated Enter preserves the original inactivity deadline.
            return self._result(packet, "Enter four-digit PIN.", keypad=current.action)
        self.sessions[door.id] = KeypadSession(
            client, packet.structureId, action, door.revision, self.now_ms()
        )
        return self._result(packet, "Enter four-digit PIN.", keypad=action)

    def _attempt_allowed(self, client: ClientConnection, door: WallDoor) -> bool:
        owner_key = f"{door.id}:{client.user_id or client.id}"
        return (
            len(self.failures.get(owner_key, ())) < 5
            and len(self.failures.get(door.id, ())) < 20
        )

    async def _digit(
        self,
        client: ClientConnection,
        packet: DoorActionPacket,
        wall: WallStructure,
        door: WallDoor,
    ) -> DoorActionResultPacket:
        session = self.sessions.get(door.id)
        if session is None or session.client is not client:
            raise StructureError(
                "Start keypad entry first." if session is None else "Keypad in use."
            )
        if (
            packet.digit is None
            or len(packet.digit) != 1
            or packet.digit not in "0123456789"
        ):
            raise StructureError("Enter one digit.")
        session.digits += packet.digit
        session.last_input_ms = self.now_ms()
        if len(session.digits) < 4:
            return self._result(
                packet, f"{len(session.digits)} digits entered.", keypad=session.action
            )
        if not self._attempt_allowed(client, door):
            self.sessions.pop(door.id, None)
            raise StructureError("Too many PIN attempts. Please wait.")
        session.checking = True
        try:
            async with self._hash_slots:
                await asyncio.to_thread(
                    self._hasher.verify,
                    self.structures.door_pins[door.id],
                    session.digits,
                )
        except (VerificationError, KeyError):
            if self.sessions.get(door.id) is session:
                del self.sessions[door.id]
            now = self.now_ms()
            for key in (door.id, f"{door.id}:{client.user_id or client.id}"):
                self.failures.setdefault(key, deque()).append(now)
            raise StructureError("Incorrect PIN.") from None
        if (
            self.sessions.get(door.id) is not session
            or self.structures.structures.get(wall.id) is not wall
            or door.revision != session.revision
            or not client.authenticated
            or not client.world_ready
        ):
            raise StructureError("Door or keypad session changed. Try again.")
        self.sessions.pop(door.id, None)
        self.structures.door_side(wall, door, client)
        if session.action == "lock" and door.isOpen:
            raise StructureError("Close the door before locking it.")
        self._set_lock(door, session.action)
        await self.publish(wall)
        return self._result(
            packet,
            "Locked." if session.action == "lock" else "Unlocked. Press Enter to open.",
        )

    def _set_lock(self, door: WallDoor, action: KeypadAction) -> None:
        door.isLocked = action == "lock"
        door.unlockDeadlineMs = (
            self.now_ms() + door.unlockTimeoutSeconds * 1000
            if action == "unlock" and door.unlockTimeoutSeconds > 0
            else None
        )
        door.revision += 1

    async def _edit(
        self, packet: DoorActionPacket, can_edit: Callable[[], bool]
    ) -> DoorActionResultPacket:
        wall = self.structures.structures.get(packet.structureId)
        if wall is None:
            raise StructureError("Wall not found.")
        before = wall.model_dump()
        updated = wall.model_copy(deep=True)
        if packet.action == "add":
            if packet.offset is None:
                raise StructureError("Choose a wall edge for the door.")
            door = WallDoor(
                id=str(uuid.uuid4()), offset=packet.offset, title=packet.title or "Door"
            )
            updated.doors.append(door)
        else:
            _, original = self._find(wall.id, packet.doorId)
            if packet.revision is not None and packet.revision != original.revision:
                raise StructureError("Door changed. Try again.")
            door = next(door for door in updated.doors if door.id == packet.doorId)
        if packet.action == "remove":
            updated.doors.remove(door)
        else:
            if packet.pin is not None and (
                packet.pin
                and (
                    len(packet.pin) != 4
                    or any(digit not in "0123456789" for digit in packet.pin)
                )
            ):
                raise StructureError("A PIN must contain exactly four digits.")
            for name in (
                "title",
                "unlockMode",
                "keypadSides",
                "pinRequiredFor",
                "unlockTimeoutSeconds",
            ):
                value = getattr(packet, name)
                if value is not None:
                    setattr(door, name, value)
            if packet.pin is not None:
                door.hasPin = bool(packet.pin)
                door.unlockMode = "keypad" if packet.pin else "none"
            if door.unlockMode == "keypad" and not door.hasPin:
                raise StructureError(
                    "Set a four-digit PIN before enabling keypad mode."
                )
            if door.unlockMode == "none":
                door.isLocked = False
                door.unlockDeadlineMs = None
            elif (
                door.unlockDeadlineMs is not None
                and packet.unlockTimeoutSeconds is not None
            ):
                door.unlockDeadlineMs = (
                    self.now_ms() + door.unlockTimeoutSeconds * 1000
                    if door.unlockTimeoutSeconds
                    else None
                )
            door.revision += 1
        self.structures.validate_doors(updated)
        verifier = None
        if packet.pin:
            async with self._hash_slots:
                verifier = await asyncio.to_thread(self._hasher.hash, packet.pin)
        current = self.structures.structures.get(wall.id)
        if not can_edit() or current is not wall or wall.model_dump() != before:
            raise StructureError("Wall or permission changed. Try again.")
        if packet.action == "remove":
            self.structures.door_pins.pop(door.id, None)
        elif packet.pin is not None:
            if packet.pin:
                self.structures.door_pins[door.id] = str(verifier)
            else:
                self.structures.door_pins.pop(door.id, None)
        self.sessions.pop(door.id, None)
        self.structures.structures[wall.id] = updated
        await self.publish(updated)
        result = self._result(
            packet, "Door removed." if packet.action == "remove" else "Door saved."
        )
        result.doorId = door.id
        return result
