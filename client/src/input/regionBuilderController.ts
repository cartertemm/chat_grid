import { handleMenuRowKey } from './listController';
import { getEditSessionAction } from './editSession';
import { coordinateMetadata } from './coordinateControls';
import { describePropertyHelp, formatPropertyRow } from './propertyControls';
import type { NamedRegion } from '../state/gameState';
import { containingRegions } from '../state/regions';
import type { WorldBuilderDeps } from './worldBuilderController';

const ACTIONS = [
  { id: 'name', label: 'Name', tooltip: 'Set the name announced when someone checks their region.' },
  { id: 'startX', label: 'Start X', tooltip: 'Move the west edge by one square with Left or Right.' },
  { id: 'startY', label: 'Start Y', tooltip: 'Move the south edge by one square with Left or Right.' },
  { id: 'endX', label: 'End X', tooltip: 'Move the east edge by one square with Left or Right.' },
  { id: 'endY', label: 'End Y', tooltip: 'Move the north edge by one square with Left or Right.' },
  { id: 'slideX', label: 'Slide X', tooltip: 'Move the whole rectangle along X by one square with Left or Right.' },
  { id: 'slideY', label: 'Slide Y', tooltip: 'Move the whole rectangle along Y by one square with Left or Right.' },
  { id: 'delete', label: 'Delete region', tooltip: 'Delete this named region after confirmation.' },
] as const;
type Action = typeof ACTIONS[number]['id'];
const EDGES = { startX: 'west', endX: 'east', startY: 'south', endY: 'north' } as const;

/** Build the existing accessible menu and text flows for named rectangles. */
export function createRegionBuilderController(deps: WorldBuilderDeps, onBack: () => void) {
  let index = 0;
  let selectedId: string | null = null;
  let regions: NamedRegion[] = [];

  function allowed(): boolean {
    if (deps.hasPermission('world.structure.edit')) return true;
    deps.state.mode = 'normal';
    deps.updateStatus('World Builder permission required.');
    deps.cancel();
    return false;
  }

  function requestAdd(): void {
    if (!allowed()) return;
    deps.send({ type: 'region_add' });
    deps.state.mode = 'normal';
  }

  function current(): NamedRegion | null {
    const region = selectedId ? deps.state.regions.get(selectedId) : undefined;
    if (region) return region;
    onBack();
    deps.updateStatus('Region no longer exists.');
    deps.cancel();
    return null;
  }

  function openActions(region: NamedRegion): void {
    selectedId = region.id;
    index = 0;
    deps.state.mode = 'worldBuilderRegionActions';
    deps.announceMenuEntry(region.name, formatPropertyRow('Name', region.name));
  }

  function label(region: NamedRegion): string {
    return `${region.name}, ${region.startX}, ${region.startY} to ${region.endX}, ${region.endY}`;
  }

  function openList(): void {
    if (!allowed()) return;
    const player = deps.state.player;
    const containing = new Set(containingRegions(deps.state.regions.values(), player).map((region) => region.id));
    regions = [...deps.state.regions.values()]
      .filter((region) => region.floorZ === player.z)
      .sort((left, right) => Number(containing.has(right.id)) - Number(containing.has(left.id))
        || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    if (!regions.length) {
      onBack();
      deps.updateStatus('No regions on this floor.');
      return;
    }
    index = 0;
    deps.state.mode = 'worldBuilderRegionList';
    deps.announceMenuEntry('Regions', label(regions[0]));
  }

  function handleMenu<T extends { label: string }>(
    code: string, key: string, entries: readonly T[], select: (entry: T) => void, back: () => void,
    tooltip: (entry: T) => string | undefined,
  ): void {
    const control = handleMenuRowKey(code, key, entries, index, {
      label: (entry) => entry.label, tooltip, updateStatus: deps.updateStatus, blip: deps.blip,
    });
    if (control.type === 'move') {
      index = control.index;
    } else if (control.type === 'select') select(entries[index]);
    else if (control.type === 'cancel') { back(); deps.cancel(); }
  }

  function handleList(code: string, key: string): void {
    if (!allowed()) return;
    handleMenu(code, key, regions.map((region) => ({ ...region, label: label(region) })), (entry) => {
      selectedId = entry.id;
      const region = current();
      if (region) openActions(region);
    }, onBack, () => 'Press Enter to edit this region.');
  }

  function handleActions(code: string, key: string): void {
    if (!allowed()) return;
    const region = current();
    if (!region) return;
    const entries = ACTIONS.map((entry) => ({
      ...entry,
      label: entry.id === 'name' ? formatPropertyRow('Name', region.name)
        : entry.id in EDGES ? formatPropertyRow(entry.label, region[entry.id as keyof typeof EDGES])
          : entry.id === 'slideX' ? formatPropertyRow('Slide X', `${region.startX} to ${region.endX}`)
            : entry.id === 'slideY' ? formatPropertyRow('Slide Y', `${region.startY} to ${region.endY}`) : entry.label,
    }));
    const action: Action = entries[index].id;
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      const delta = code === 'ArrowRight' ? 1 : -1;
      if (action in EDGES) deps.send({ type: 'region_resize', regionId: region.id, edge: EDGES[action as keyof typeof EDGES], delta });
      else if (action === 'slideX' || action === 'slideY') deps.send({ type: 'region_slide', regionId: region.id, axis: action === 'slideX' ? 'x' : 'y', delta });
      return;
    }
    handleMenu(code, key, entries, (entry) => {
      if (entry.id === 'name') {
        deps.state.nicknameInput = region.name;
        deps.state.cursorPos = region.name.length;
        deps.setReplaceTextOnNextType(true);
        deps.state.mode = 'worldBuilderRegionEdit';
        deps.updateStatus(`Edit name: ${region.name}`);
      } else if (entry.id === 'delete') {
        deps.openConfirmation({
          prompt: `Delete ${region.name}?`,
          onConfirm: () => {
            if (!allowed() || !current()) return;
            deps.send({ type: 'region_delete', regionId: region.id });
            deps.state.mode = 'normal';
          },
          onCancel: () => { if (current()) openActions(region); },
        });
      } else deps.updateStatus('Use Left or Right to adjust by one square.');
    }, openList, (entry) => {
      if (entry.id === 'delete') return entry.tooltip;
      return describePropertyHelp(entry.label, {
        ...(entry.id in EDGES ? coordinateMetadata(entry.tooltip) : {}),
        valueType: entry.id === 'name' ? 'text' : 'number',
        tooltip: entry.tooltip,
        ...(entry.id === 'name' ? { maxLength: 100 } : {}),
      }, true);
    });
  }

  function handleEdit(code: string, key: string, ctrlKey = false): void {
    if (!allowed()) return;
    const region = current();
    if (!region) return;
    const action = getEditSessionAction(code);
    if (action === 'cancel') {
      deps.setReplaceTextOnNextType(false);
      openActions(region);
      deps.cancel();
    } else if (action === 'submit') {
      const name = deps.state.nicknameInput.trim();
      if (!name || name.length > 100) {
        deps.updateStatus('Name must contain 1 to 100 characters.');
        deps.cancel();
        return;
      }
      deps.send({ type: 'region_update', regionId: region.id, name });
      deps.setReplaceTextOnNextType(false);
      deps.state.mode = 'worldBuilderRegionActions';
    } else deps.applyTextInputEdit(code, key, 100, ctrlKey, true);
  }

  return {
    requestAdd, openList, handleList, handleActions, handleEdit,
    handleActionResult(message: { ok: boolean; action: string; message: string; regionId?: string }) {
      deps.updateStatus(message.message);
      if (!message.ok) { deps.cancel(); return; }
      deps.confirm();
      if (message.action === 'add' && message.regionId) {
        const region = deps.state.regions.get(message.regionId);
        if (region) openActions(region);
      }
    },
  };
}
