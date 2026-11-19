import type { DoorAction, IncomingMessage } from '../network/protocol';
import type { GameMode, WallDoor, WallStructure } from '../state/gameState';
import type { OptionSelectorRequest } from './optionSelector';
import type { MobileTextEntry } from './mobileController';
import { handleListControlKey } from './listController';
import { applyTextInput, mapTextInputKey } from './textInput';
import { adjustPropertyValue } from './propertyControls';

const TIMEOUT_METADATA = { valueType: 'number', range: { min: 0, max: 300, step: 1 } };

type Property = 'title' | 'unlockMode' | 'pin' | 'keypadSides' | 'pinRequiredFor' | 'unlockTimeoutSeconds';
type Deps = {
  send: (packet: DoorAction) => void;
  choose: (request: OptionSelectorRequest) => void;
  status: (message: string) => void;
  setMode: (mode: GameMode) => void;
  getWall: (id: string) => WallStructure | undefined;
  cue: (success: boolean) => void;
  blip: () => void;
  keypadSound: (name: 'keypad' | 'keypad_good' | 'keypad_bad') => Promise<void>;
  textState: { nicknameInput: string; cursorPos: number };
  applyTextInputEdit: (
    code: string,
    key: string,
    maxLength: number,
    ctrlKey?: boolean,
    allowReplaceOnNextType?: boolean,
  ) => void;
  setReplaceTextOnNextType: (value: boolean) => void;
};

/** Native World Builder property controls, with private confirmed PIN input. */
export function createDoorSettingsController(deps: Deps) {
  let selection: { wallId: string; doorId: string; back: () => void } | null = null;
  let index = 0;
  let editing: Property | 'confirmPin' | null = null;
  let text = '';
  let cursor = 0;
  let replace = false;
  let newPin = '';
  let enableKeypad = false;
  let waiting = false;
  let digitSounds = Promise.resolve();

  function beep(count = 1) {
    for (let i = 0; i < count; i++)
      digitSounds = digitSounds.then(() => deps.keypadSound('keypad')).catch(() => undefined);
  }

  function door(): WallDoor | undefined {
    return (
      (selection && deps.getWall(selection.wallId)?.doors?.find((entry) => entry.id === selection?.doorId)) ||
      undefined
    );
  }

  function options(property: Property): { id: string; label: string }[] {
    const horizontal = selection && deps.getWall(selection.wallId)?.orientation === 'horizontal';
    if (property === 'unlockMode')
      return [
        { id: 'none', label: 'None' },
        { id: 'keypad', label: 'Keypad' },
      ];
    if (property === 'keypadSides')
      return [
        { id: 'both', label: 'Both' },
        { id: 'negative', label: horizontal ? 'South' : 'West' },
        { id: 'positive', label: horizontal ? 'North' : 'East' },
      ];
    return ['unlock', 'lock', 'both'].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }));
  }

  function entries() {
    const current = door();
    if (!current) return [];
    const result: { id: Property; label: string }[] = [
      { id: 'title', label: `Name, ${current.title}` },
      { id: 'unlockMode', label: `Unlock mode, ${current.unlockMode === 'keypad' ? 'Keypad' : 'None'}` },
    ];
    if (current.unlockMode === 'keypad')
      result.push(
        { id: 'pin', label: current.hasPin ? 'Change PIN' : 'Set PIN' },
        {
          id: 'keypadSides',
          label: `Keypad sides, ${options('keypadSides').find((entry) => entry.id === current.keypadSides)?.label}`,
        },
        {
          id: 'pinRequiredFor',
          label: `Require PIN for, ${options('pinRequiredFor').find((entry) => entry.id === current.pinRequiredFor)?.label}`,
        },
        {
          id: 'unlockTimeoutSeconds',
          label: `Unlock timeout, ${current.unlockTimeoutSeconds === 0 ? 'Stays unlocked' : current.unlockTimeoutSeconds === 1 ? '1 second' : current.unlockTimeoutSeconds + ' seconds'}`,
        },
      );
    return result;
  }

  function clearInput() {
    text = newPin = '';
    cursor = 0;
    editing = null;
    enableKeypad = false;
  }

  function menu() {
    clearInput();
    const rows = entries();
    if (!rows.length) {
      const back = selection?.back;
      close();
      back?.();
      deps.status('This door is no longer available.');
      return;
    }
    index = Math.min(index, rows.length - 1);
    deps.setMode('doorSettings');
    deps.status(`Door settings. ${rows[index].label}`);
  }

  function close() {
    clearInput();
    selection = null;
    waiting = false;
  }

  function send(update: Partial<DoorAction>) {
    const current = door();
    if (!current || !selection) {
      menu();
      return;
    }
    waiting = true;
    deps.send({
      type: 'door_action',
      action: 'update',
      structureId: selection.wallId,
      doorId: current.id,
      revision: current.revision,
      ...update,
    });
    clearInput();
    deps.setMode('doorSettings');
  }

  function beginEdit(property: Property | 'confirmPin', value = '') {
    editing = property;
    text = value;
    cursor = text.length;
    replace = true;
    if (property === 'title' || property === 'unlockTimeoutSeconds') {
      deps.textState.nicknameInput = value;
      deps.textState.cursorPos = value.length;
      deps.setReplaceTextOnNextType(true);
    }
    deps.setMode('doorSettingsEdit');
    deps.status(
      property === 'pin'
        ? 'Enter a new four-digit PIN.'
        : property === 'confirmPin'
          ? 'Confirm the new four-digit PIN.'
          : `Edit ${property === 'title' ? 'name' : 'unlock timeout in seconds, 0 stays unlocked'}: ${text}`,
    );
  }

  function chooseValue(property: Property, value: string) {
    if (property === 'unlockMode' && value === 'keypad' && !door()?.hasPin) {
      enableKeypad = true;
      beginEdit('pin');
      return;
    }
    send({ [property]: value });
  }

  function handleMenu(code: string, key: string) {
    if (!selection) return;
    if (code === 'Escape') {
      const back = selection.back;
      close();
      back();
      return;
    }
    if (waiting) return;
    const rows = entries();
    const current = door();
    if (!current || !rows.length) {
      menu();
      return;
    }
    index = Math.min(index, rows.length - 1);
    const property = rows[index].id;
    if (property === 'unlockTimeoutSeconds') {
      const adjustment = adjustPropertyValue(code, current.unlockTimeoutSeconds, TIMEOUT_METADATA);
      if (adjustment) {
        if (adjustment.hitBoundary) deps.cue(false);
        if (Number(adjustment.value) !== current.unlockTimeoutSeconds)
          send({ unlockTimeoutSeconds: Number(adjustment.value) });
        return;
      }
    }
    if (property === 'unlockMode' || property === 'keypadSides' || property === 'pinRequiredFor') {
      const adjustment = adjustPropertyValue(code, current[property], { options: options(property) });
      if (adjustment) {
        chooseValue(property, String(adjustment.value));
        return;
      }
    }
    if (code === 'Space') {
      deps.status(
        property === 'pin'
          ? 'Enter and confirm a new four-digit PIN. The existing PIN is never displayed.'
          : property === 'title'
            ? 'Press Enter to edit the door name.'
            : 'Use Left or Right to adjust, or Enter to select or edit. Timeout is 0 to 300 seconds, where 0 stays unlocked.',
      );
      return;
    }
    const control = handleListControlKey(code, key, rows, index, (entry) => entry.label);
    if (control.type === 'move') {
      index = control.index;
      deps.status(rows[index].label);
      deps.blip();
    }
    if (control.type !== 'select') return;
    if (property === 'title' || property === 'unlockTimeoutSeconds' || property === 'pin') {
      beginEdit(property, property === 'pin' ? '' : String(current[property]));
      return;
    }
    deps.choose({
      title: rows[index].label.split(',')[0],
      options: options(property),
      selectedId: String(current[property]),
      onSelect: (id) => chooseValue(property, id),
      onCancel: menu,
    });
  }

  function handleEdit(code: string, key: string, ctrlKey = false) {
    if (!editing) return;
    if (editing === 'title' || editing === 'unlockTimeoutSeconds') {
      text = deps.textState.nicknameInput;
      cursor = deps.textState.cursorPos;
    }
    if (code === 'Escape') {
      menu();
      return;
    }
    if (code === 'Enter') {
      if (editing === 'pin' || editing === 'confirmPin') {
        if (!/^\d{4}$/.test(text)) {
          deps.status('Enter exactly four digits.');
          return;
        }
        if (editing === 'pin') {
          newPin = text;
          beginEdit('confirmPin');
          return;
        }
        if (newPin !== text) {
          newPin = '';
          beginEdit('pin');
          deps.status('PINs did not match. Enter a new four-digit PIN.');
          return;
        }
        send({ pin: text, ...(enableKeypad ? { unlockMode: 'keypad' } : {}) });
        return;
      }
      if (editing === 'title') {
        if (!text.trim()) {
          deps.status('Enter a door name.');
          return;
        }
        send({ title: text.trim() });
      } else if (/^\d+$/.test(text) && Number(text) <= 300) send({ unlockTimeoutSeconds: Number(text) });
      else deps.status('Enter a whole number from 0 to 300.');
      return;
    }
    if (editing === 'unlockTimeoutSeconds' && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(code)) {
      const adjustment = adjustPropertyValue(code, text, TIMEOUT_METADATA, 'vertical')!;
      text = adjustment.displayValue;
      if (adjustment.hitBoundary) deps.cue(false);
      cursor = text.length;
      replace = false;
      deps.textState.nicknameInput = text;
      deps.textState.cursorPos = cursor;
      deps.setReplaceTextOnNextType(false);
    } else if (editing === 'title' || editing === 'unlockTimeoutSeconds') {
      deps.applyTextInputEdit(code, key, editing === 'title' ? 80 : 3, ctrlKey, true);
      return;
    } else {
      const secret = editing === 'pin' || editing === 'confirmPin';
      if (key.length === 1 && secret && !/^\d$/.test(key)) return;
      if (replace && key.length === 1) {
        text = '';
        cursor = 0;
      }
      replace = false;
      const result = applyTextInput(mapTextInputKey(code, key), text, cursor, 4);
      if (/^\d$/.test(key) && result.newString.length > text.length)
        beep();
      text = result.newString;
      cursor = result.newCursorPos;
    }
    if (editing !== 'pin' && editing !== 'confirmPin') deps.status(text || 'Empty');
  }

  return {
    open(wall: WallStructure, selected: WallDoor, back: () => void) {
      close();
      selection = { wallId: wall.id, doorId: selected.id, back };
      index = 0;
      menu();
    },
    handleInput(mode: GameMode, code: string, key: string, ctrlKey = false) {
      if (mode === 'doorSettings') handleMenu(code, key);
      else handleEdit(code, key, ctrlKey);
    },
    result(reply: Extract<IncomingMessage, { type: 'door_action_result' }>) {
      if (
        !waiting ||
        !selection ||
        reply.action !== 'update' ||
        reply.structureId !== selection.wallId ||
        reply.doorId !== selection.doorId
      )
        return false;
      waiting = false;
      const rows = entries();
      if (!rows.length) menu();
      else {
        index = Math.min(index, rows.length - 1);
        deps.status(reply.ok ? rows[index].label : reply.message);
      }
      return true;
    },
    getTextEntry(): MobileTextEntry | null {
      if (!editing) return null;
      const secret = editing === 'pin' || editing === 'confirmPin';
      const value = secret ? text : deps.textState.nicknameInput;
      return {
        label: secret
          ? editing === 'pin'
            ? 'New four-digit PIN'
            : 'Confirm new PIN'
          : editing === 'title'
            ? 'Door name'
            : 'Unlock timeout in seconds (0 stays unlocked)',
        value,
        maxLength: secret ? 4 : editing === 'title' ? 80 : 3,
        inputMode: secret ? 'numeric' : editing === 'title' ? 'text' : 'decimal',
        secret,
        submitLabel: 'Save',
      };
    },
    setText(value: string, position: number) {
      if (editing === 'pin' || editing === 'confirmPin') {
        if (!/^\d{0,4}$/.test(value)) return;
        const added = Math.max(0, value.length - text.length);
        beep(added);
      }
      text = value;
      cursor = position;
      replace = false;
      if (editing === 'title' || editing === 'unlockTimeoutSeconds') {
        deps.textState.nicknameInput = value;
        deps.textState.cursorPos = position;
        deps.setReplaceTextOnNextType(false);
      }
    },
    isSecretEdit: () => editing === 'pin' || editing === 'confirmPin',
    close,
  };
}
