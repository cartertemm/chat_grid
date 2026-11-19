import { describe, expect, it, vi } from 'vitest';
import { createInitialState, type StructurePreset, type WallStructure } from '../state/gameState';
import { createWorldBuilderController } from './worldBuilderController';

const brick: StructurePreset = {
  id: 'brick',
  title: 'Brick',
  movementBlocked: true,
  soundTransmission: 0,
  occlusionLowpassHz: 800,
  height: 40,
  contactSound: '/sounds/wall.ogg',
};
const curtain: StructurePreset = {
  ...brick,
  id: 'curtain',
  title: 'Curtain',
  movementBlocked: false,
  soundTransmission: 0.5,
};

function setup() {
  const state = createInitialState();
  state.player.x = 4;
  state.player.y = 4;
  const wall: WallStructure = {
    ...brick,
    id: 'wall-1',
    preset: brick.id,
    floorZ: 0,
    startX: 4,
    startY: 5,
    orientation: 'horizontal',
    length: 2,
  };
  state.structures.set(wall.id, wall);
  const send = vi.fn();
  const openOptionSelector = vi.fn();
  const updateStatus = vi.fn();
  const announceMenuEntry = vi.fn();
  const controller = createWorldBuilderController({
    state,
    hasPermission: () => true,
    send,
    updateStatus,
    announceMenuEntry,
    blip: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    applyTextInputEdit: vi.fn(),
    setReplaceTextOnNextType: vi.fn(),
    openOptionSelector,
    openConfirmation: vi.fn(),
  });
  controller.setPresets([brick, curtain]);
  controller.open();
  controller.handleRoot('ArrowDown', 'ArrowDown');
  controller.handleRoot('Enter', 'Enter');
  controller.handleWallList('Enter', 'Enter');
  return { announceMenuEntry, controller, openOptionSelector, send, state, updateStatus };
}

describe('World Builder wall controls', () => {
  it('announces only the confirmed setting value and preserves server errors', () => {
    const { controller, state, updateStatus } = setup();
    updateStatus.mockClear();
    controller.handleWallActions('ArrowRight', 'ArrowRight');
    expect(updateStatus).not.toHaveBeenCalled();
    state.structures.set('wall-1', { ...state.structures.get('wall-1')!, ...curtain, id: 'wall-1', preset: 'curtain' });
    controller.handleActionResult({ ok: true, action: 'update', structureId: 'wall-1', message: 'Curtain' });
    expect(updateStatus.mock.calls).toEqual([['Curtain']]);

    controller.handleWallActions('ArrowDown', 'ArrowDown');
    updateStatus.mockClear();
    controller.handleWallActions('ArrowRight', 'ArrowRight');
    state.structures.set('wall-1', { ...state.structures.get('wall-1')!, orientation: 'vertical' });
    controller.handleActionResult({ ok: true, action: 'rotate', structureId: 'wall-1', message: 'Vertical' });
    expect(updateStatus.mock.calls).toEqual([['Vertical']]);
    controller.handleWallActions('ArrowRight', 'ArrowRight');
    controller.handleActionResult({ ok: false, action: 'rotate', message: 'Wall does not fit.' });
    expect(updateStatus).toHaveBeenLastCalledWith('Wall does not fit.');
  });

  it('announces only the acoustic value after an adjustment is accepted', () => {
    const { controller, state, updateStatus } = setup();
    for (let step = 0; step < 5; step++) controller.handleWallActions('ArrowDown', 'ArrowDown');
    controller.handleWallActions('Enter', 'Enter');
    updateStatus.mockClear();
    controller.handlePropertyList('ArrowRight', 'ArrowRight');
    expect(updateStatus).not.toHaveBeenCalled();
    state.structures.set('wall-1', { ...state.structures.get('wall-1')!, soundTransmission: 0.05 });
    controller.handleActionResult({ ok: true, action: 'update', structureId: 'wall-1', message: '0.05' });
    expect(updateStatus.mock.calls).toEqual([['0.05']]);
  });

  it('keeps acoustic adjustments cumulative across canonical replies and discards rejected input', () => {
    const { controller, send, state } = setup();
    for (let step = 0; step < 5; step++) controller.handleWallActions('ArrowDown', 'ArrowDown');
    controller.handleWallActions('Enter', 'Enter');
    controller.handlePropertyList('ArrowRight', 'ArrowRight');
    controller.handlePropertyList('ArrowRight', 'ArrowRight');
    expect(state.structures.get('wall-1')?.soundTransmission).toBe(0);
    state.structures.set('wall-1', { ...state.structures.get('wall-1')!, soundTransmission: 0.05 });
    controller.handleActionResult({ ok: true, action: 'update', structureId: 'wall-1', message: '0.05' });
    controller.handlePropertyList('ArrowRight', 'ArrowRight');
    expect(send).toHaveBeenLastCalledWith({ type: 'structure_update_wall', structureId: 'wall-1', soundTransmission: 0.15 });
    controller.handleActionResult({ ok: false, action: 'update', message: 'Rejected.' });
    controller.handleActionResult({ ok: false, action: 'update', message: 'Rejected.' });
    controller.handlePropertyList('ArrowRight', 'ArrowRight');
    expect(send).toHaveBeenLastCalledWith({ type: 'structure_update_wall', structureId: 'wall-1', soundTransmission: 0.1 });
    controller.setPresets([brick, curtain]);
    controller.handlePropertyList('ArrowRight', 'ArrowRight');
    expect(send).toHaveBeenLastCalledWith({ type: 'structure_update_wall', structureId: 'wall-1', soundTransmission: 0.1 });
  });

  it('cycles wall types directly and opens the shared option selector', () => {
    const { controller, openOptionSelector, send, state, updateStatus } = setup();

    controller.handleWallActions('Space', ' ');
    expect(updateStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('Type: list. Options: Brick, Curtain.'),
    );

    controller.handleWallActions('ArrowRight', 'ArrowRight');
    expect(send).toHaveBeenLastCalledWith({
      type: 'structure_update_wall',
      structureId: 'wall-1',
      preset: 'curtain',
    });
    expect(state.structures.get('wall-1')?.preset).toBe('brick');
    expect(state.structures.get('wall-1')?.id).toBe('wall-1');

    controller.handleWallActions('Enter', 'Enter');
    expect(openOptionSelector).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Wall type',
      selectedId: 'curtain',
    }));
  });

  it('sends slide and anchored-orientation edits from wall actions', () => {
    const { controller, openOptionSelector, send } = setup();
    controller.handleWallActions('ArrowDown', 'ArrowDown');
    controller.handleWallActions('ArrowDown', 'ArrowDown');
    controller.handleWallActions('ArrowDown', 'ArrowDown');
    controller.handleWallActions('ArrowDown', 'ArrowDown');
    controller.handleWallActions('ArrowRight', 'ArrowRight');
    expect(send).toHaveBeenLastCalledWith({
      type: 'structure_slide_wall',
      structureId: 'wall-1',
      delta: 1,
    });

    controller.handleWallActions('ArrowUp', 'ArrowUp');
    controller.handleWallActions('ArrowUp', 'ArrowUp');
    controller.handleWallActions('ArrowUp', 'ArrowUp');
    controller.handleWallActions('ArrowRight', 'ArrowRight');
    expect(send).toHaveBeenLastCalledWith({
      type: 'structure_rotate_wall',
      structureId: 'wall-1',
      orientation: 'vertical',
    });
    controller.handleWallActions('Enter', 'Enter');
    const request = openOptionSelector.mock.calls.at(-1)?.[0];
    request.onSelect('vertical');
    expect(send).toHaveBeenLastCalledWith({
      type: 'structure_rotate_wall',
      structureId: 'wall-1',
      orientation: 'vertical',
    });
  });

  it('shows the last occupied edge as the inclusive end coordinate', () => {
    const { controller, updateStatus } = setup();

    controller.handleWallActions('ArrowDown', 'ArrowDown');
    controller.handleWallActions('ArrowDown', 'ArrowDown');
    controller.handleWallActions('ArrowDown', 'ArrowDown');

    expect(updateStatus).toHaveBeenLastCalledWith('Set end edge: 5, 5, 0');
  });

  it('keeps detailed acoustic properties after the geometry actions', () => {
    const { controller, send } = setup();
    for (let step = 0; step < 5; step += 1) {
      controller.handleWallActions('ArrowDown', 'ArrowDown');
    }
    controller.handleWallActions('Enter', 'Enter');

    controller.handlePropertyList('ArrowRight', 'ArrowRight');

    expect(send).toHaveBeenLastCalledWith({
      type: 'structure_update_wall',
      structureId: 'wall-1',
      soundTransmission: 0.05,
    });
  });

  it('opens the shared wall editor after a wall is created', () => {
    const { announceMenuEntry, controller, state } = setup();
    state.mode = 'normal';

    controller.handleActionResult({
      ok: true,
      action: 'add',
      message: 'Added Brick.',
      structureId: 'wall-1',
    });

    expect(state.mode).toBe('worldBuilderWallActions');
    expect(announceMenuEntry).toHaveBeenLastCalledWith('Brick', 'Type: Brick');
  });

});
