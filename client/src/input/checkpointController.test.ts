import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state/gameState';
import { createCheckpointController } from './checkpointController';
import { createConfirmationController } from './confirmationController';
import type { CheckpointPreview, CheckpointSummary, IncomingMessage } from '../network/protocol';

const checkpoint: CheckpointSummary = { id: 'saved', label: 'Before remodel', createdAt: 1_790_000_000_000, createdBy: 'Builder', counts: { items: 3, structures: 2, regions: 1 } };
const preview: CheckpointPreview = { checkpoint, worldRevision: 'current-revision', changes: { items: { added: 1, removed: 2, modified: 1 } }, warnings: ['External media may have changed.'] };
function setup(permissions = ['capture', 'view', 'restore']) {
  const state = createInitialState();
  const send = vi.fn();
  const updateStatus = vi.fn();
  const announceMenuEntry = vi.fn();
  const confirmation = createConfirmationController({ state, announceMenuEntry, updateStatus, blip: vi.fn(), cancel: vi.fn() });
  const back = vi.fn();
  const controller = createCheckpointController({ state, send, updateStatus, announceMenuEntry, hasPermission: (key) => permissions.some((permission) => key === `world.checkpoint.${permission}`), blip: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), applyTextInputEdit: vi.fn(), setReplaceTextOnNextType: vi.fn(), openOptionSelector: vi.fn(), openConfirmation: confirmation.open }, back);
  controller.open();
  const key = (code: string, value = code) => controller.handleInput(code, value);
  const result = (message: Extract<IncomingMessage, { type: 'checkpoint_result' }>) => controller.result({ ...message, requestId: send.mock.calls.at(-1)?.[0].requestId });
  return { controller, state, send, updateStatus, announceMenuEntry, confirmation, key, back, result };
}
function browse(test: ReturnType<typeof setup>) {
  test.key('ArrowDown');
  test.key('Enter');
  test.result({ type: 'checkpoint_result', ok: true, action: 'list', message: '', checkpoints: [checkpoint], page: 0, hasNext: false });
  test.key('Enter');
  test.result({ type: 'checkpoint_result', ok: true, action: 'preview', message: '', preview });
}

describe('manual checkpoint controls', () => {
  it('lets Escape abandon a pending list and ignores its result after a new request', () => {
    const test = setup();
    test.key('ArrowDown');
    test.key('Enter');
    const staleId = test.send.mock.calls.at(-1)?.[0].requestId;
    test.key('Escape');
    expect(test.state.mode).toBe('checkpointMenu');
    test.key('ArrowDown');
    test.key('Enter');
    test.controller.result({ type: 'checkpoint_result', requestId: staleId, ok: true, action: 'list', message: '', checkpoints: [checkpoint] });
    expect(test.announceMenuEntry).not.toHaveBeenLastCalledWith('Checkpoints', expect.anything());
    test.result({ type: 'checkpoint_result', ok: true, action: 'list', message: '', checkpoints: [], page: 0 });
    expect(test.announceMenuEntry).toHaveBeenLastCalledWith('Checkpoints', 'No saved checkpoints.');
  });
  it('ignores pending results after a world reset while preserving restore completion feedback', () => {
    const test = setup();
    browse(test);
    test.key('ArrowDown');
    test.key('Enter');
    test.confirmation.handleInput('ArrowDown', 'ArrowDown');
    test.confirmation.handleInput('Enter', 'Enter');
    test.controller.reset(true);
    test.state.mode = 'normal';
    test.result({ type: 'checkpoint_result', action: 'restore', ok: true, message: 'Restored, durability unconfirmed.' });
    expect(test.state.mode).toBe('normal');
    expect(test.updateStatus).toHaveBeenLastCalledWith('Restored, durability unconfirmed.');
    test.controller.open();
    test.key('ArrowDown');
    test.key('Enter');
    test.controller.reset();
    test.state.mode = 'normal';
    test.result({ type: 'checkpoint_result', action: 'list', ok: true, message: '', checkpoints: [checkpoint] });
    expect(test.state.mode).toBe('normal');
  });
  it('captures a label through text entry and waits for durable success', () => {
    const test = setup();
    test.key('Enter');
    expect(test.state.mode).toBe('checkpointLabel');
    test.state.nicknameInput = 'Before remodel';
    test.key('Enter');
    expect(test.send).toHaveBeenCalledWith({ type: 'checkpoint_action', requestId: expect.any(String), action: 'capture', label: 'Before remodel' });
    expect(test.updateStatus).not.toHaveBeenCalledWith('Checkpoint saved.');
    test.result({ type: 'checkpoint_result', action: 'capture', ok: true, message: 'Checkpoint saved.' });
    expect(test.updateStatus).toHaveBeenLastCalledWith('Checkpoint saved.');
  });
  it('previews changes and uses the shared default-No restore confirmation', () => {
    const test = setup();
    browse(test);
    expect(test.updateStatus).toHaveBeenLastCalledWith(expect.stringContaining('items: 1 added, 2 removed, 1 modified'));
    test.key('ArrowDown');
    test.key('Space', ' ');
    expect(test.updateStatus).toHaveBeenLastCalledWith(expect.stringContaining('recovery checkpoint'));
    test.key('Enter');
    test.confirmation.handleInput('Enter', 'Enter');
    expect(test.send.mock.calls.some(([packet]) => packet.action === 'restore')).toBe(false);
    test.key('ArrowDown');
    test.key('Enter');
    test.confirmation.handleInput('ArrowDown', 'ArrowDown');
    test.confirmation.handleInput('Enter', 'Enter');
    expect(test.send).toHaveBeenLastCalledWith({ type: 'checkpoint_action', requestId: expect.any(String), action: 'restore', checkpointId: 'saved', worldRevision: 'current-revision' });
    test.result({ type: 'checkpoint_result', ok: false, action: 'restore', message: 'World changed. Review the new preview.', preview: { ...preview, worldRevision: 'new-revision' } });
    expect(test.state.mode).toBe('checkpointPreview');
    expect(test.updateStatus).toHaveBeenLastCalledWith('World changed. Review the new preview.');
  });
  it('pages explicitly and hides capture and restore from view-only users', () => {
    const test = setup(['view']);
    expect(test.announceMenuEntry).toHaveBeenLastCalledWith('World checkpoints', 'Browse checkpoints');
    test.key('Enter');
    test.result({ type: 'checkpoint_result', ok: true, action: 'list', message: '', checkpoints: [checkpoint], page: 0, hasNext: true });
    test.key('ArrowDown');
    test.key('Enter');
    expect(test.send).toHaveBeenLastCalledWith({ type: 'checkpoint_action', requestId: expect.any(String), action: 'list', page: 1 });
    test.result({ type: 'checkpoint_result', ok: true, action: 'list', message: '', checkpoints: [checkpoint], page: 1, hasNext: false });
    test.key('Enter');
    test.result({ type: 'checkpoint_result', ok: true, action: 'preview', message: '', preview });
    test.key('ArrowDown');
    test.key('Enter');
    expect(test.send.mock.calls.some(([packet]) => packet.action === 'restore')).toBe(false);
    test.key('Escape');
    expect(test.state.mode).toBe('checkpointList');
  });
});
