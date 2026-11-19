import { describe, expect, it, vi } from 'vitest';
import { createInitialState, type NamedRegion } from '../state/gameState';
import { createWorldBuilderController } from './worldBuilderController';

function setup() {
  const state = createInitialState();
  const send = vi.fn();
  const openConfirmation = vi.fn();
  const controller = createWorldBuilderController({
    state, send, hasPermission: () => true, openConfirmation,
    updateStatus: vi.fn(), announceMenuEntry: vi.fn(), blip: vi.fn(), confirm: vi.fn(), cancel: vi.fn(),
    applyTextInputEdit: vi.fn(), setReplaceTextOnNextType: vi.fn(), openOptionSelector: vi.fn(),
  });
  controller.open();
  controller.handleRoot('KeyR', 'r');
  controller.handleRoot('Enter', 'Enter');
  expect(state.mode).toBe('worldBuilderRegionRoot');
  return { controller, state, send, openConfirmation };
}

describe('named region builder', () => {
  it('creates, renames and adjusts canonical geometry through the existing builder', () => {
    const { controller, state, send } = setup();
    controller.handleRegionRoot('Enter', 'Enter');
    expect(send).toHaveBeenLastCalledWith({ type: 'region_add' });
    const region: NamedRegion = { id: 'new', name: 'Region', floorZ: 0, startX: 1, startY: 1, endX: 1, endY: 1 };
    state.regions.set(region.id, region);
    controller.handleRegionActionResult({ ok: true, action: 'add', regionId: region.id, message: 'Added Region.' });
    expect(state.mode).toBe('worldBuilderRegionActions');
    controller.handleRegionActions('Enter', 'Enter');
    state.nicknameInput = 'Studio';
    controller.handleRegionEdit('Enter', 'Enter');
    expect(send).toHaveBeenLastCalledWith({ type: 'region_update', regionId: region.id, name: 'Studio' });
    controller.handleRegionActions('ArrowDown', 'ArrowDown');
    controller.handleRegionActions('ArrowRight', 'ArrowRight');
    expect(send).toHaveBeenLastCalledWith({ type: 'region_resize', regionId: region.id, edge: 'west', delta: 1 });
    expect(state.regions.get(region.id)).toEqual(region);
  });

  it('uses confirmation for removal and detects a stale selected region', () => {
    const { controller, state, send, openConfirmation } = setup();
    const region: NamedRegion = { id: 'new', name: 'Studio', floorZ: 0, startX: 1, startY: 1, endX: 1, endY: 1 };
    state.regions.set(region.id, region);
    controller.handleRegionActionResult({ ok: true, action: 'add', regionId: region.id, message: 'Added.' });
    controller.handleRegionActions('KeyD', 'd');
    controller.handleRegionActions('Enter', 'Enter');
    expect(openConfirmation).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'region_delete' }));
    state.regions.delete(region.id);
    openConfirmation.mock.calls[0][0].onConfirm();
    expect(state.mode).toBe('worldBuilderRegionRoot');
    expect(send).not.toHaveBeenCalled();
  });
});
