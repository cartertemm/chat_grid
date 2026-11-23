import { handleMenuRowKey } from './listController';
import { nearbyWalls, wallEdgeAnchor } from '../state/structureGeometry';
import type { GameState, StructurePreset, WallStructure } from '../state/gameState';
import type { OutgoingMessage } from '../network/protocol';
import { getEditSessionAction } from './editSession';
import { formatSteppedNumber } from './numeric';
import type { OptionSelectorRequest } from './optionSelector';
import type { ConfirmationRequest } from './confirmationController';
import {
  adjustPropertyValue,
  applyNumericPropertyKey,
  announcePropertyValue,
  describePropertyHelp,
  formatPropertyRow,
  getPropertyOptions,
  validateNumericPropertyInput,
  type PropertyControlMetadata,
} from './propertyControls';
import { createCheckpointController } from './checkpointController';
import { createRegionBuilderController } from './regionBuilderController';
import { createPlatformBuilderController } from './platformBuilderController';
import type { FootstepSet } from '../state/platformGeometry';
import { createAmbianceBuilderController } from './ambianceBuilderController';
import type { AmbianceType } from '../state/gameState';

type MenuEntry<T extends string = string> = { id: T; label: string; tooltip?: string };

export type WorldBuilderDeps = {
  editDoors?: (wall: WallStructure, back: () => void) => void;
  state: GameState;
  hasPermission: (key: string) => boolean;
  send: (message: OutgoingMessage) => void;
  updateStatus: (message: string) => void;
  announceMenuEntry: (menu: string, option: string) => void;
  blip: () => void;
  confirm: () => void;
  cancel: () => void;
  applyTextInputEdit: (code: string, key: string, maxLength: number, ctrlKey?: boolean, allowReplaceOnNextType?: boolean) => void;
  setReplaceTextOnNextType: (value: boolean) => void;
  openOptionSelector: (request: OptionSelectorRequest) => void;
  openConfirmation: (request: ConfirmationRequest) => void;
};

const ROOT_ACTIONS = [
  { id: 'add', label: 'Add wall', tooltip: 'Create a one-square wall beside your current position.' },
  { id: 'edit', label: 'Edit walls', tooltip: 'Choose a wall on this floor to resize, edit, or delete.' },
  { id: 'addAmbiance', label: 'Add ambiance', tooltip: 'Create a one-square ambiance at your current position.' },
  { id: 'editAmbiances', label: 'Edit ambiances', tooltip: 'Choose an ambiance on this floor to resize, edit, or delete.' },
  { id: 'addRegion', label: 'Add region', tooltip: 'Create a one-square named region at your current position.' },
  { id: 'editRegions', label: 'Edit regions', tooltip: 'Choose a named region on this floor to edit.' },
  { id: 'checkpoints', label: 'World checkpoints', tooltip: 'Save the authored world, preview checkpoints, or restore one.' },
  { id: 'platforms', label: 'Platforms', tooltip: 'Create or edit flat platforms, including disconnected islands.' },
] as const;
const DIRECTIONS = [
  { id: 'north', label: 'North', tooltip: 'Place the wall along the north edge of your current square.' },
  { id: 'south', label: 'South', tooltip: 'Place the wall along the south edge of your current square.' },
  { id: 'east', label: 'East', tooltip: 'Place the wall along the east edge of your current square.' },
  { id: 'west', label: 'West', tooltip: 'Place the wall along the west edge of your current square.' },
] as const;
const WALL_ACTIONS = [
  { id: 'type', label: 'Type', tooltip: 'Choose a wall type and reset all wall properties to that type’s defaults.' },
  { id: 'orientation', label: 'Orientation', tooltip: 'Choose horizontal or vertical. Rotation keeps the start coordinate fixed and succeeds only if the run fits.' },
  { id: 'setStart', label: 'Set start edge', tooltip: 'Use Left or Right to decrease or increase the first occupied edge coordinate by one square.' },
  { id: 'setEnd', label: 'Set end edge', tooltip: 'Use Left or Right to decrease or increase the last occupied edge coordinate by one square.' },
  { id: 'slide', label: 'Slide', tooltip: 'Use Left or Right to move the complete wall perpendicular to its run by one square.' },
  { id: 'properties', label: 'Edit properties', tooltip: 'Edit the wall’s sound transmission, filtering, or contact sound.' },
  { id: 'doors', label: 'Doors', tooltip: 'Manage doors along this wall.' },
  { id: 'delete', label: 'Delete wall', tooltip: 'Delete this entire wall run.' },
] as const;
const PROPERTY_ACTIONS = [
  { id: 'soundTransmission', label: 'Sound transmission' },
  { id: 'occlusionLowpassHz', label: 'Occlusion low-pass' },
  { id: 'contactSound', label: 'Contact sound' },
] as const;
type PropertyId = typeof PROPERTY_ACTIONS[number]['id'];

const NUMERIC_PROPERTIES = {
  soundTransmission: { min: 0, max: 1, step: 0.05, anchor: 0 },
  occlusionLowpassHz: { min: 20, max: 20_000, step: 100, anchor: 0 },
} as const;
const ORIENTATION_METADATA: PropertyControlMetadata = {
  valueType: 'list',
  tooltip: 'Set the wall run direction. Rotation keeps the start coordinate fixed and succeeds only if the run fits.',
  options: [
    { id: 'horizontal', label: 'Horizontal' },
    { id: 'vertical', label: 'Vertical' },
  ],
};

function typeMetadata(presets: StructurePreset[]): PropertyControlMetadata {
  return {
    valueType: 'list',
    tooltip: 'Choose a wall type and reset all wall properties to that type’s defaults.',
    options: presets.map((preset) => ({ id: preset.id, label: preset.title })),
  };
}

function propertyMetadata(property: PropertyId): PropertyControlMetadata {
  if (property === 'soundTransmission') {
    return {
      valueType: 'number',
      tooltip: 'Set how much sound passes through the wall, from silent to unchanged.',
      range: NUMERIC_PROPERTIES.soundTransmission,
    };
  }
  if (property === 'occlusionLowpassHz') {
    return {
      valueType: 'number',
      tooltip: 'Set the highest frequency that passes through the wall.',
      range: NUMERIC_PROPERTIES.occlusionLowpassHz,
    };
  }
  return {
    valueType: 'sound',
    tooltip: 'Set the sound played when someone hits or passes through the wall.',
    maxLength: 200,
  };
}

/** Create the accessible menu controller for live wall editing. */
export function createWorldBuilderController(deps: WorldBuilderDeps) {
  let presets: StructurePreset[] = [];
  let index = 0;
  let selectedPreset: StructurePreset | null = null;
  let walls: WallStructure[] = [];
  let selectedWallId: string | null = null;
  let editingProperty: PropertyId | null = null;
  const pendingSettings: {
    action: 'update' | 'rotate';
    structureId: string;
    property: PropertyId | 'preset' | 'orientation';
    value: string | number;
  }[] = [];

  function sendSetting(
    wall: WallStructure,
    property: PropertyId | 'preset' | 'orientation',
    value: string | number,
  ): void {
    const action = property === 'orientation' ? 'rotate' : 'update';
    pendingSettings.push({ action, structureId: wall.id, property, value });
    if (property === 'orientation') {
      deps.send({ type: 'structure_rotate_wall', structureId: wall.id, orientation: value as WallStructure['orientation'] });
    } else {
      deps.send({ type: 'structure_update_wall', structureId: wall.id, [property]: value });
    }
  }
  const checkpointController = createCheckpointController(deps, open);
  const regionBuilderController = createRegionBuilderController(deps, open);
  const platformBuilderController = createPlatformBuilderController(deps, open);
  const ambianceBuilderController = createAmbianceBuilderController({
    ...deps,
    onBackToRoot: () => open(),
  });

  function selectedWall(): WallStructure | null {
    const canonical = selectedWallId ? deps.state.structures.get(selectedWallId) : undefined;
    if (!canonical) return null;
    const preview = { ...canonical };
    for (const setting of pendingSettings) {
      if (setting.structureId !== canonical.id) continue;
      if (setting.property === 'preset') {
        const preset = presets.find((entry) => entry.id === setting.value);
        if (preset) Object.assign(preview, preset, { id: canonical.id, preset: preset.id });
      } else Object.assign(preview, { [setting.property]: setting.value });
    }
    return preview;
  }

  function wallLabel(wall: WallStructure): string {
    return `${wall.title}, ${wall.length} squares, ${wall.orientation}, start ${wall.startX}, ${wall.startY}`;
  }

  function wallActionEntries(wall: WallStructure | null): MenuEntry<typeof WALL_ACTIONS[number]['id']>[] {
    return WALL_ACTIONS.map((entry) => {
      if (!wall) return entry;
      if (entry.id === 'type') {
        const typeTitle = presets.find((preset) => preset.id === wall.preset)?.title ?? wall.title;
        return { ...entry, label: formatPropertyRow(entry.label, typeTitle) };
      }
      if (entry.id === 'setStart' || entry.id === 'setEnd') {
        const endpoint = entry.id === 'setStart' ? 'start' : 'end';
        return { ...entry, label: formatPropertyRow(entry.label, wallEdgeAnchor(wall, endpoint).join(', ')) };
      }
      if (entry.id === 'slide') {
        const horizontal = wall.orientation === 'horizontal';
        return {
          ...entry,
          label: formatPropertyRow(`Slide ${horizontal ? 'vertically' : 'horizontally'}`, horizontal ? wall.startY : wall.startX),
        };
      }
      if (entry.id === 'orientation') {
        const orientation = wall.orientation === 'horizontal' ? 'Horizontal' : 'Vertical';
        return { ...entry, label: formatPropertyRow(entry.label, orientation) };
      }
      return entry;
    });
  }

  function propertyEntries(wall: WallStructure | null): MenuEntry<PropertyId>[] {
    return PROPERTY_ACTIONS.map((entry) => {
      if (!wall) return entry;
      if (entry.id === 'soundTransmission') {
        return { ...entry, label: formatPropertyRow(entry.label, formatSteppedNumber(wall.soundTransmission, 0.05)) };
      }
      if (entry.id === 'occlusionLowpassHz') {
        return { ...entry, label: formatPropertyRow(entry.label, `${wall.occlusionLowpassHz} hertz`) };
      }
      return { ...entry, label: formatPropertyRow(entry.label, wall.contactSound || 'none') };
    });
  }

  function rootActions() {
    return ROOT_ACTIONS.filter((entry) => entry.id === 'checkpoints'
      ? deps.hasPermission('world.checkpoint.capture') || deps.hasPermission('world.checkpoint.view')
      : entry.id === 'platforms' ? deps.hasPermission('world.platform.edit')
      : deps.hasPermission('world.structure.edit'));
  }

  function open(): void {
    if (!rootActions().length) {
      deps.updateStatus('World Builder permission required.');
      deps.cancel();
      return;
    }
    index = 0;
    deps.state.mode = 'worldBuilder';
    deps.announceMenuEntry('World Builder', rootActions()[index].label);
  }

  function openWallActions(wall: WallStructure): void {
    selectedWallId = wall.id;
    index = 0;
    deps.state.mode = 'worldBuilderWallActions';
    deps.announceMenuEntry(wall.title, wallActionEntries(wall)[0].label);
  }

  function openWallList(): void {
    walls = nearbyWalls(
      deps.state.structures.values(),
      deps.state.player.x,
      deps.state.player.y,
      deps.state.player.z,
    );
    if (walls.length === 0) {
      open();
      return;
    }
    index = 0;
    deps.state.mode = 'worldBuilderWallList';
    deps.announceMenuEntry('Walls', wallLabel(walls[0]));
  }

  function handleList<T extends string>(
    code: string,
    key: string,
    entries: readonly MenuEntry<T>[],
    onSelect: (entry: T) => void,
    menu: string,
    onCancel: () => void,
    tooltip: (entry: MenuEntry<T>) => string | undefined = (entry) => entry.tooltip,
  ): void {
    const control = handleMenuRowKey(code, key, entries, index, {
      label: (entry) => entry.label, tooltip, updateStatus: deps.updateStatus, blip: deps.blip,
    });
    if (control.type === 'move') {
      index = control.index;
    } else if (control.type === 'select') {
      onSelect(entries[index].id);
    } else if (control.type === 'cancel') {
      onCancel();
      deps.cancel();
    }
  }

  function handleRoot(code: string, key: string): void {
    index = Math.min(index, Math.max(0, rootActions().length - 1));
    handleList(code, key, rootActions(), (entry) => {
      if (entry === 'checkpoints') { checkpointController.open(); return; }
      if (entry === 'platforms') { platformBuilderController.openList(); return; }
      if (entry === 'addRegion') {
        regionBuilderController.requestAdd();
        return;
      }
      if (entry === 'editRegions') {
        regionBuilderController.openList();
        return;
      }
      if (entry === 'add') {
        if (presets.length === 0) {
          deps.updateStatus('No wall presets are configured.');
          deps.cancel();
          return;
        }
        index = 0;
        deps.state.mode = 'worldBuilderPreset';
        deps.announceMenuEntry('Wall presets', presets[0].title);
        return;
      }
      if (entry === 'addAmbiance') {
        ambianceBuilderController.requestAdd();
        return;
      }
      if (entry === 'editAmbiances') {
        ambianceBuilderController.openList();
        return;
      }
      walls = nearbyWalls(deps.state.structures.values(), deps.state.player.x, deps.state.player.y, deps.state.player.z);
      if (walls.length === 0) {
        deps.updateStatus('No walls on this floor.');
        deps.cancel();
        return;
      }
      index = 0;
      deps.state.mode = 'worldBuilderWallList';
      deps.announceMenuEntry('Walls', wallLabel(walls[0]));
    }, 'World Builder', () => { deps.state.mode = 'normal'; });
  }

  function handlePreset(code: string, key: string): void {
    const entries = presets.map((preset) => ({
      id: preset.id,
      label: preset.title,
      tooltip: `${preset.title}: ${preset.movementBlocked ? 'blocks movement' : 'can be passed through'}, ${Math.round(preset.soundTransmission * 100)} percent sound transmission, ${preset.occlusionLowpassHz} hertz low-pass.`,
    }));
    handleList(code, key, entries, (_entry) => {
      selectedPreset = presets[index];
      index = 0;
      deps.state.mode = 'worldBuilderDirection';
      deps.announceMenuEntry('Wall side', DIRECTIONS[0].label);
    }, 'Wall presets', () => open());
  }

  function handleDirection(code: string, key: string): void {
    handleList(code, key, DIRECTIONS, (direction) => {
      if (!selectedPreset) return;
      deps.send({ type: 'structure_add_wall', preset: selectedPreset.id, direction });
      deps.state.mode = 'normal';
    }, 'Wall side', () => {
      index = 0;
      deps.state.mode = 'worldBuilderPreset';
      deps.announceMenuEntry('Wall presets', presets[0]?.title ?? 'No presets');
    });
  }

  function handleWallList(code: string, key: string): void {
    const entries = walls.map((wall) => ({ id: wall.id, label: wallLabel(wall), tooltip: `${wallLabel(wall)}. ${Math.round(wall.soundTransmission * 100)} percent sound transmission, ${wall.occlusionLowpassHz} hertz low-pass.` }));
    handleList(code, key, entries, () => {
      openWallActions(walls[index]);
    }, 'Walls', () => open());
  }

  function handleWallActions(code: string, key: string): void {
    const wall = selectedWall();
    const entries = wallActionEntries(wall);
    const currentAction = entries[index]?.id;
    if (
      wall
      && (currentAction === 'setStart' || currentAction === 'setEnd')
      && (code === 'ArrowLeft' || code === 'ArrowRight')
    ) {
      deps.send({
        type: 'structure_resize_wall',
        structureId: wall.id,
        endpoint: currentAction === 'setStart' ? 'start' : 'end',
        delta: code === 'ArrowLeft' ? -1 : 1,
      });
      return;
    }
    if (wall && currentAction === 'slide' && (code === 'ArrowLeft' || code === 'ArrowRight')) {
      deps.send({
        type: 'structure_slide_wall',
        structureId: wall.id,
        delta: code === 'ArrowLeft' ? -1 : 1,
      });
      return;
    }
    if (wall && currentAction === 'type') {
      const adjustment = adjustPropertyValue(code, wall.preset, typeMetadata(presets));
      if (adjustment) {
        const nextPreset = presets.find((preset) => preset.id === adjustment.value);
        if (!nextPreset) return;
        sendSetting(wall, 'preset', nextPreset.id);
        return;
      }
    }
    if (wall && currentAction === 'orientation') {
      const adjustment = adjustPropertyValue(code, wall.orientation, ORIENTATION_METADATA);
      if (adjustment) {
        sendSetting(wall, 'orientation', String(adjustment.value));
        return;
      }
    }
    handleList(code, key, entries, (action) => {
      const wall = selectedWall();
      if (!wall) {
        deps.updateStatus('Wall no longer exists.');
        deps.state.mode = 'normal';
        deps.cancel();
        return;
      }
      if (action === 'doors') {
        deps.editDoors?.(wall, () => {
          const current = selectedWall();
          if (current) openWallActions(current);
          else openWallList();
        });
        return;
      }
      if (action === 'properties') {
        index = 0;
        deps.state.mode = 'worldBuilderPropertyList';
        deps.announceMenuEntry(`${wall.title} properties`, PROPERTY_ACTIONS[0].label);
        return;
      }
      if (action === 'type') {
        if (presets.length === 0) {
          deps.updateStatus('No wall presets are configured.');
          deps.cancel();
          return;
        }
        deps.openOptionSelector({
          title: 'Wall type',
          options: getPropertyOptions(typeMetadata(presets)),
          selectedId: wall.preset,
          propertyHelp: () => describePropertyHelp('Type', typeMetadata(presets), true),
          onSelect: (preset) => {
            sendSetting(wall, 'preset', preset);
            deps.state.mode = 'worldBuilderWallActions';
          },
          onCancel: () => {
            deps.state.mode = 'worldBuilderWallActions';
            deps.announceMenuEntry('Wall actions', wallActionEntries(selectedWall())[index].label);
          },
        });
        return;
      }
      if (action === 'delete') {
        deps.openConfirmation({
          prompt: `Delete ${wall.title}${wall.doors?.length ? " and its " + wall.doors.length + " attached doors" : ""}?`,
          onConfirm: () => {
            deps.send({ type: 'structure_delete', structureId: wall.id });
            deps.state.mode = 'normal';
          },
          onCancel: () => {
            index = 0;
            deps.state.mode = 'worldBuilderWallActions';
            deps.announceMenuEntry('Wall actions', WALL_ACTIONS[0].label);
          },
        });
        return;
      }
      if (action === 'orientation') {
        deps.openOptionSelector({
          title: 'Orientation',
          options: getPropertyOptions(ORIENTATION_METADATA),
          selectedId: wall.orientation,
          propertyHelp: () => describePropertyHelp('Orientation', ORIENTATION_METADATA, true),
          onSelect: (orientation) => {
            sendSetting(wall, 'orientation', orientation);
            deps.state.mode = 'worldBuilderWallActions';
          },
          onCancel: () => {
            deps.state.mode = 'worldBuilderWallActions';
            deps.announceMenuEntry('Wall actions', wallActionEntries(selectedWall())[index].label);
          },
        });
        return;
      }
      deps.updateStatus(entries[index].tooltip ?? 'No tooltip available.');
    }, 'Wall actions', openWallList, (entry) => {
      if (entry.id === 'type') return describePropertyHelp('Type', typeMetadata(presets), true);
      if (entry.id === 'orientation') return describePropertyHelp('Orientation', ORIENTATION_METADATA, true);
      return entry.tooltip;
    });
  }

  function handlePropertyList(code: string, key: string): void {
    const entries = propertyEntries(selectedWall());
    const property = PROPERTY_ACTIONS[index]?.id;
    if (property && ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(code)) {
      const wall = selectedWall();
      if (!wall) return;
      const currentValue = wall[property];
      const adjustment = adjustPropertyValue(code, currentValue, propertyMetadata(property));
      if (adjustment) {
        if (property === 'soundTransmission' || property === 'occlusionLowpassHz') {
          const nextValue = Number(adjustment.value);
          if (nextValue !== wall[property]) {
            sendSetting(wall, property, nextValue);
            return;
          }
        }
        announcePropertyValue(deps.updateStatus, adjustment.value, propertyMetadata(property));
        deps.cancel();
        return;
      }
    }
    handleList(code, key, entries, (property) => {
      const wall = selectedWall();
      if (!wall) return;
      editingProperty = property;
      deps.state.nicknameInput = String(wall[property]);
      deps.state.cursorPos = deps.state.nicknameInput.length;
      deps.setReplaceTextOnNextType(true);
      deps.state.mode = 'worldBuilderPropertyEdit';
      deps.updateStatus(`Edit ${PROPERTY_ACTIONS[index].label}: ${deps.state.nicknameInput}`);
    }, 'Wall properties', () => {
      index = 0;
      deps.state.mode = 'worldBuilderWallActions';
      deps.announceMenuEntry('Wall actions', WALL_ACTIONS[0].label);
    }, (entry) => describePropertyHelp(entry.label, propertyMetadata(entry.id), true));
  }

  function handlePropertyEdit(code: string, key: string, ctrlKey = false): void {
    if (editingProperty) {
      const wall = selectedWall();
      if (!wall) return;
      if (applyNumericPropertyKey(code, deps.state, propertyMetadata(editingProperty), {
        setReplaceTextOnNextType: deps.setReplaceTextOnNextType,
        updateStatus: deps.updateStatus,
        cue: (success) => success ? deps.blip() : deps.cancel(),
      }, wall[editingProperty])) return;
    }
    const action = getEditSessionAction(code);
    if (action === 'cancel') {
      index = 0;
      deps.state.mode = 'worldBuilderPropertyList';
      deps.announceMenuEntry('Wall properties', PROPERTY_ACTIONS[0].label);
      deps.cancel();
      return;
    }
    if (action === 'submit') {
      const wall = selectedWall();
      if (!wall || !editingProperty) return;
      const raw = deps.state.nicknameInput.trim();
      let value: number | string = raw;
      if (editingProperty === 'soundTransmission' || editingProperty === 'occlusionLowpassHz') {
        const label = PROPERTY_ACTIONS.find((entry) => entry.id === editingProperty)?.label ?? editingProperty;
        const parsed = validateNumericPropertyInput(
          label,
          raw,
          propertyMetadata(editingProperty),
          editingProperty === 'occlusionLowpassHz',
        );
        if (!parsed.ok) {
          deps.updateStatus(parsed.message);
          deps.cancel();
          return;
        }
        value = parsed.value;
      }
      sendSetting(wall, editingProperty, value);
      deps.state.mode = 'worldBuilderPropertyList';
      return;
    }
    deps.applyTextInputEdit(code, key, editingProperty === 'contactSound' ? 200 : 10, ctrlKey, true);
  }

  return {
    setPresets(next: StructurePreset[]) {
      platformBuilderController.reset();
      presets = [...next];
      pendingSettings.length = 0;
    },
    getEditingPropertyLabel() {
      return PROPERTY_ACTIONS.find((entry) => entry.id === editingProperty)?.label ?? 'Wall property';
    },
    setAmbianceTypes(next: AmbianceType[]) {
      ambianceBuilderController.setTypes(next);
    },
    setFootstepSets: (next: FootstepSet[]) => platformBuilderController.setFootstepSets(next),
    open,
    handleRoot,
    handleCheckpointInput: checkpointController.handleInput,
    handleCheckpointResult: checkpointController.result,
    handlePreset,
    handleDirection,
    handleWallList,
    handleWallActions,
    handlePropertyList,
    handlePropertyEdit,
    handleRegionList: regionBuilderController.handleList,
    handlePlatformList: platformBuilderController.handleList,
    handlePlatformActions: platformBuilderController.handleActions,
    handlePlatformEdit: platformBuilderController.handleEdit,
    handlePlatformActionResult: platformBuilderController.handleActionResult,
    resetPlatformEditor: platformBuilderController.reset,
    reconcilePlatforms: platformBuilderController.reconcileWorld,
    getEditingPlatformMaxLength: platformBuilderController.getEditingMaxLength,
    getPlatformTextEntry: platformBuilderController.getTextEntry,
    handleRegionActions: regionBuilderController.handleActions,
    handleRegionEdit: regionBuilderController.handleEdit,
    handleRegionActionResult: regionBuilderController.handleActionResult,
    handleAmbianceList: ambianceBuilderController.handleList,
    handleAmbianceActions: ambianceBuilderController.handleActions,
    handleAmbianceEdit: ambianceBuilderController.handleEdit,
    getEditingAmbiancePropertyLabel: ambianceBuilderController.getEditingPropertyLabel,
    handleActionResult(message: {
      ok: boolean;
      action: 'add' | 'resize' | 'slide' | 'rotate' | 'update' | 'delete';
      message: string;
      structureId?: string | null;
    }) {
      const pendingIndex = pendingSettings.findIndex((setting) => setting.action === message.action
        && (!message.structureId || setting.structureId === message.structureId));
      if (pendingIndex >= 0) pendingSettings.splice(pendingIndex, 1);
      if (!message.ok) {
        deps.updateStatus(message.message);
        deps.cancel();
        return;
      }
      announcePropertyValue(deps.updateStatus, message.message);
      deps.confirm();
      if (message.action === 'add' && message.structureId) {
        const wall = deps.state.structures.get(message.structureId);
        if (wall) openWallActions(wall);
      }
    },
    handleAmbianceActionResult(message: {
      ok: boolean;
      action: 'add' | 'resize' | 'slide' | 'update' | 'delete';
      message: string;
      ambianceId?: string | null;
    }) {
      ambianceBuilderController.handleActionResult(message);
    },
  };
}
