// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDoorControls } from './doorControls';
import {
  adjacentDoors,
  adjacentWallDescriptions,
  blockingWallForMove,
  wallAcousticMixBetween,
} from '../state/structureGeometry';
import type { WallStructure } from '../state/gameState';

const wall: WallStructure = {
  id: 'w',
  title: 'Wall',
  floorZ: 0,
  orientation: 'horizontal',
  startX: 0,
  startY: 2,
  length: 3,
  movementBlocked: true,
  soundTransmission: 0,
  occlusionLowpassHz: 500,
  height: 40,
  preset: 'brick',
  contactSound: '',
  doors: [
    {
      id: 'd',
      title: 'Studio',
      offset: 1,
      revision: 4,
      hasPin: true,
      isLocked: true,
      isOpen: false,
      unlockMode: 'keypad',
      keypadSides: 'negative',
      pinRequiredFor: 'unlock',
      unlockTimeoutSeconds: 0,
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('door controls', () => {
  it('uses the approach side, movement state and acoustics of the selected edge', () => {
    const [protectedSide] = adjacentDoors([wall], 1, 1, 0);
    expect(protectedSide).toMatchObject({ direction: 'north', freeSide: false });
    expect(adjacentDoors([wall], 1, 2, 0)[0]).toMatchObject({ direction: 'south', freeSide: true });
    expect(adjacentDoors([wall], 1, 2, 40)).toEqual([]);
    expect(adjacentWallDescriptions([wall], 1, 1, 0)).toEqual(['Studio, north, closed, locked']);
    const listener = { x: 1, y: 1, z: 0 };
    const source = { x: 1, y: 2, z: 0 };
    expect(wallAcousticMixBetween([wall], listener, source).gain).toBeCloseTo(0.15);
    const opened = { ...wall, doors: [{ ...protectedSide.door, isOpen: true }] };
    expect(blockingWallForMove([opened], 1, 1, 0, 1, 2)).toBeNull();
    expect(blockingWallForMove([opened], 0, 1, 0, 0, 2)).not.toBeNull();
    expect(wallAcousticMixBetween([opened], listener, source).gain).toBe(1);
  });

  it('shows PIN policy only for Keypad and initially selects Unlock', () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() });
    const choose = vi.fn();
    const controls = createDoorControls({ send: vi.fn(), choose, confirm: vi.fn(), status: vi.fn(),
      normal: vi.fn(), focusGrid: vi.fn(), gridSize: () => 41, cue: vi.fn(), keypadSound: vi.fn() });
    const plain = { ...wall, doors: wall.doors?.map(d => ({ ...d, unlockMode: 'none' as const, hasPin: false })) };
    controls.edit(plain, vi.fn());
    choose.mock.lastCall![0].onSelect('d');
    choose.mock.lastCall![0].onSelect('settings');
    const group = document.querySelector('fieldset')!;
    const mode = document.querySelector('select')!;
    expect(group.hidden).toBe(true);
    expect(group.disabled).toBe(true);
    mode.value = 'keypad';
    mode.dispatchEvent(new Event('change'));
    expect(group.hidden).toBe(false);
    expect(group.querySelectorAll('select')[1].value).toBe('unlock');
  });

  it.each([true, false])('plays the server result after four beeps and a pause (accepted: %s)', async (ok) => {
    vi.useFakeTimers();
    const keypadSound = vi.fn().mockResolvedValue(undefined);
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: vi.fn() },
      close: { configurable: true, value: vi.fn() },
    });
    const send = vi.fn();
    const controls = createDoorControls({
      send,
      choose: vi.fn(),
      confirm: vi.fn(),
      status: vi.fn(),
      normal: vi.fn(),
      focusGrid: vi.fn(),
      gridSize: () => 41,
      cue: vi.fn(),
      keypadSound,
    });
    const [target] = adjacentDoors([wall], 1, 1, 0);
    controls.use(target, false);
    expect(send.mock.lastCall?.[0].action).toBe('unlock');
    const result = {
      type: 'door_action_result',
      action: 'unlock',
      ok: true,
      message: 'Enter PIN.',
      structureId: 'w',
      doorId: 'd',
      keypadAction: 'unlock',
    } as const;
    controls.result({ ...result, keypadActive: true });
    const input = document.querySelector('input')!;
    expect(input.type).toBe('password');
    input.value = '0042';
    input.dispatchEvent(new Event('input'));
    expect(send.mock.calls.slice(1).map(([packet]) => packet.digit)).toEqual(['0', '0', '4', '2']);
    controls.result({ ...result, ok, action: 'keypad_digit', message: ok ? 'Unlocked.' : 'Incorrect PIN.', keypadActive: false });
    expect(document.querySelector('dialog')).toBeNull();
    expect(send).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(299);
    expect(keypadSound.mock.calls.flat()).toEqual(Array(4).fill('keypad'));
    await vi.advanceTimersByTimeAsync(1);
    expect(keypadSound.mock.lastCall).toEqual([ok ? 'keypad_good' : 'keypad_bad']);
    if (!ok) return;
    controls.use({ ...target, door: { ...target.door, isLocked: false } }, false);
    expect(send.mock.lastCall?.[0].action).toBe('open');
  });
});
