import { describe, expect, it, vi } from 'vitest';
import { applyTextInput, mapTextInputKey } from './textInput';
import { createDoorSettingsController } from './doorSettingsController';
import type { GameMode, WallDoor, WallStructure } from '../state/gameState';

function setup(keypad = true) {
  const door: WallDoor = {
    id: 'd',
    title: 'Studio',
    offset: 0,
    revision: 4,
    hasPin: keypad,
    isLocked: false,
    isOpen: false,
    unlockMode: keypad ? 'keypad' : 'none',
    keypadSides: 'both',
    pinRequiredFor: 'unlock',
    unlockTimeoutSeconds: 0,
  };
  const wall = { id: 'w', orientation: 'horizontal', doors: [door] } as WallStructure;
  let mode: GameMode = 'normal';
  const send = vi.fn();
  const choose = vi.fn();
  const status = vi.fn();
  const keypadSound = vi.fn().mockResolvedValue(undefined);
  const back = vi.fn();
  const textState = { nicknameInput: '', cursorPos: 0 };
  const edit = vi.fn((code: string, value: string, maxLength: number) => {
    const result = applyTextInput(
      mapTextInputKey(code, value),
      textState.nicknameInput,
      textState.cursorPos,
      maxLength,
    );
    textState.nicknameInput = result.newString;
    textState.cursorPos = result.newCursorPos;
  });
  const controller = createDoorSettingsController({
    textState,
    setReplaceTextOnNextType: vi.fn(),
    applyTextInputEdit: edit,
    send,
    choose,
    status,
    cue: vi.fn(),
    blip: vi.fn(),
    keypadSound,
    getWall: () => wall,
    setMode: (next) => {
      mode = next;
    },
  });
  controller.open(wall, door, back);
  const key = (code: string, value = code) => controller.handleInput(mode, code, value);
  const reply = (ok = true) =>
    controller.result({
      type: 'door_action_result',
      action: 'update',
      ok,
      structureId: 'w',
      doorId: 'd',
      message: ok ? 'Updated.' : 'The door changed. Try again.',
      keypadActive: false,
    });
  return { door, wall, edit, controller, send, choose, status, keypadSound, back, key, reply, mode: () => mode };
}

describe('native door settings', () => {
  it('reads help for the selected keypad property without editing it', () => {
    const test = setup();
    for (let i = 0; i < 3; i++) test.key('ArrowDown');
    test.key('Space', ' ');
    expect(test.status).toHaveBeenLastCalledWith(expect.stringContaining('Options: Both, South, North.'));
    test.key('ArrowDown');
    test.key('ArrowDown');
    test.key('Space', ' ');
    expect(test.status).toHaveBeenLastCalledWith(expect.stringContaining('Range: 0 to 300 step 1.'));
    expect(test.mode()).toBe('doorSettings');
    expect(test.send).not.toHaveBeenCalled();
  });

  it('edits the name on Enter and waits for the authoritative revision before another update', () => {
    const test = setup();
    test.key('Enter');
    test.controller.setText('Music room', 10);
    test.key('Enter');
    expect(test.send).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Music room', revision: 4 }));
    test.key('ArrowDown');
    test.key('ArrowRight');
    expect(test.send).toHaveBeenCalledTimes(1);
    Object.assign(test.door, { title: 'Music room', revision: 5 });
    test.reply();
    test.key('ArrowDown');
    test.key('ArrowRight');
    expect(test.send).toHaveBeenLastCalledWith(expect.objectContaining({ unlockMode: 'none', revision: 5 }));
  });

  it('opens shared selectors and names keypad sides for the wall orientation', () => {
    const test = setup();
    test.key('ArrowDown');
    test.key('ArrowDown');
    test.key('ArrowDown');
    test.key('Enter');
    const request = test.choose.mock.lastCall![0];
    expect(request.options).toEqual([
      { id: 'both', label: 'Both' },
      { id: 'negative', label: 'South' },
      { id: 'positive', label: 'North' },
    ]);
    request.onSelect('positive');
    expect(test.send).toHaveBeenLastCalledWith(expect.objectContaining({ keypadSides: 'positive' }));
    test.door.keypadSides = 'positive';
    test.status.mockClear();
    test.reply();
    expect(test.status.mock.calls).toEqual([['North']]);
  });

  it('announces just the confirmed property value when adjusting with arrows', () => {
    const test = setup();
    for (let i = 0; i < 5; i++) test.key('ArrowDown');
    test.status.mockClear();
    test.key('ArrowRight');
    test.key('ArrowRight');
    expect(test.status).not.toHaveBeenCalled();
    test.door.unlockTimeoutSeconds = 1;
    test.reply();
    expect(test.status.mock.calls).toEqual([['1 second']]);
    test.key('ArrowRight');
    test.reply(false);
    expect(test.status).toHaveBeenLastCalledWith('The door changed. Try again.');
  });

  it('delegates public editing shortcuts to the shared text editor', () => {
    const test = setup();
    test.key('Enter');
    test.controller.handleInput('doorSettingsEdit', 'ArrowLeft', 'ArrowLeft', true);
    expect(test.edit).toHaveBeenCalledWith('ArrowLeft', 'ArrowLeft', 80, true, true);
  });

  it('applies the clamped timeout value once and stops at its boundary', () => {
    const test = setup();
    test.door.unlockTimeoutSeconds = 295;
    for (let i = 0; i < 5; i++) test.key('ArrowDown');
    test.key('PageUp');
    expect(test.send).toHaveBeenLastCalledWith(expect.objectContaining({ unlockTimeoutSeconds: 300 }));
    test.door.unlockTimeoutSeconds = 300;
    test.door.revision++;
    test.reply();
    test.key('PageUp');
    expect(test.send).toHaveBeenCalledTimes(1);
  });

  it('requires and confirms a private four-digit PIN before enabling keypad mode', async () => {
    const test = setup(false);
    test.key('ArrowDown');
    test.key('ArrowRight');
    expect(test.mode()).toBe('doorSettingsEdit');
    expect(test.send).not.toHaveBeenCalled();
    test.status.mockClear();
    for (const digit of '0042') test.key('Digit' + digit, digit);
    expect(test.status).not.toHaveBeenCalled();
    expect(test.controller.getTextEntry()).toMatchObject({
      secret: true,
      inputMode: 'numeric',
      maxLength: 4,
    });
    test.key('Enter');
    expect(test.controller.getTextEntry()).toMatchObject({ value: '', label: 'Confirm new PIN' });
    test.controller.setText('0042', 4);
    test.key('Enter');
    expect(test.send).toHaveBeenCalledTimes(1);
    expect(test.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ unlockMode: 'keypad', pin: '0042' }),
    );
    expect(test.controller.getTextEntry()).toBeNull();
    await vi.waitFor(() => expect(test.keypadSound.mock.calls.flat()).toEqual(Array(8).fill('keypad')));
  });

  it('discards mismatched and cancelled PIN edits without sending them', () => {
    const test = setup(false);
    test.key('ArrowDown');
    test.key('ArrowRight');
    test.controller.setText('1234', 4);
    test.key('Enter');
    test.controller.setText('1235', 4);
    test.key('Enter');
    expect(test.controller.getTextEntry()).toMatchObject({ value: '', label: 'New four-digit PIN' });
    test.key('Escape');
    expect(test.controller.getTextEntry()).toBeNull();
    expect(test.send).not.toHaveBeenCalled();
    test.key('Escape');
    expect(test.back).toHaveBeenCalledOnce();
  });

  it('uses stepped timeout adjustment and validates numeric text without altering the door locally', () => {
    const test = setup();
    for (let i = 0; i < 5; i++) test.key('ArrowDown');
    test.key('PageUp');
    expect(test.send).toHaveBeenLastCalledWith(expect.objectContaining({ unlockTimeoutSeconds: 10 }));
    expect(test.door.unlockTimeoutSeconds).toBe(0);
    test.reply(false);
    test.key('Enter');
    test.controller.setText('301', 3);
    test.key('Enter');
    expect(test.send).toHaveBeenCalledTimes(1);
    test.key('ArrowDown');
    expect(test.controller.getTextEntry()?.value).toBe('300');
    test.key('Enter');
    expect(test.send).toHaveBeenLastCalledWith(expect.objectContaining({ unlockTimeoutSeconds: 300 }));
  });
});
