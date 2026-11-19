import { handleListControlKey } from './listController';
import { getEditSessionAction } from './editSession';
import type { NamedRegion } from '../state/gameState';
import { containingRegions } from '../state/regions';
import type { WorldBuilderDeps } from './worldBuilderController';

const ROOT = [
  { id: 'add', label: 'Add region here' },
  { id: 'edit', label: 'Edit regions' },
] as const;
const ACTIONS = [
  { id: 'name', label: 'Name' },
  { id: 'startX', label: 'Start X' },
  { id: 'startY', label: 'Start Y' },
  { id: 'endX', label: 'End X' },
  { id: 'endY', label: 'End Y' },
  { id: 'slideX', label: 'Slide X' },
  { id: 'slideY', label: 'Slide Y' },
  { id: 'delete', label: 'Delete region' },
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

  function open(): void {
    if (!allowed()) return;
    index = 0;
    deps.state.mode = 'worldBuilderRegionRoot';
    deps.announceMenuEntry('Regions', ROOT[0].label);
  }

  function current(): NamedRegion | null {
    const region = selectedId ? deps.state.regions.get(selectedId) : undefined;
    if (region) return region;
    open();
    deps.updateStatus('Region no longer exists.');
    deps.cancel();
    return null;
  }

  function openActions(region: NamedRegion): void {
    selectedId = region.id;
    index = 0;
    deps.state.mode = 'worldBuilderRegionActions';
    deps.announceMenuEntry(region.name, `Name: ${region.name}`);
  }

  function label(region: NamedRegion): string {
    return `${region.name}, ${region.startX}, ${region.startY} to ${region.endX}, ${region.endY}`;
  }

  function openList(): void {
    const player = deps.state.player;
    const containing = new Set(containingRegions(deps.state.regions.values(), player).map((region) => region.id));
    regions = [...deps.state.regions.values()]
      .filter((region) => region.floorZ === player.z)
      .sort((left, right) => Number(containing.has(right.id)) - Number(containing.has(left.id))
        || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    if (!regions.length) {
      open();
      deps.updateStatus('No regions on this floor.');
      return;
    }
    index = 0;
    deps.state.mode = 'worldBuilderRegionList';
    deps.announceMenuEntry('Regions', label(regions[0]));
  }

  function handleMenu<T extends { label: string }>(
    code: string, key: string, entries: readonly T[], select: (entry: T) => void, back: () => void,
  ): void {
    const control = handleListControlKey(code, key, entries, index, (entry) => entry.label);
    if (control.type === 'move') {
      index = control.index;
      deps.updateStatus(entries[index].label);
      deps.blip();
    } else if (control.type === 'select') select(entries[index]);
    else if (control.type === 'cancel') { back(); deps.cancel(); }
    else if (code === 'Space') deps.updateStatus('Enter selects. Left and Right adjust bounds or slide a region by one square.');
  }

  function handleRoot(code: string, key: string): void {
    if (!allowed()) return;
    handleMenu(code, key, ROOT, (entry) => {
      if (entry.id === 'edit') openList();
      else {
        deps.send({ type: 'region_add' });
        deps.state.mode = 'normal';
      }
    }, onBack);
  }

  function handleList(code: string, key: string): void {
    if (!allowed()) return;
    handleMenu(code, key, regions.map((region) => ({ ...region, label: label(region) })), (entry) => {
      selectedId = entry.id;
      const region = current();
      if (region) openActions(region);
    }, open);
  }

  function handleActions(code: string, key: string): void {
    if (!allowed()) return;
    const region = current();
    if (!region) return;
    const entries = ACTIONS.map((entry) => ({
      ...entry,
      label: entry.id === 'name' ? `Name: ${region.name}`
        : entry.id in EDGES ? `${entry.label}: ${region[entry.id as keyof typeof EDGES]}`
          : entry.id === 'slideX' ? `Slide X: ${region.startX} to ${region.endX}`
            : entry.id === 'slideY' ? `Slide Y: ${region.startY} to ${region.endY}` : entry.label,
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
    }, openList);
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
      openActions(region);
    } else deps.applyTextInputEdit(code, key, 100, ctrlKey, true);
  }

  return {
    open, handleRoot, handleList, handleActions, handleEdit,
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
