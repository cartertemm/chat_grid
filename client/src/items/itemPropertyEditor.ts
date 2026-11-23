import { handleMenuRowKey } from '../input/listController';
import { getEditSessionAction } from '../input/editSession';
import { type WorldItem } from '../state/gameState';
import type { OptionSelectorRequest } from '../input/optionSelector';
import { adjustPropertyValue, applyNumericPropertyKey, announcePropertyValue, formatPropertyRow, getPropertyOptions } from '../input/propertyControls';
import type { IncomingMessage } from '../network/protocol';

/**
 * Dependencies required to drive item property inspect/edit flows.
 */
type EditorDeps = {
  state: {
    mode: string;
    selectedItemId: string | null;
    editingPropertyKey: string | null;
    itemPropertyKeys: string[];
    itemPropertyIndex: number;
    nicknameInput: string;
    cursorPos: number;
    items: Map<string, WorldItem>;
  };
  signalingSend: (message: unknown) => void;
  getItemPropertyValue: (item: WorldItem, key: string) => string;
  itemPropertyLabel: (key: string) => string;
  isItemPropertyEditable: (item: WorldItem, key: string) => boolean;
  getItemPropertyOptionValues: (itemType: WorldItem['type'], key: string) => string[] | undefined;
  openOptionSelector: (request: OptionSelectorRequest) => void;
  describeItemPropertyHelp: (item: WorldItem, key: string) => string;
  getItemPropertyMetadata: (
    itemType: WorldItem['type'],
    key: string,
  ) => {
    valueType?: string;
    maxLength?: number;
    range?: { min: number; max: number; step?: number };
  } | undefined;
  validateNumericItemPropertyInput: (
    item: WorldItem,
    key: string,
    rawValue: string,
    requireInteger: boolean,
  ) => { ok: true; value: number } | { ok: false; message: string };
  applyTextInputEdit: (code: string, key: string, maxLength: number, ctrlKey?: boolean, allowReplaceOnNextType?: boolean) => void;
  setReplaceTextOnNextType: (value: boolean) => void;
  onPreviewPropertyChange?: (item: WorldItem, key: string, value: unknown) => void;
  updateStatus: (message: string) => void;
  sfxUiBlip: () => void;
  sfxUiCancel: () => void;
};

/**
 * Creates item property mode handlers so main input dispatch can stay lean.
 */
export function createItemPropertyEditor(deps: EditorDeps): {
  handleItemPropertiesModeInput: (code: string, key: string) => void;
  handleItemPropertyEditModeInput: (code: string, key: string, ctrlKey: boolean) => void;
  reset: () => void;
  shouldAnnounceEcho: (itemId: string) => boolean;
  handleActionResult: (message: Extract<IncomingMessage, { type: 'item_action_result' }>) => boolean;
} {
  type Change = { itemId: string; key: string; code?: string; value?: string | number | boolean };
  const queued: Change[] = [];
  let pending: (Change & { requestId: string; previousStop: unknown }) | null = null;
  let requestSequence = 0;
  let session = 0;

  function reset(): void {
    session += 1;
    queued.length = 0;
    pending = null;
  }

  function isEditing(itemId: string): boolean {
    return deps.state.selectedItemId === itemId
      && ['itemProperties', 'itemPropertyEdit', 'optionSelect'].includes(deps.state.mode);
  }

  function sendNext(): void {
    if (pending) return;
    while (queued.length > 0) {
      const change = queued.shift()!;
      const item = deps.state.items.get(change.itemId);
      if (!item || !isEditing(change.itemId)) { reset(); return; }
      let value = change.value;
      if (change.code) {
        const metadata = {
          ...deps.getItemPropertyMetadata(item.type, change.key),
          options: deps.getItemPropertyOptionValues(item.type, change.key),
        };
        const current = item.params[change.key] ?? deps.getItemPropertyValue(item, change.key);
        const adjustment = adjustPropertyValue(change.code, current, metadata);
        if (!adjustment || adjustment.hitBoundary) {
          deps.sfxUiCancel();
          continue;
        }
        value = adjustment.value;
      }
      if (value === undefined) continue;
      pending = { ...change, requestId: `item-property-${++requestSequence}`, previousStop: item.params.currentZ };
      deps.signalingSend({
        type: 'item_update', itemId: change.itemId, requestId: pending.requestId,
        ...(change.key === 'title' ? { title: value } : { params: { [change.key]: value } }),
      });
      return;
    }
  }

  function enqueue(change: Change): void {
    queued.push(change);
    sendNext();
  }

  function handleActionResult(message: Extract<IncomingMessage, { type: 'item_action_result' }>): boolean {
    if (message.action !== 'update' || !message.requestId?.startsWith('item-property-')) return false;
    if (!pending || message.requestId !== pending.requestId) return true;
    const change = pending;
    pending = null;
    const item = deps.state.items.get(change.itemId);
    if (!isEditing(change.itemId) || !item) { reset(); return true; }
    if (!message.ok) {
      for (let index = queued.length - 1; index >= 0; index -= 1) {
        if (queued[index].itemId === change.itemId && queued[index].key === change.key) queued.splice(index, 1);
      }
      deps.updateStatus(message.message);
      deps.sfxUiCancel();
      sendNext();
      return true;
    }
    deps.onPreviewPropertyChange?.(item, change.key, item.params[change.key] ?? deps.getItemPropertyValue(item, change.key));
    const selectedKey = deps.state.itemPropertyKeys[deps.state.itemPropertyIndex];
    if (deps.state.mode === 'itemProperties' && selectedKey === change.key) {
      const value = deps.getItemPropertyValue(item, change.key);
      const parked = item.type === 'elevator' && change.key === 'floorZs'
        && item.params.currentZ !== change.previousStop;
      const metadata = {
        ...deps.getItemPropertyMetadata(item.type, change.key),
        options: deps.getItemPropertyOptionValues(item.type, change.key),
      };
      announcePropertyValue(deps.updateStatus, parked ? `${value}. Car parked at height ${item.params.currentZ}.` : value, metadata);
      deps.sfxUiBlip();
    }
    sendNext();
    return true;
  }

  function handleItemPropertiesModeInput(code: string, key: string): void {
    const itemId = deps.state.selectedItemId;
    if (!itemId) {
      reset();
      deps.state.mode = 'normal';
      deps.state.editingPropertyKey = null;
      return;
    }
    const item = deps.state.items.get(itemId);
    if (!item) {
      reset();
      deps.state.mode = 'normal';
      deps.state.editingPropertyKey = null;
      deps.updateStatus('Item no longer exists.');
      deps.sfxUiCancel();
      return;
    }
    const control = handleMenuRowKey(code, key, deps.state.itemPropertyKeys, deps.state.itemPropertyIndex, {
      label: (propertyKey) => formatPropertyRow(
        deps.itemPropertyLabel(propertyKey), deps.getItemPropertyValue(item, propertyKey),
      ),
      searchLabel: (propertyKey) => propertyKey,
      tooltip: (propertyKey) => deps.describeItemPropertyHelp(item, propertyKey),
      updateStatus: deps.updateStatus,
      blip: deps.sfxUiBlip,
      helpBlip: deps.sfxUiBlip,
    });
    if (control.type === 'move') {
      deps.state.itemPropertyIndex = control.index;
      return;
    }
    if (code === 'Space') return;
    if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'PageUp' || code === 'PageDown') {
      const selectedKey = deps.state.itemPropertyKeys[deps.state.itemPropertyIndex];
      if (!deps.isItemPropertyEditable(item, selectedKey)) {
        deps.updateStatus(`${deps.itemPropertyLabel(selectedKey)} is not editable.`);
        deps.sfxUiCancel();
        return;
      }
      enqueue({ itemId, key: selectedKey, code });
      return;
    }
    if (control.type === 'select') {
      const selectedKey = deps.state.itemPropertyKeys[deps.state.itemPropertyIndex];
      if (!deps.isItemPropertyEditable(item, selectedKey)) {
        deps.updateStatus(`${deps.itemPropertyLabel(selectedKey)} is not editable.`);
        deps.sfxUiCancel();
        return;
      }
      const metadata = deps.getItemPropertyMetadata(item.type, selectedKey);
      if (metadata?.valueType === 'boolean') {
        enqueue({ itemId, key: selectedKey, code: 'ArrowRight' });
        return;
      }
      const options = getPropertyOptions({
        ...metadata,
        options: deps.getItemPropertyOptionValues(item.type, selectedKey),
      });
      if (options.length > 0) {
        const selectorSession = session;
        deps.state.editingPropertyKey = selectedKey;
        deps.openOptionSelector({
          title: `Select ${deps.itemPropertyLabel(selectedKey)}`,
          options,
          selectedId: deps.getItemPropertyValue(item, selectedKey),
          propertyHelp: () => deps.describeItemPropertyHelp(item, selectedKey),
          onSelect: (selectedValue) => {
            if (selectorSession !== session || deps.state.selectedItemId !== itemId || !deps.state.items.has(itemId)) return;
            deps.state.mode = 'itemProperties';
            deps.state.editingPropertyKey = null;
            enqueue({ itemId, key: selectedKey, value: selectedValue });
          },
          onCancel: () => {
            if (selectorSession !== session) return;
            deps.state.mode = 'itemProperties';
            deps.state.editingPropertyKey = null;
            deps.updateStatus('Cancelled.');
          },
        });
        return;
      }
      deps.state.mode = 'itemPropertyEdit';
      deps.state.editingPropertyKey = selectedKey;
      const selectedMetadata = deps.getItemPropertyMetadata(item.type, selectedKey);
      deps.state.nicknameInput =
        selectedKey === 'title'
          ? item.title
          : selectedMetadata?.valueType === 'boolean'
            ? deps.getItemPropertyValue(item, selectedKey).toLowerCase() === 'on'
              ? 'on'
              : 'off'
            : String(item.params[selectedKey] ?? deps.getItemPropertyValue(item, selectedKey));
      deps.state.cursorPos = deps.state.nicknameInput.length;
      deps.setReplaceTextOnNextType(true);
      deps.updateStatus(`Edit ${deps.itemPropertyLabel(selectedKey)}: ${deps.state.nicknameInput}`);
      deps.sfxUiBlip();
      return;
    }
    if (control.type === 'cancel') {
      reset();
      deps.state.mode = 'normal';
      deps.state.selectedItemId = null;
      deps.state.itemPropertyKeys = [];
      deps.state.itemPropertyIndex = 0;
      deps.state.editingPropertyKey = null;
      deps.updateStatus('Closed item properties.');
      deps.sfxUiCancel();
    }
  }

  function handleItemPropertyEditModeInput(code: string, key: string, ctrlKey: boolean): void {
    const itemId = deps.state.selectedItemId;
    const propertyKey = deps.state.editingPropertyKey;
    if (!itemId || !propertyKey) {
      reset();
      deps.state.mode = 'normal';
      return;
    }
    const item = deps.state.items.get(itemId);
    if (!item) {
      reset();
      deps.state.mode = 'normal';
      deps.state.editingPropertyKey = null;
      deps.updateStatus('Item no longer exists.');
      deps.sfxUiCancel();
      return;
    }
    const numericAdjustment = applyNumericPropertyKey(
      code, deps.state, deps.getItemPropertyMetadata(item.type, propertyKey),
      {
        setReplaceTextOnNextType: deps.setReplaceTextOnNextType,
        updateStatus: deps.updateStatus,
        cue: (success) => success ? deps.sfxUiBlip() : deps.sfxUiCancel(),
      },
      item.params[propertyKey],
    );
    if (numericAdjustment) {
      deps.onPreviewPropertyChange?.(item, propertyKey, numericAdjustment.value);
      return;
    }
    const editAction = getEditSessionAction(code);
    if (editAction === 'submit') {
      const value = deps.state.nicknameInput.trim();
      const metadata = deps.getItemPropertyMetadata(item.type, propertyKey);
      const valueType = metadata?.valueType;
      const sendItemParams = (params: Record<string, unknown>): void => {
        for (const [key, nextValue] of Object.entries(params)) {
          enqueue({ itemId, key, value: nextValue as string | number | boolean });
        }
      };
      const parseToggleValue = (raw: string, field: string): { ok: true; value: boolean } | { ok: false } => {
        const normalized = raw.toLowerCase();
        if (!['on', 'off', 'true', 'false', '1', '0', 'yes', 'no'].includes(normalized)) {
          deps.updateStatus(`${field} must be on or off.`);
          deps.sfxUiCancel();
          return { ok: false };
        }
        return { ok: true, value: ['on', 'true', '1', 'yes'].includes(normalized) };
      };
      const submitNumericParam = (targetKey: string): boolean => {
        const parsed = deps.validateNumericItemPropertyInput(item, targetKey, value, false);
        if (!parsed.ok) {
          deps.updateStatus(parsed.message);
          deps.sfxUiCancel();
          return false;
        }
        sendItemParams({ [targetKey]: parsed.value });
        return true;
      };
      if (propertyKey === 'title') {
        if (!value) {
          deps.updateStatus('Value is required.');
          deps.sfxUiCancel();
          return;
        }
        enqueue({ itemId, key: 'title', value });
      } else if (valueType === 'boolean') {
        const toggle = parseToggleValue(value, propertyKey);
        if (!toggle.ok) return;
        sendItemParams({ [propertyKey]: toggle.value });
      } else if (valueType === 'number') {
        if (!submitNumericParam(propertyKey)) return;
      } else if (valueType === 'list') {
        const options = deps.getItemPropertyOptionValues(item.type, propertyKey) ?? [];
        if (options.length === 0) {
          deps.updateStatus(`${deps.itemPropertyLabel(propertyKey)} has no options.`);
          deps.sfxUiCancel();
          return;
        }
        const normalized = value.toLowerCase();
        const matched = options.find((option) => option.toLowerCase() === normalized);
        if (!matched) {
          deps.updateStatus(`${deps.itemPropertyLabel(propertyKey)} must be one of: ${options.join(', ')}.`);
          deps.sfxUiCancel();
          return;
        }
        sendItemParams({ [propertyKey]: matched });
      } else {
        if (metadata?.maxLength !== undefined && value.length > metadata.maxLength) {
          deps.updateStatus(`${deps.itemPropertyLabel(propertyKey)} must be ${metadata.maxLength} characters or less.`);
          deps.sfxUiCancel();
          return;
        }
        sendItemParams({ [propertyKey]: value });
      }
      deps.state.mode = 'itemProperties';
      deps.state.editingPropertyKey = null;
      deps.setReplaceTextOnNextType(false);
      return;
    }
    if (editAction === 'cancel') {
      deps.state.mode = 'itemProperties';
      deps.state.editingPropertyKey = null;
      deps.setReplaceTextOnNextType(false);
      deps.updateStatus('Cancelled.');
      deps.sfxUiCancel();
      return;
    }
    const maxLength = deps.getItemPropertyMetadata(item.type, propertyKey)?.maxLength ?? 500;
    deps.applyTextInputEdit(code, key, maxLength, ctrlKey, true);
  }

  return {
    handleItemPropertiesModeInput,
    handleItemPropertyEditModeInput,
    reset,
    shouldAnnounceEcho: (itemId) => pending?.itemId !== itemId,
    handleActionResult,
  };
}
