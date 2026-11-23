import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state/gameState';
import { createPlatformBuilderController } from './platformBuilderController';
import { parseCoordinate } from './coordinateControls';

function setup() {
  const state = createInitialState();
  state.player.x = 0;
  state.player.y = 0;
  const platform = { id: 'ground', name: 'Ground', startX: 0, startY: 0, endX: 40, endY: 40, z: 0 };
  state.platforms.set(platform.id, platform);
  const send = vi.fn();
  const updateStatus = vi.fn();
  const back = vi.fn();
  const openConfirmation = vi.fn();
  const controller = createPlatformBuilderController({
    state, hasPermission: () => true, send, updateStatus, announceMenuEntry: vi.fn(),
    blip: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), applyTextInputEdit: vi.fn(),
    setReplaceTextOnNextType: vi.fn(), openOptionSelector: vi.fn(), openConfirmation,
  }, back);
  return { controller, state, send, updateStatus, back, openConfirmation };
}

describe('platform coordinate editing', () => {
  it('keeps a new island in a draft until explicitly created and accepts signed coordinates', () => {
    const { controller, state, send, updateStatus } = setup();
    controller.openList();
    controller.handleList('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('Enter', 'Enter');
    expect(controller.getTextEntry()).toMatchObject({ label: 'Start X', inputMode: 'text', maxLength: 8 });
    state.nicknameInput = '-100';
    controller.handleEdit('Enter', 'Enter');
    expect(state.mode).toBe('worldBuilderPlatformActions');
    expect(updateStatus).toHaveBeenLastCalledWith('-100');
    expect(send).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('Enter', 'Enter');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'platform_add', name: 'Platform', startX: -100, startY: 0, endX: 0, endY: 0, z: 0 }));
  });

  it('announces shared help, only confirmed values, and server rejections', () => {
    const { controller, state, send, updateStatus } = setup();
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('Space', ' ');
    expect(updateStatus.mock.lastCall?.[0]).toContain('Range: -1000000 to 1000000 step 1.');
    updateStatus.mockClear();
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'platform_update', platformId: 'ground', startX: -1 }));
    expect(updateStatus).not.toHaveBeenCalled();
    state.platforms.set('ground', { ...state.platforms.get('ground')!, startX: -1 });
    controller.handleActionResult({ ok: true, requestId: send.mock.lastCall![0].requestId, platformId: 'ground', message: 'Platform saved.' });
    expect(updateStatus).toHaveBeenLastCalledWith('-1');
    controller.handleActions('ArrowRight', 'ArrowRight');
    controller.handleActionResult({ ok: false, requestId: send.mock.lastCall![0].requestId, message: 'Platform overlaps Bridge.' });
    expect(updateStatus).toHaveBeenLastCalledWith('Platform overlaps Bridge.');
  });

  it('rejects incomplete, fractional and excessive coordinates before sending', () => {
    for (const value of ['', '-', '1.5', '1000001', '1e3']) expect(parseCoordinate('Start X', value).ok).toBe(false);
    expect(parseCoordinate('Start X', '-1000000')).toEqual({ ok: true, value: -1000000 });
    const { controller, state, send } = setup();
    controller.openList();
    controller.handleList('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('Enter', 'Enter');
    state.nicknameInput = '';
    controller.handleEdit('Enter', 'Enter');
    expect(state.mode).toBe('worldBuilderPlatformEdit');
    expect(send).not.toHaveBeenCalled();
  });

  it('uses shared confirmation before deleting an existing platform', () => {
    const { controller, send, openConfirmation } = setup();
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    for (let i = 0; i < 6; i++) controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('Enter', 'Enter');
    expect(send).not.toHaveBeenCalled();
    expect(openConfirmation).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Delete Ground?' }));
    openConfirmation.mock.calls[0][0].onConfirm();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'platform_delete', platformId: 'ground' }));
  });

  it('ignores an abandoned create response after Escape and a newer editor session', () => {
    const { controller, state, send, updateStatus } = setup();
    controller.openList();
    controller.handleList('Enter', 'Enter');
    for (let i = 0; i < 6; i++) controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('Enter', 'Enter');
    const oldRequestId = send.mock.lastCall![0].requestId;
    controller.handleActions('Escape', 'Escape');
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    controller.handleActions('Enter', 'Enter');
    state.nicknameInput = 'Studio';
    controller.handleEdit('Enter', 'Enter');
    const newRequestId = send.mock.lastCall![0].requestId;
    expect(newRequestId).not.toBe(oldRequestId);
    updateStatus.mockClear();
    controller.handleActionResult({ ok: true, requestId: oldRequestId, platformId: 'island', message: 'Created.' });
    expect(state.mode).toBe('worldBuilderPlatformActions');
    expect(updateStatus).not.toHaveBeenCalled();
    state.platforms.set('ground', { ...state.platforms.get('ground')!, name: 'Studio' });
    controller.handleActionResult({ ok: true, requestId: newRequestId, platformId: 'ground', message: 'Saved.' });
    expect(updateStatus).toHaveBeenLastCalledWith('Studio');
  });

  it('clears rejected and reset mutations so the next session can edit', () => {
    const { controller, state, send, updateStatus } = setup();
    const openExisting = () => {
      controller.openList();
      controller.handleList('ArrowDown', 'ArrowDown');
      controller.handleList('Enter', 'Enter');
      controller.handleActions('ArrowDown', 'ArrowDown');
    };
    openExisting();
    controller.handleActions('ArrowRight', 'ArrowRight');
    const rejected = send.mock.lastCall![0].requestId;
    controller.handleActionResult({ ok: false, requestId: rejected, message: 'Player would lose support.' });
    expect(updateStatus).toHaveBeenLastCalledWith('Player would lose support.');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    const beforeReset = send.mock.lastCall![0].requestId;
    controller.reset();
    state.mode = 'normal';
    openExisting();
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    const afterReset = send.mock.lastCall![0].requestId;
    controller.handleActionResult({ ok: false, requestId: beforeReset, message: 'Old response.' });
    state.platforms.set('ground', { ...state.platforms.get('ground')!, startX: -1 });
    controller.handleActionResult({ ok: true, requestId: afterReset, platformId: 'ground', message: 'Saved.' });
    expect(updateStatus).toHaveBeenLastCalledWith('-1');
  });

  it('reads normalized bounds when an entered corner swaps the two edges', () => {
    const { controller, state, send, updateStatus } = setup();
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('Enter', 'Enter');
    state.nicknameInput = '100';
    controller.handleEdit('Enter', 'Enter');
    state.platforms.set('ground', { ...state.platforms.get('ground')!, startX: 40, endX: 100 });
    controller.handleActionResult({ ok: true, requestId: send.mock.lastCall![0].requestId, platformId: 'ground', message: 'Saved.' });
    expect(updateStatus).toHaveBeenLastCalledWith('40 to 100');
  });

  it('reconciles a selected platform removed by another builder', () => {
    const { controller, state, updateStatus } = setup();
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    controller.handleActions('Enter', 'Enter');
    state.platforms.delete('ground');
    controller.reconcileWorld();
    expect(state.mode).toBe('worldBuilderPlatformList');
    expect(updateStatus).toHaveBeenLastCalledWith('Platform no longer exists.');
    controller.handleList('Enter', 'Enter');
    expect(state.mode).toBe('worldBuilderPlatformActions');
  });

  it('preserves three quick adjustment presses using each authoritative result', () => {
    const { controller, state, send, updateStatus } = setup();
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    for (let i = 0; i < 3; i++) controller.handleActions('ArrowLeft', 'ArrowLeft');
    expect(send).toHaveBeenCalledTimes(1);
    for (let value = -1; value >= -3; value--) {
      expect(send.mock.lastCall![0].startX).toBe(value);
      state.platforms.set('ground', { ...state.platforms.get('ground')!, startX: value });
      controller.handleActionResult({ ok: true, requestId: send.mock.lastCall![0].requestId, platformId: 'ground', message: '' });
    }
    expect(send).toHaveBeenCalledTimes(3);
    expect(updateStatus).toHaveBeenLastCalledWith('-3');
  });

  it('discards queued adjustment presses on rejection or changing properties', () => {
    const { controller, send } = setup();
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActionResult({ ok: false, requestId: send.mock.lastCall![0].requestId, message: 'Would strand an item.' });
    expect(send).toHaveBeenCalledTimes(1);
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActionResult({ ok: true, requestId: send.mock.lastCall![0].requestId, platformId: 'ground', message: '' });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
