import { describe, expect, it, vi } from 'vitest';
import { createInitialState, type AmbianceRegion, type AmbianceType } from '../state/gameState';
import { createWorldBuilderController } from './worldBuilderController';

const types: AmbianceType[] = [
  { id: 'rain', title: 'Rain', url: '/sounds/rain.ogg' },
  { id: 'wind', title: 'Wind', url: '/sounds/wind.ogg' },
];
const cyclingTypes: AmbianceType[] = [
  ...types,
  { id: 'water', title: 'Water', url: '/sounds/water.ogg' },
  { id: 'fire', title: 'Fire', url: '/sounds/fire.ogg' },
];

function ambiance(overrides: Partial<AmbianceRegion> = {}): AmbianceRegion {
  return {
    id: 'ambiance-1',
    name: 'Courtyard',
    soundId: 'rain',
    floorZ: 0,
    startX: 4,
    startY: 4,
    endX: 4,
    endY: 4,
    volume: 25,
    fadeDistance: 3,
    ...overrides,
  };
}

function setup(options: { permission?: boolean; regions?: AmbianceRegion[]; types?: AmbianceType[] } = {}) {
  const state = createInitialState();
  state.player.x = 4;
  state.player.y = 4;
  for (const region of options.regions ?? [ambiance()]) state.ambiances.set(region.id, region);
  const send = vi.fn();
  const updateStatus = vi.fn();
  const announceMenuEntry = vi.fn();
  const openOptionSelector = vi.fn();
  const openConfirmation = vi.fn();
  const blip = vi.fn();
  const confirm = vi.fn();
  const cancel = vi.fn();
  let permitted = options.permission ?? true;
  const controller = createWorldBuilderController({
    state,
    hasPermission: () => permitted,
    send,
    updateStatus,
    announceMenuEntry,
    blip,
    confirm,
    cancel,
    applyTextInputEdit: vi.fn(),
    setReplaceTextOnNextType: vi.fn(),
    openOptionSelector,
    openConfirmation,
  });
  controller.setAmbianceTypes(options.types ?? types);
  return {
    announceMenuEntry,
    blip,
    confirm,
    cancel,
    controller,
    openConfirmation,
    openOptionSelector,
    send,
    setPermission: (value: boolean) => { permitted = value; },
    state,
    updateStatus,
  };
}

function openAmbianceActions(controller: ReturnType<typeof createWorldBuilderController>, state: ReturnType<typeof createInitialState>) {
  controller.open();
  controller.handleRoot('ArrowDown', 'ArrowDown');
  controller.handleRoot('ArrowDown', 'ArrowDown');
  controller.handleRoot('ArrowDown', 'ArrowDown');
  controller.handleRoot('Enter', 'Enter');
  controller.handleAmbianceList('Enter', 'Enter');
  expect(state.mode).toBe('worldBuilderAmbianceActions');
}

describe('World Builder ambiance controls', () => {
  it('reads property metadata help for ambiance geometry and volume without editing', () => {
    const { controller, state, send, updateStatus } = setup();
    openAmbianceActions(controller, state);
    for (let step = 0; step < 2; step++) controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('Space', ' ');
    expect(updateStatus).toHaveBeenLastCalledWith(
      'Move the west edge by one square with Left or Right. Type: number. Editable.',
    );
    for (let step = 0; step < 6; step++) controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('Space', ' ');
    expect(updateStatus).toHaveBeenLastCalledWith(
      'Set the ambiance volume from silent to full volume. Type: number. Range: 0 to 100 step 5. Editable.',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('announces one server-confirmed value and plays one sound for an arrow adjustment', () => {
    const { controller, state, updateStatus, blip, confirm, cancel } = setup();
    openAmbianceActions(controller, state);
    for (let index = 0; index < 8; index += 1) controller.handleAmbianceActions('ArrowDown', '');
    updateStatus.mockClear();
    blip.mockClear();
    confirm.mockClear();
    cancel.mockClear();
    controller.handleAmbianceActions('ArrowRight', '');
    expect(updateStatus).not.toHaveBeenCalled();
    expect(blip).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    state.ambiances.set('ambiance-1', { ...state.ambiances.get('ambiance-1')!, volume: 30 });
    controller.handleAmbianceActionResult({
      ok: true, action: 'update', ambianceId: 'ambiance-1', message: '30 percent',
    });
    expect(updateStatus).toHaveBeenCalledTimes(1);
    expect(updateStatus).toHaveBeenCalledWith('30 percent');
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('plays only the boundary sound and sends no update when already at a numeric limit', () => {
    const { controller, state, blip, confirm, cancel, send } = setup({ regions: [ambiance({ volume: 100 })] });
    openAmbianceActions(controller, state);
    for (let index = 0; index < 8; index += 1) controller.handleAmbianceActions('ArrowDown', '');
    blip.mockClear();
    controller.handleAmbianceActions('ArrowRight', '');
    expect(send).not.toHaveBeenCalled();
    expect(blip).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('plays only the server confirmation when cycling ambiance type', () => {
    const { controller, state, blip, confirm, cancel } = setup();
    openAmbianceActions(controller, state);
    blip.mockClear();
    controller.handleAmbianceActions('ArrowRight', '');
    expect(blip).not.toHaveBeenCalled();
    controller.handleAmbianceActionResult({ ok: true, action: 'update', message: 'Wind', ambianceId: 'ambiance-1' });
    expect(confirm).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('keeps volume adjustments cumulative across an interleaved upsert and result', () => {
    const { controller, send, state } = setup();
    openAmbianceActions(controller, state);
    const initial = ambiance();

    for (let step = 0; step < 8; step += 1) controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'ambiance_update', ambianceId: 'ambiance-1', volume: 30 },
      { type: 'ambiance_update', ambianceId: 'ambiance-1', volume: 35 },
    ]);
    expect(state.ambiances.get('ambiance-1')).toEqual(initial);

    state.ambiances.set('ambiance-1', { ...initial, volume: 30 });
    controller.handleAmbianceActionResult({ ok: true, action: 'update', message: '30 percent', ambianceId: 'ambiance-1' });
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');

    expect(send).toHaveBeenLastCalledWith({ type: 'ambiance_update', ambianceId: 'ambiance-1', volume: 40 });
    expect(state.ambiances.get('ambiance-1')?.volume).toBe(30);
  });

  it('preserves a pending fade adjustment while acknowledging a volume update', () => {
    const { controller, send, state } = setup();
    openAmbianceActions(controller, state);
    for (let step = 0; step < 8; step += 1) controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');

    state.ambiances.set('ambiance-1', { ...state.ambiances.get('ambiance-1')!, volume: 30 });
    controller.handleAmbianceActionResult({ ok: true, action: 'update', message: '30 percent', ambianceId: 'ambiance-1' });
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');

    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'ambiance_update', ambianceId: 'ambiance-1', volume: 30 },
      { type: 'ambiance_update', ambianceId: 'ambiance-1', fadeDistance: 4 },
      { type: 'ambiance_update', ambianceId: 'ambiance-1', fadeDistance: 5 },
    ]);
    expect(state.ambiances.get('ambiance-1')).toMatchObject({ volume: 30, fadeDistance: 3 });
  });

  it('keeps type cycling cumulative across an interleaved upsert and result', () => {
    const { controller, send, state } = setup({ types: cyclingTypes });
    openAmbianceActions(controller, state);
    const initial = ambiance();

    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    expect(state.ambiances.get('ambiance-1')).toEqual(initial);

    state.ambiances.set('ambiance-1', { ...initial, soundId: 'wind' });
    controller.handleAmbianceActionResult({ ok: true, action: 'update', message: 'Wind', ambianceId: 'ambiance-1' });
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');

    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'ambiance_update', ambianceId: 'ambiance-1', soundId: 'wind' },
      { type: 'ambiance_update', ambianceId: 'ambiance-1', soundId: 'water' },
      { type: 'ambiance_update', ambianceId: 'ambiance-1', soundId: 'fire' },
    ]);
    expect(state.ambiances.get('ambiance-1')?.soundId).toBe('wind');
  });

  it('clears a pending adjustment when an update is rejected without an ambiance id', () => {
    const { controller, send, state } = setup();
    openAmbianceActions(controller, state);
    for (let step = 0; step < 8; step += 1) controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    controller.handleAmbianceActionResult({ ok: false, action: 'update', message: 'Rejected.' });
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');

    expect(send).toHaveBeenLastCalledWith({ type: 'ambiance_update', ambianceId: 'ambiance-1', volume: 30 });
  });

  it('clears pending adjustments when ambiance types are hydrated again', () => {
    const { controller, send, state } = setup();
    openAmbianceActions(controller, state);
    for (let step = 0; step < 8; step += 1) controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    controller.setAmbianceTypes(types);
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');

    expect(send).toHaveBeenLastCalledWith({ type: 'ambiance_update', ambianceId: 'ambiance-1', volume: 30 });
  });

  it('adds directly from the root menu without type or direction menus', () => {
    const { controller, send, state } = setup();

    controller.open();
    controller.handleRoot('ArrowDown', 'ArrowDown');
    controller.handleRoot('ArrowDown', 'ArrowDown');
    controller.handleRoot('Enter', 'Enter');

    expect(send).toHaveBeenLastCalledWith({ type: 'ambiance_add' });
    expect(state.mode).toBe('normal');
  });

  it('lists only the current floor by rectangle distance and opens Type first', () => {
    const near = ambiance({ id: 'near', name: 'Near', startX: 8, endX: 8 });
    const far = ambiance({ id: 'far', name: 'Far', startX: 15, endX: 15 });
    const { announceMenuEntry, controller, state } = setup({ regions: [far, near, ambiance({ id: 'other-floor', floorZ: 1 })] });

    openAmbianceActions(controller, state);

    expect(announceMenuEntry).toHaveBeenLastCalledWith('Near', 'Type: Rain');
  });

  it('uses sound options, sends relative edge edits, and previews numeric changes safely', () => {
    const { controller, openOptionSelector, send, state, updateStatus } = setup();
    openAmbianceActions(controller, state);

    controller.handleAmbianceActions('Space', ' ');
    expect(updateStatus).toHaveBeenLastCalledWith(expect.stringContaining('Type: list. Options: Rain, Wind.'));
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    expect(send).toHaveBeenLastCalledWith({ type: 'ambiance_update', ambianceId: 'ambiance-1', soundId: 'wind' });

    controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    expect(send).toHaveBeenLastCalledWith({
      type: 'ambiance_resize',
      ambianceId: 'ambiance-1',
      edge: 'west',
      delta: 1,
    });
    expect(state.ambiances.get('ambiance-1')?.startX).toBe(4);

    for (let step = 0; step < 6; step += 1) controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    expect(send).toHaveBeenLastCalledWith({ type: 'ambiance_update', ambianceId: 'ambiance-1', volume: 30 });
    expect(state.ambiances.get('ambiance-1')?.volume).toBe(25);

    controller.handleAmbianceActions('ArrowUp', 'ArrowUp');
    controller.handleAmbianceActions('Enter', 'Enter');
    expect(openOptionSelector).not.toHaveBeenCalled();
  });

  it('edits the name through the shared text session and opens a new region after add', () => {
    const { announceMenuEntry, controller, send, state } = setup();
    openAmbianceActions(controller, state);

    controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('Enter', 'Enter');
    expect(state.mode).toBe('worldBuilderAmbianceEdit');
    state.nicknameInput = 'Garden';
    state.cursorPos = state.nicknameInput.length;
    controller.handleAmbianceEdit('Enter', 'Enter');
    expect(send).toHaveBeenLastCalledWith({ type: 'ambiance_update', ambianceId: 'ambiance-1', name: 'Garden' });

    state.ambiances.set('ambiance-new', ambiance({ id: 'ambiance-new', name: 'New area' }));
    state.mode = 'normal';
    controller.handleAmbianceActionResult({
      ok: true,
      action: 'add',
      message: 'Added ambiance.',
      ambianceId: 'ambiance-new',
    });
    expect(state.mode).toBe('worldBuilderAmbianceActions');
    expect(announceMenuEntry).toHaveBeenLastCalledWith('New area', 'Type: Rain');
  });

  it('handles missing permission, empty lists, and deleted selections safely', () => {
    const denied = setup({ permission: false });
    denied.controller.open();
    expect(denied.state.mode).toBe('normal');
    expect(denied.send).not.toHaveBeenCalled();

    const empty = setup({ regions: [] });
    empty.controller.open();
    for (let step = 0; step < 3; step += 1) empty.controller.handleRoot('ArrowDown', 'ArrowDown');
    empty.controller.handleRoot('Enter', 'Enter');
    expect(empty.state.mode).toBe('worldBuilder');
    expect(empty.updateStatus).toHaveBeenLastCalledWith('No ambiances on this floor.');

    const stale = setup();
    openAmbianceActions(stale.controller, stale.state);
    stale.state.ambiances.clear();
    stale.controller.handleAmbianceActions('Enter', 'Enter');
    expect(stale.state.mode).toBe('worldBuilder');
    expect(stale.updateStatus).toHaveBeenLastCalledWith('Ambiance no longer exists.');
  });

  it('returns from the ambiance list to the World Builder root and from actions to the list', () => {
    const list = setup();
    list.controller.open();
    for (let step = 0; step < 3; step += 1) list.controller.handleRoot('ArrowDown', 'ArrowDown');
    list.controller.handleRoot('Enter', 'Enter');
    list.controller.handleAmbianceList('Escape', 'Escape');
    expect(list.state.mode).toBe('worldBuilder');
    expect(list.announceMenuEntry).toHaveBeenLastCalledWith('World Builder', 'Add wall');

    const actions = setup();
    openAmbianceActions(actions.controller, actions.state);
    actions.controller.handleAmbianceActions('Escape', 'Escape');
    expect(actions.state.mode).toBe('worldBuilderAmbianceList');
  });

  it('rechecks permission before submitting a text edit', () => {
    const { controller, send, setPermission, state, updateStatus } = setup();
    openAmbianceActions(controller, state);
    controller.handleAmbianceActions('ArrowDown', 'ArrowDown');
    controller.handleAmbianceActions('Enter', 'Enter');
    state.nicknameInput = 'Garden';
    setPermission(false);
    controller.handleAmbianceEdit('Enter', 'Enter');

    expect(send).not.toHaveBeenCalled();
    expect(state.mode).toBe('normal');
    expect(updateStatus).toHaveBeenLastCalledWith('World Builder permission required.');
  });

  it('does not preview or send type and numeric arrow edits after permission is revoked', () => {
    const { controller, send, setPermission, state } = setup();
    openAmbianceActions(controller, state);
    setPermission(false);
    controller.handleAmbianceActions('ArrowRight', 'ArrowRight');
    expect(send).not.toHaveBeenCalled();
    expect(state.ambiances.get('ambiance-1')?.soundId).toBe('rain');
    expect(state.mode).toBe('normal');
  });
});
