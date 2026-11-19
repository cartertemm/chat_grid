import type { DoorAction, IncomingMessage } from '../network/protocol';
import type { WallStructure } from '../state/gameState';
import type { OptionSelectorRequest } from './optionSelector';
import type { ConfirmationRequest } from './confirmationController';
import type { NearbyDoor } from '../state/structureGeometry';
import { createDoorSettingsController } from './doorSettingsController';
import type { GameMode } from '../state/gameState';
import type { MobileTextEntry } from './mobileController';

type Result = Extract<IncomingMessage, { type: 'door_action_result' }>;
type Deps = {
  send: (packet: DoorAction) => void;
  setMode: (mode: GameMode) => void;
  getWall: (id: string) => WallStructure | undefined;
  textState: { nicknameInput: string; cursorPos: number };
  applyTextInputEdit: (code: string, key: string, maxLength: number, ctrlKey?: boolean, allowReplaceOnNextType?: boolean) => void;
  setReplaceTextOnNextType: (value: boolean) => void;
  choose: (request: OptionSelectorRequest) => void;
  confirm: (request: ConfirmationRequest) => void;
  status: (text: string) => void;
  normal: () => void;
  focusGrid: () => void;
  gridSize: () => number;
  cue: (success: boolean) => void;
  blip: () => void;
  keypadSound: (name: 'keypad' | 'keypad_good' | 'keypad_bad') => Promise<void>;
};

/** Wall builder menus and the private, exclusive door keypad. */
export function createDoorControls(deps: Deps) {
  const settings = createDoorSettingsController(deps);
  let keypad: { structureId: string; doorId: string } | null = null;
  let pending: { structureId: string; doorId: string } | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let audioSession = 0;
  let digitSounds = Promise.resolve();
  let submitted = false;
  let digits = '';
  let keypadAction = 'unlock';

  function close(keepResultAudio = false) {
    settings.close();
    if (!keepResultAudio) audioSession++;
    digitSounds = Promise.resolve();
    submitted = false;
    digits = '';
    clearTimeout(idleTimer);
    const hadKeypad = keypad !== null;
    keypad = null;
    pending = null;
    if (hadKeypad) {
      deps.normal();
      deps.focusGrid();
    }
  }

  function cancelKeypad() {
    if (keypad) deps.send({ type: 'door_action', action: 'keypad_cancel', ...keypad });
    close();
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      cancelKeypad();
      deps.status('Keypad timed out.');
    }, 10_000);
  }

  function setKeypadText(value: string) {
    if (!keypad || submitted || !value.startsWith(digits) || !/^\d{0,4}$/.test(value)) return;
    const session = audioSession;
    for (const digit of value.slice(digits.length)) {
      digitSounds = digitSounds.then(async () => {
        if (session === audioSession) await deps.keypadSound('keypad').catch(() => undefined);
      });
      deps.send({ type: 'door_action', action: 'keypad_digit', ...keypad, digit });
    }
    digits = value;
    if (digits.length === 4) {
      submitted = true;
      digitSounds = digitSounds.then(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
    }
    resetIdle();
  }

  function handleKeypadInput(code: string, key: string) {
    if (code === 'Escape') cancelKeypad();
    else if (/^\d$/.test(key)) setKeypadText(digits + key);
  }

  function edit(wall: WallStructure, back: () => void) {
    const doors = wall.doors ?? [];
    deps.choose({
      title: wall.title + ' doors',
      options: [
        { id: 'add', label: 'Add door' },
        ...doors.map((d) => ({ id: d.id, label: d.title + ', edge ' + (d.offset + 1) })),
      ],
      onCancel: back,
      onSelect(id) {
        if (id === 'add') {
          const horizontal = wall.orientation === 'horizontal';
          const line = horizontal ? wall.startY : wall.startX;
          const options = Array.from({ length: wall.length }, (_, i) => i)
            .filter((i) => line > 0 && line < deps.gridSize() && !doors.some((d) => d.offset === i))
            .map((i) => ({
              id: String(i),
              label:
                'Edge ' +
                (i + 1) +
                ', ' +
                (wall.startX + (horizontal ? i : 0)) +
                ', ' +
                (wall.startY + (horizontal ? 0 : i)),
            }));
          if (!options.length) {
            back();
            deps.status('No available edges on this wall.');
            return;
          }
          deps.choose({
            title: 'Add door',
            options,
            onCancel: back,
            onSelect(offset) {
              back();
              deps.send({ type: 'door_action', action: 'add', structureId: wall.id, offset: Number(offset) });
            },
          });
          return;
        }
        const door = doors.find((d) => d.id === id);
        if (!door) {
          back();
          return;
        }
        deps.choose({
          title: door.title,
          options: [
            { id: 'settings', label: 'Door settings' },
            { id: 'remove', label: 'Remove door' },
          ],
          onCancel: back,
          onSelect(action) {
            if (action === 'settings') {
              settings.open(wall, door, () => edit(deps.getWall(wall.id) ?? wall, back));
              return;
            }
            deps.confirm({
              prompt: 'Remove ' + door.title + ' and restore the wall edge?',
              onCancel: back,
              onConfirm() {
                back();
                deps.send({
                  type: 'door_action',
                  action: 'remove',
                  structureId: wall.id,
                  doorId: id,
                  revision: door.revision,
                });
              },
            });
          },
        });
      },
    });
  }

  function use(target: NearbyDoor, manualLock: boolean) {
    const { wall, door, freeSide } = target;
    deps.normal();
    const action = manualLock
      ? door.isLocked
        ? 'unlock'
        : 'lock'
      : door.isOpen
        ? 'close'
        : door.isLocked && !freeSide
          ? 'unlock'
          : 'open';
    pending = { structureId: wall.id, doorId: door.id };
    deps.send({
      type: 'door_action',
      structureId: wall.id,
      doorId: door.id,
      revision: door.revision,
      action,
    });
  }

  function result(reply: Result) {
    if (settings.result(reply)) return;
    if (reply.action !== 'keypad_digit' && !(reply.action === 'update' && reply.ok)) deps.status(reply.message);
    const key = { structureId: reply.structureId, doorId: reply.doorId ?? '' };
    const matches = (value: typeof keypad) =>
      value?.structureId === key.structureId && value?.doorId === key.doorId;
    if (reply.keypadActive && !keypad && matches(pending) && reply.ok) {
      close();
      keypad = key;
      keypadAction = reply.keypadAction ?? 'unlock';
      deps.setMode('doorKeypad');
      deps.focusGrid();
      resetIdle();
    } else if (!reply.keypadActive && (matches(keypad) || matches(pending))) {
      if (matches(keypad) && submitted && reply.action === 'keypad_digit') {
        const session = audioSession;
        void digitSounds.then(() => {
          if (session === audioSession) return deps.keypadSound(reply.ok ? 'keypad_good' : 'keypad_bad');
        }).catch(() => undefined);
        close(true);
      } else {
        close();
        deps.cue(reply.ok);
      }
    }
  }
  return {
    edit, use, result, close, handleKeypadInput, setKeypadText,
    getKeypadTextEntry: (): MobileTextEntry | null => keypad ? {
      label: 'Four-digit PIN to ' + keypadAction,
      value: digits,
      maxLength: 4,
      inputMode: 'numeric',
      secret: true,
      submitLabel: 'Enter',
    } : null,
    handleSettingsInput: settings.handleInput,
    getSettingsTextEntry: settings.getTextEntry,
    setSettingsText: settings.setText,
    isSecretSettingsEdit: settings.isSecretEdit,
  };
}
