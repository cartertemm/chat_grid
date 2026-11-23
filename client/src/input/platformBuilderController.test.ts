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
  const openOptionSelector = vi.fn();
  const cancel = vi.fn();
  const controller = createPlatformBuilderController({
    state, hasPermission: () => true, send, updateStatus, announceMenuEntry: vi.fn(),
    blip: vi.fn(), confirm: vi.fn(), cancel, applyTextInputEdit: vi.fn(),
    setReplaceTextOnNextType: vi.fn(), openOptionSelector, openConfirmation,
  }, back);
  return { controller, state, send, updateStatus, back, openConfirmation, openOptionSelector, cancel };
}

describe('platform coordinate editing', () => {
  it('uses shared footstep choices and announces only the accepted sound set', () => {
    const { controller, state, send, updateStatus, openOptionSelector } = setup();
    controller.setFootstepSets([
      { id: 'default', title: 'Default', urls: ['/sounds/steps/default/step-1.ogg'] },
      { id: 'wood', title: 'Wood', urls: ['/sounds/steps/wood/step-1.ogg'] },
    ]);
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    for (let i = 0; i < 6; i++) controller.handleActions('ArrowDown', 'ArrowDown');
    expect(updateStatus).toHaveBeenLastCalledWith('Footsteps: Default');
    controller.handleActions('Space', ' ');
    expect(updateStatus.mock.lastCall?.[0]).toContain('Choose the footstep sounds');
    updateStatus.mockClear();
    controller.handleActions('ArrowRight', 'ArrowRight');
    expect(send.mock.lastCall?.[0]).toMatchObject({ type: 'platform_update', footstepSet: 'wood' });
    expect(updateStatus).not.toHaveBeenCalled();
    state.platforms.set('ground', { ...state.platforms.get('ground')!, footstepSet: 'wood' });
    controller.handleActionResult({ ok: true, requestId: send.mock.lastCall![0].requestId, platformId: 'ground', message: '' });
    expect(updateStatus).toHaveBeenLastCalledWith('Wood');
    controller.handleActions('Enter', 'Enter');
    const selector = openOptionSelector.mock.lastCall![0];
    expect(selector).toMatchObject({ title: 'Footsteps', selectedId: 'wood' });
    expect(selector.options).toEqual([{ id: 'default', label: 'Default' }, { id: 'wood', label: 'Wood' }]);
    selector.onSelect('default');
    expect(send.mock.lastCall?.[0]).toMatchObject({ type: 'platform_update', footstepSet: 'default' });
    expect(state.mode).toBe('worldBuilderPlatformActions');
  });

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
    for (let i = 0; i < 6; i++) controller.handleActions('ArrowDown', 'ArrowDown');
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
    for (let i = 0; i < 7; i++) controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('Enter', 'Enter');
    expect(send).not.toHaveBeenCalled();
    expect(openConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Delete Ground? People on it move to 0, 0, 0, or the lowest corner of the first remaining platform.',
    }));
    openConfirmation.mock.calls[0][0].onConfirm();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'platform_delete', platformId: 'ground' }));
  });

  it('ignores an abandoned create response after Escape and a newer editor session', () => {
    const { controller, state, send, updateStatus } = setup();
    controller.openList();
    controller.handleList('Enter', 'Enter');
    for (let i = 0; i < 7; i++) controller.handleActions('ArrowDown', 'ArrowDown');
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

  it('discards queued adjustment presses on rejection', () => {
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
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('preserves adjustment order across rows and only speaks the selected property', () => {
    const { controller, state, send, updateStatus } = setup();
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    updateStatus.mockClear();

    for (const [property, value] of [['startX', -1], ['startX', -2], ['startY', -1], ['startY', -2]] as const) {
      expect(send.mock.lastCall![0]).toMatchObject({ [property]: value });
      state.platforms.set('ground', { ...state.platforms.get('ground')!, [property]: value });
      controller.handleActionResult({ ok: true, requestId: send.mock.lastCall![0].requestId, platformId: 'ground', message: '' });
    }

    expect(send).toHaveBeenCalledTimes(4);
    expect(updateStatus.mock.calls).toEqual([['-1'], ['-2']]);
  });

  it('drops the rejected property steps and continues edits to other properties', () => {
    const { controller, state, send, updateStatus } = setup();
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowUp', 'ArrowUp');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowDown', 'ArrowDown');

    controller.handleActionResult({ ok: false, requestId: send.mock.lastCall![0].requestId, message: 'Would strand an item.' });
    expect(updateStatus).toHaveBeenLastCalledWith('Would strand an item.');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.lastCall![0]).toMatchObject({ startY: -1 });
    state.platforms.set('ground', { ...state.platforms.get('ground')!, startY: -1 });
    controller.handleActionResult({ ok: true, requestId: send.mock.lastCall![0].requestId, platformId: 'ground', message: '' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(updateStatus).toHaveBeenLastCalledWith('-1');
  });

  it('silently skips a queued boundary on a property the user has left', () => {
    const { controller, state, send, cancel } = setup();
    state.platforms.set('ground', { ...state.platforms.get('ground')!, startX: -999999 });
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowLeft', 'ArrowLeft');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('ArrowLeft', 'ArrowLeft');

    state.platforms.set('ground', { ...state.platforms.get('ground')!, startX: -1000000 });
    controller.handleActionResult({ ok: true, requestId: send.mock.lastCall![0].requestId, platformId: 'ground', message: '' });
    expect(cancel).not.toHaveBeenCalled();
    expect(send.mock.lastCall![0]).toMatchObject({ startY: -1 });
  });

  it('calculates a queued property adjustment from the normalized server bounds', () => {
    const { controller, state, send, updateStatus } = setup();
    controller.openList();
    controller.handleList('ArrowDown', 'ArrowDown');
    controller.handleList('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('Enter', 'Enter');
    state.nicknameInput = '100';
    controller.handleEdit('Enter', 'Enter');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('ArrowDown', 'ArrowDown');
    controller.handleActions('ArrowRight', 'ArrowRight');
    updateStatus.mockClear();

    state.platforms.set('ground', { ...state.platforms.get('ground')!, startX: 40, endX: 100 });
    controller.handleActionResult({ ok: true, requestId: send.mock.lastCall![0].requestId, platformId: 'ground', message: '' });
    expect(send.mock.lastCall![0]).toMatchObject({ endX: 101 });
    expect(updateStatus).not.toHaveBeenCalled();
    state.platforms.set('ground', { ...state.platforms.get('ground')!, endX: 101 });
    controller.handleActionResult({ ok: true, requestId: send.mock.lastCall![0].requestId, platformId: 'ground', message: '' });
    expect(updateStatus).toHaveBeenLastCalledWith('101');
  });
});
