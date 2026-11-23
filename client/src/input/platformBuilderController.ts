import type { Platform } from '../state/platformGeometry';
import type { WorldBuilderDeps } from './worldBuilderController';
import { handleMenuRowKey } from './listController';
import { getEditSessionAction } from './editSession';
import { coordinateMetadata, parseCoordinate } from './coordinateControls';
import type { MobileTextEntry } from './mobileController';
import { adjustPropertyValue, announcePropertyValue, applyNumericPropertyKey, describePropertyHelp, formatPropertyRow } from './propertyControls';

const PROPERTIES = [
  { id: 'name', label: 'Name', tooltip: 'Name this platform.' },
  { id: 'startX', label: 'Start X', tooltip: 'Set the west corner coordinate.' },
  { id: 'startY', label: 'Start Y', tooltip: 'Set the south corner coordinate.' },
  { id: 'endX', label: 'End X', tooltip: 'Set the east corner coordinate.' },
  { id: 'endY', label: 'End Y', tooltip: 'Set the north corner coordinate.' },
  { id: 'z', label: 'Elevation', tooltip: 'Set the height of this flat platform.' },
] as const;
type Property = typeof PROPERTIES[number]['id'];
type PlatformDraft = Omit<Platform, 'id'>;

/** Edit flat platforms through the shared property, text, menu and confirmation controls. */
export function createPlatformBuilderController(deps: WorldBuilderDeps, back: () => void) {
  let index = 0;
  let selectedId: string | null = null;
  let draft: PlatformDraft | null = null;
  let editing: Property = 'name';
  let requestSequence = 0;
  let session = 0;
  let pending: { kind: 'add' | 'update' | 'delete'; requestId: string; session: number; platformId?: string; property?: Property; value?: string | number } | null = null;
  const queuedSteps: string[] = [];
  let platforms: Platform[] = [];

  function reset(): void {
    session += 1;
    pending = null;
    queuedSteps.length = 0;
    draft = null;
    selectedId = null;
    platforms = [];
    index = 0;
    deps.setReplaceTextOnNextType(false);
  }

  function beginRequest(kind: 'add' | 'update' | 'delete', property?: Property, value?: string | number): string {
    const requestId = `platform-${++requestSequence}`;
    pending = { kind, requestId, session, platformId: selectedId ?? undefined, property, value };
    return requestId;
  }

  function allowed(): boolean {
    if (deps.hasPermission('world.platform.edit')) return true;
    deps.state.mode = 'normal';
    deps.updateStatus('Platform editing permission required.');
    deps.cancel();
    return false;
  }

  function current(): PlatformDraft | undefined {
    return draft ?? (selectedId ? deps.state.platforms.get(selectedId) : undefined);
  }

  function metadata(property: Property) {
    const entry = PROPERTIES.find((row) => row.id === property)!;
    return property === 'name' ? { valueType: 'text', tooltip: entry.tooltip, maxLength: 100 }
      : coordinateMetadata(`${entry.tooltip} Enter a signed integer. Opposite corners are normalized when saved.`);
  }

  function entries() {
    const platform = current();
    return [
      ...PROPERTIES.map((entry) => ({ ...entry, label: platform ? formatPropertyRow(entry.label, platform[entry.id]) : entry.label })),
      draft ? { id: 'create', label: 'Create platform', tooltip: 'Validate these coordinates and add the platform.' }
        : { id: 'delete', label: 'Delete platform', tooltip: 'Delete this platform after confirmation. People move to 0, 0, 0, or the lowest corner of the first remaining platform. Required item support and a remaining platform are needed.' },
    ];
  }

  function openActions(): void {
    const platform = current();
    if (!platform) { openList(); return; }
    deps.state.mode = 'worldBuilderPlatformActions';
    deps.announceMenuEntry(draft ? 'New platform' : platform.name, entries()[index].label);
  }

  function openList(): void {
    if (!allowed()) return;
    reset();
    platforms = [...deps.state.platforms.values()].sort((a, b) => a.z - b.z || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    index = 0;
    deps.state.mode = 'worldBuilderPlatformList';
    deps.announceMenuEntry('Platforms', listEntries()[0].label);
  }

  function listEntries() {
    return [
      { id: 'add', label: 'Add platform', tooltip: 'Enter the name, two corners and elevation for a new platform.' },
      ...platforms.map((platform) => ({ id: platform.id, label: `${platform.name}, ${platform.startX}, ${platform.startY} to ${platform.endX}, ${platform.endY}, elevation ${platform.z}`, tooltip: 'Press Enter to edit this platform.' })),
    ];
  }

  function reconcileWorld(): void {
    if (deps.state.mode === 'worldBuilderPlatformList') {
      const selectedRow = listEntries()[index]?.id;
      platforms = [...deps.state.platforms.values()].sort((a, b) => a.z - b.z || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const nextIndex = listEntries().findIndex((entry) => entry.id === selectedRow);
      index = nextIndex >= 0 ? nextIndex : Math.min(index, platforms.length);
    } else if ((deps.state.mode === 'worldBuilderPlatformActions' || deps.state.mode === 'worldBuilderPlatformEdit')
      && selectedId && !deps.state.platforms.has(selectedId)) {
      openList();
      deps.updateStatus('Platform no longer exists.');
      deps.cancel();
    }
  }

  function handleList(code: string, key: string): void {
    if (!allowed()) return;
    reconcileWorld();
    const rows = listEntries();
    const control = handleMenuRowKey(code, key, rows, index, { label: (row) => row.label, tooltip: (row) => row.tooltip, updateStatus: deps.updateStatus, blip: deps.blip });
    if (control.type === 'move') index = control.index;
    else if (control.type === 'cancel') { reset(); back(); deps.cancel(); }
    else if (control.type === 'select') {
      if (rows[index].id === 'add') {
        const player = deps.state.player;
        const x = Math.round(player.x);
        const y = Math.round(player.y);
        draft = { name: 'Platform', startX: x, startY: y, endX: x, endY: y, z: player.z };
        selectedId = null;
      } else selectedId = rows[index].id;
      index = 0;
      openActions();
    }
  }

  function setProperty(property: Property, value: string | number): void {
    if (draft) {
      draft = { ...draft, [property]: value };
      announcePropertyValue(deps.updateStatus, value, metadata(property));
      deps.blip();
      return;
    }
    if (!selectedId || pending) return;
    const requestId = beginRequest('update', property, value);
    deps.send({ type: 'platform_update', platformId: selectedId, requestId, [property]: value });
  }

  function sendQueuedStep(property: Property): void {
    const code = queuedSteps.shift();
    const platform = current();
    if (!code || !platform) return;
    const adjustment = adjustPropertyValue(code, platform[property], metadata(property));
    if (!adjustment || adjustment.hitBoundary) {
      queuedSteps.length = 0;
      deps.cancel();
      return;
    }
    setProperty(property, adjustment.value as number);
  }

  function handleActions(code: string, key: string): void {
    if (!allowed()) return;
    const platform = current();
    if (!platform) { openList(); deps.updateStatus('Platform no longer exists.'); return; }
    const rows = entries();
    const property = PROPERTIES[index]?.id;
    if (property) {
      const adjustment = adjustPropertyValue(code, platform[property], metadata(property));
      if (adjustment) {
        if (pending) {
          if (pending.kind === 'update' && pending.property === property) queuedSteps.push(code);
        } else if (adjustment.hitBoundary) deps.cancel();
        else setProperty(property, adjustment.value as number);
        return;
      }
    }
    const control = handleMenuRowKey(code, key, rows, index, {
      label: (row) => row.label, tooltip: (row) => property && row.id === property ? describePropertyHelp(PROPERTIES[index].label, metadata(property), true) : row.tooltip,
      updateStatus: deps.updateStatus, blip: deps.blip,
    });
    if (control.type === 'move') {
      index = control.index;
      queuedSteps.length = 0;
    }
    else if (control.type === 'cancel') { openList(); deps.cancel(); }
    else if (control.type === 'select') {
      if (pending) return;
      if (property) {
        editing = property;
        deps.state.nicknameInput = String(platform[property]);
        deps.state.cursorPos = deps.state.nicknameInput.length;
        deps.setReplaceTextOnNextType(true);
        deps.state.mode = 'worldBuilderPlatformEdit';
        deps.updateStatus(`Edit ${PROPERTIES[index].label}: ${deps.state.nicknameInput}`);
      } else if (draft) {
        const requestId = beginRequest('add');
        deps.send({ type: 'platform_add', ...draft, requestId });
      } else if (selectedId) {
        const id = selectedId;
        const confirmationSession = session;
        deps.openConfirmation({ prompt: `Delete ${platform.name}? People on it move to 0, 0, 0, or the lowest corner of the first remaining platform.`, onConfirm: () => {
          if (confirmationSession !== session || !allowed() || pending) return;
          if (!deps.state.platforms.has(id)) {
            openList();
            deps.updateStatus('Platform no longer exists.');
            deps.cancel();
            return;
          }
          deps.state.mode = 'worldBuilderPlatformActions';
          const requestId = beginRequest('delete');
          deps.send({ type: 'platform_delete', platformId: id, requestId });
        }, onCancel: () => { if (confirmationSession === session) openActions(); } });
      }
    }
  }

  function handleEdit(code: string, key: string, ctrlKey = false): void {
    if (!allowed()) return;
    const platform = current();
    if (!platform) { openList(); return; }
    if (editing !== 'name' && applyNumericPropertyKey(code, deps.state, metadata(editing), {
      setReplaceTextOnNextType: deps.setReplaceTextOnNextType, updateStatus: deps.updateStatus,
      cue: (success) => success ? deps.blip() : deps.cancel(),
    }, platform[editing])) return;
    const action = getEditSessionAction(code);
    if (action === 'cancel') {
      deps.setReplaceTextOnNextType(false);
      deps.state.mode = 'worldBuilderPlatformActions';
      deps.updateStatus(entries()[index].label);
      deps.cancel();
    } else if (action === 'submit') {
      const raw = deps.state.nicknameInput.trim();
      const parsed = editing === 'name' ? (raw.length > 0 && raw.length <= 100 ? { ok: true as const, value: raw } : { ok: false as const, message: 'Name must contain 1 to 100 characters.' })
        : parseCoordinate(PROPERTIES[index].label, raw);
      if (!parsed.ok) { deps.updateStatus(parsed.message); deps.cancel(); return; }
      setProperty(editing, parsed.value);
      deps.setReplaceTextOnNextType(false);
      deps.state.mode = 'worldBuilderPlatformActions';
    } else deps.applyTextInputEdit(code, key, editing === 'name' ? 100 : 8, ctrlKey, true);
  }

  return {
    openList, handleList, handleActions, handleEdit, reset, reconcileWorld,
    getEditingMaxLength: () => editing === 'name' ? 100 : 8,
    getTextEntry: (): MobileTextEntry => ({
      label: PROPERTIES.find((entry) => entry.id === editing)!.label,
      value: deps.state.nicknameInput,
      maxLength: editing === 'name' ? 100 : 8,
      inputMode: 'text',
      submitLabel: 'Save',
    }),
    handleActionResult(message: { ok: boolean; message: string; platformId?: string; requestId?: string }) {
      const operation = pending;
      if (!operation || message.requestId !== operation.requestId) return;
      pending = null;
      const inEditor = deps.state.mode === 'worldBuilderPlatformActions' || deps.state.mode === 'worldBuilderPlatformEdit';
      if (operation.session !== session || !inEditor) { queuedSteps.length = 0; return; }
      if (!message.ok) { queuedSteps.length = 0; deps.updateStatus(message.message); deps.cancel(); return; }
      if (operation?.kind === 'update' && operation.property) {
        if (operation.platformId !== selectedId || PROPERTIES[index]?.id !== operation.property) { queuedSteps.length = 0; return; }
        const platform = operation.platformId ? deps.state.platforms.get(operation.platformId) : undefined;
        const value = platform?.[operation.property];
        if (value !== undefined && platform) {
          const boundsChanged = value !== operation.value && ['startX', 'startY', 'endX', 'endY'].includes(operation.property);
          const axis = operation.property.endsWith('X') ? 'X' : 'Y';
          announcePropertyValue(deps.updateStatus, boundsChanged ? `${platform[`start${axis}`]} to ${platform[`end${axis}`]}` : value, metadata(operation.property));
        }
        deps.blip();
        sendQueuedStep(operation.property);
      } else if (operation?.kind === 'add' && message.platformId) {
        selectedId = message.platformId;
        draft = null;
        index = 0;
        openActions();
        deps.confirm();
      } else if (operation?.kind === 'delete') { openList(); deps.confirm(); }
    },
  };
}
