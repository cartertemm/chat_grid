"""Elevator item static metadata and defaults."""

from __future__ import annotations

from ...emit_validation import EMIT_EFFECT_OPTIONS

LABEL = "elevator"
TOOLTIP = "An elevator with configurable stops, a shared shaft and timed doors."
EDITABLE_PROPERTIES: tuple[str, ...] = (
    "title",
    "floorZs",
    "doorOpenSeconds",
    "speed",
    "directional",
    "facing",
    "emitRange",
    "emitVolume",
    "emitSoundSpeed",
    "emitSoundTempo",
    "emitInitialDelay",
    "emitLoopDelay",
    "emitEffect",
    "emitEffectValue",
    "emitSound",
)
CAPABILITIES: tuple[str, ...] = ("editable", "deletable", "usable")
USE_SOUND: str | None = None
EMIT_SOUND: str | None = None
USE_COOLDOWN_MS = 500
EMIT_RANGE = 15
DIRECTIONAL = False
OCCUPIED_OFFSETS: tuple[tuple[int, int], ...] = ((0, 0),)
DEFAULT_TITLE = "Elevator"
DEFAULT_PARAMS: dict = {
    "floorZs": [0, 40],
    "currentZ": 0,
    "targetZ": None,
    "requestedZs": [],
    "state": "idle",
    "doorOpen": False,
    "doorOpenSeconds": 5,
    "speed": 10,
    "directional": False,
    "facing": 0,
    "emitRange": 15,
    "emitVolume": 100,
    "emitSoundSpeed": 50,
    "emitSoundTempo": 50,
    "emitInitialDelay": 0,
    "emitLoopDelay": 0,
    "emitEffect": "off",
    "emitEffectValue": 50,
    "emitSound": "",
}
PARAM_KEYS: tuple[str, ...] = (
    "floorZs",
    "currentZ",
    "targetZ",
    "requestedZs",
    "state",
    "doorOpen",
    "doorOpenSeconds",
    "speed",
    "directional",
    "facing",
    "emitRange",
    "emitVolume",
    "emitSoundSpeed",
    "emitSoundTempo",
    "emitInitialDelay",
    "emitLoopDelay",
    "emitEffect",
    "emitEffectValue",
    "emitSound",
)

PROPERTY_METADATA: dict[str, dict[str, object]] = {
    "title": {
        "valueType": "text",
        "tooltip": "Display name spoken and shown for this elevator.",
        "maxLength": 80,
    },
    "currentZ": {
        "valueType": "number",
        "label": "Current Z",
        "tooltip": "Current elevator car elevation.",
    },
    "floorZs": {
        "valueType": "text",
        "label": "Stops",
        "tooltip": "Comma-delimited stop elevations, for example 0,40. Use at least two distinct signed integers.",
        "maxLength": 1000,
    },
    "targetZ": {
        "valueType": "text",
        "label": "Target Z",
        "tooltip": "Destination elevation while the elevator is moving.",
    },
    "requestedZs": {
        "valueType": "text",
        "label": "Queued stops",
        "tooltip": "Requested stops waiting for the current trip to finish.",
    },
    "state": {
        "valueType": "text",
        "label": "State",
        "tooltip": "Current elevator movement or door state.",
    },
    "doorOpen": {
        "valueType": "boolean",
        "label": "Door open",
        "tooltip": "Whether the elevator door is open.",
    },
    "doorOpenSeconds": {
        "valueType": "number",
        "label": "Door open seconds",
        "tooltip": "Seconds the door remains fully open after its opening sound finishes.",
        "range": {"min": 0, "max": 300, "step": 0.1},
    },
    "speed": {
        "valueType": "number",
        "label": "Speed",
        "tooltip": "Vertical Z units traveled per second.",
        "range": {"min": 0.1, "max": 1000, "step": 0.1},
    },
    "directional": {
        "valueType": "boolean",
        "tooltip": "If on, emitted sound favors the elevator's facing direction.",
    },
    "facing": {
        "valueType": "number",
        "tooltip": "Facing direction in degrees used when directional sound is on.",
        "range": {"min": 0, "max": 360, "step": 1},
        "visibleWhen": {"directional": True},
    },
    "emitRange": {
        "valueType": "number",
        "tooltip": "Maximum distance in squares for the elevator's emitted sound.",
        "range": {"min": 1, "max": 20, "step": 1},
    },
    "emitVolume": {
        "valueType": "number",
        "tooltip": "Elevator emitted sound volume percent.",
        "range": {"min": 0, "max": 100, "step": 1},
    },
    "emitSoundSpeed": {
        "valueType": "number",
        "tooltip": "Playback speed and pitch. 50 is normal, 0 is half, and 100 is double.",
        "range": {"min": 0, "max": 100, "step": 0.1},
    },
    "emitSoundTempo": {
        "valueType": "number",
        "tooltip": "Playback tempo. 50 is normal, 0 is half, and 100 is double.",
        "range": {"min": 0, "max": 100, "step": 0.1},
    },
    "emitInitialDelay": {
        "valueType": "number",
        "tooltip": "Delay in seconds before emitted audio starts.",
        "range": {"min": 0, "max": 300, "step": 0.1},
    },
    "emitLoopDelay": {
        "valueType": "number",
        "tooltip": "Delay in seconds between each playing of the emitted audio.",
        "range": {"min": 0, "max": 300, "step": 0.1},
    },
    "emitEffect": {
        "valueType": "list",
        "tooltip": "Effect applied to the elevator's emitted sound.",
        "options": list(EMIT_EFFECT_OPTIONS),
    },
    "emitEffectValue": {
        "valueType": "number",
        "tooltip": "Amount of the selected emitted sound effect.",
        "range": {"min": 0, "max": 100, "step": 0.1},
    },
    "emitSound": {
        "valueType": "sound",
        "label": "Emitted sound",
        "tooltip": "Looping sound emitted by the elevator car. Filename assumes sounds folder, or use a full URL.",
        "maxLength": 2048,
    },
}
