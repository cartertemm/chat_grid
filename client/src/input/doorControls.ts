import type { DoorAction, IncomingMessage } from '../network/protocol';
import type { WallDoor, WallStructure } from '../state/gameState';
import type { OptionSelectorRequest } from './optionSelector';
import type { ConfirmationRequest } from './confirmationController';
import type { NearbyDoor } from '../state/structureGeometry';

type Result = Extract<IncomingMessage, { type: 'door_action_result' }>;
type Deps = {
  send: (packet: DoorAction) => void;
  choose: (request: OptionSelectorRequest) => void;
  confirm: (request: ConfirmationRequest) => void;
  status: (text: string) => void;
  normal: () => void;
  focusGrid: () => void;
  gridSize: () => number;
  cue: (success: boolean) => void;
};

function field(parent: HTMLElement, title: string, control: HTMLInputElement | HTMLSelectElement) {
  const label = document.createElement('label');
  label.textContent = title + ' ';
  label.append(control);
  parent.append(label);
  return control;
}

function select(options: [string, string][], current: string) {
  const input = document.createElement('select');
  for (const [value, label] of options) input.add(new Option(label, value));
  input.value = current;
  return input;
}

function pinInput() {
  const input = document.createElement('input');
  input.type = 'password';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.maxLength = 4;
  input.pattern = '[0-9]{4}';
  return input;
}

/** Wall builder menus and the private, exclusive door keypad. */
export function createDoorControls(deps: Deps) {
  let dialog: HTMLDialogElement | null = null;
  let keypad: { structureId: string; doorId: string } | null = null;
  let pending: { structureId: string; doorId: string } | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function close() {
    clearTimeout(idleTimer);
    keypad = null;
    pending = null;
    if (dialog) {
      dialog.close();
      dialog.remove();
      dialog = null;
      deps.focusGrid();
    }
  }

  function modal(title: string, cancel: () => void) {
    close();
    const box = document.createElement('dialog');
    box.className = 'door-dialog';
    box.setAttribute('aria-label', title);
    const heading = document.createElement('h2');
    heading.textContent = title;
    box.append(heading);
    box.addEventListener('cancel', (event) => {
      event.preventDefault();
      cancel();
    });
    document.body.append(box);
    dialog = box;
    return box;
  }

  function button(parent: HTMLElement, label: string, action: () => void) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.onclick = action;
    parent.append(node);
  }

  function settings(wall: WallStructure, door: WallDoor) {
    deps.normal();
    const box = modal('Door settings', close);
    const form = document.createElement('form');
    box.append(form);
    const name = document.createElement('input');
    name.value = door.title;
    name.maxLength = 80;
    name.required = true;
    field(form, 'Door name', name);
    const mode = select(
      [
        ['none', 'None'],
        ['keypad', 'Keypad'],
      ],
      door.unlockMode,
    );
    field(form, 'Unlock mode', mode);
    const group = document.createElement('fieldset');
    form.append(group);
    const pin = pinInput();
    field(group, door.hasPin ? 'New four-digit PIN (leave blank to keep)' : 'Four-digit PIN', pin);
    const confirmPin = pinInput();
    field(group, 'Confirm new PIN', confirmPin);
    const horizontal = wall.orientation === 'horizontal';
    const sides = select(
      [
        ['both', 'Both'],
        ['negative', horizontal ? 'South' : 'West'],
        ['positive', horizontal ? 'North' : 'East'],
      ],
      door.keypadSides,
    );
    field(group, 'Keypad sides', sides);
    const policy = select(
      [
        ['unlock', 'Unlock'],
        ['lock', 'Lock'],
        ['both', 'Both'],
      ],
      door.pinRequiredFor,
    );
    field(group, 'Require PIN for', policy);
    const timeout = document.createElement('input');
    Object.assign(timeout, {
      type: 'number',
      min: '0',
      max: '300',
      step: '1',
      required: true,
      value: String(door.unlockTimeoutSeconds),
    });
    field(group, 'Unlock timeout in seconds (0 stays unlocked)', timeout);
    function updateMode() {
      group.hidden = group.disabled = mode.value !== 'keypad';
      pin.required = !door.hasPin && !group.disabled;
    }
    mode.onchange = updateMode;
    updateMode();
    const save = document.createElement('button');
    save.textContent = 'Save';
    form.append(save);
    button(form, 'Cancel', close);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!group.disabled && pin.value !== confirmPin.value) {
        confirmPin.setCustomValidity('PINs must match.');
        confirmPin.reportValidity();
        confirmPin.setCustomValidity('');
        return;
      }
      const packet: DoorAction = {
        type: 'door_action',
        action: 'update',
        structureId: wall.id,
        doorId: door.id,
        revision: door.revision,
        title: name.value.trim(),
        unlockMode: mode.value as WallDoor['unlockMode'],
      };
      if (!group.disabled) {
        packet.keypadSides = sides.value as WallDoor['keypadSides'];
        packet.pinRequiredFor = policy.value as WallDoor['pinRequiredFor'];
        packet.unlockTimeoutSeconds = Number(timeout.value);
        if (pin.value) packet.pin = pin.value;
      }
      deps.send(packet);
      close();
    };
    box.showModal();
    name.focus();
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
              settings(wall, door);
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
    deps.status(reply.message);
    const key = { structureId: reply.structureId, doorId: reply.doorId ?? '' };
    const matches = (value: typeof keypad) =>
      value?.structureId === key.structureId && value?.doorId === key.doorId;
    if (reply.keypadActive && !keypad && matches(pending) && reply.ok) {
      const cancel = () => {
        deps.send({ type: 'door_action', action: 'keypad_cancel', ...key });
        close();
      };
      const box = modal('Door keypad', cancel);
      keypad = key;
      const input = pinInput();
      field(box, 'Four-digit PIN to ' + (reply.keypadAction ?? 'unlock'), input);
      button(box, 'Cancel', cancel);
      function resetIdle() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          cancel();
          deps.status('Keypad timed out.');
        }, 10_000);
      }
      let sent = '';
      input.oninput = () => {
        const value = input.value;
        if (!value.startsWith(sent) || !/^\d{0,4}$/.test(value)) {
          input.value = sent;
          return;
        }
        for (const digit of value.slice(sent.length))
          deps.send({ type: 'door_action', action: 'keypad_digit', ...key, digit });
        sent = value;
        if (sent.length === 4) input.readOnly = true;
        resetIdle();
      };
      box.showModal();
      input.focus();
      resetIdle();
    } else if (!reply.keypadActive && (matches(keypad) || matches(pending))) {
      close();
      deps.cue(reply.ok);
    }
  }
  return { edit, use, result, close };
}
