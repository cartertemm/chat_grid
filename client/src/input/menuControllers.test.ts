import { describe, expect, it, vi } from 'vitest';
import type { GameMode } from '../state/gameState';
import { createConfirmationController } from './confirmationController';
import { createOptionSelector } from './optionSelector';

function deps() {
  return {
    state: { mode: 'normal' as GameMode },
    announceMenuEntry: vi.fn(),
    updateStatus: vi.fn(),
    blip: vi.fn(),
    cancel: vi.fn(),
  };
}

describe('shared menu controllers', () => {
  it('reads option help on Space and falls back to the property help', () => {
    const shared = deps();
    const onSelect = vi.fn();
    const propertyHelp = vi.fn(() => 'Choose which approaches require the keypad.');
    const selector = createOptionSelector(shared);
    selector.open({
      title: 'Keypad sides',
      options: [{ id: 'both', label: 'Both', tooltip: 'Protect both approaches.' }, { id: 'north', label: 'North' }],
      propertyHelp, onSelect, onCancel: vi.fn(),
    });
    selector.handleInput('Space', ' ');
    expect(shared.updateStatus).toHaveBeenLastCalledWith('Protect both approaches.');
    selector.handleInput('ArrowDown', 'ArrowDown');
    expect(propertyHelp).not.toHaveBeenCalled();
    selector.handleInput('Space', ' ');
    expect(shared.updateStatus).toHaveBeenLastCalledWith('Choose which approaches require the keypad.');
    expect(onSelect).not.toHaveBeenCalled();
    expect(shared.state.mode).toBe('optionSelect');
  });

  it('selects a current option through the reusable option flow', () => {
    const shared = deps();
    const onSelect = vi.fn();
    const selector = createOptionSelector(shared);
    selector.open({
      title: 'Type',
      options: [{ id: 'brick', label: 'Brick' }, { id: 'glass', label: 'Glass' }],
      selectedId: 'glass',
      onSelect,
      onCancel: vi.fn(),
    });

    expect(shared.state.mode).toBe('optionSelect');
    expect(shared.announceMenuEntry).toHaveBeenCalledWith('Type', 'Glass');
    selector.handleInput('Enter', 'Enter');
    expect(onSelect).toHaveBeenCalledWith('glass');
  });

  it('keeps the highlighted option when an owned list changes order', () => {
    const shared = deps();
    const onSelect = vi.fn();
    const selector = createOptionSelector(shared);
    const request = {
      title: 'Floors', options: [{ id: '20', label: 'Twenty' }, { id: '40', label: 'Forty' }],
      onSelect, onCancel: vi.fn(),
    };
    selector.open(request);
    selector.handleInput('ArrowDown', 'ArrowDown');
    const next = { ...request, options: [{ id: '40', label: 'Forty, up' }, { id: '60', label: 'Sixty' }] };
    expect(selector.refresh(request, next)).toBe(true);
    expect(shared.announceMenuEntry).toHaveBeenLastCalledWith('Floors', 'Forty, up');
    selector.handleInput('Enter', 'Enter');
    expect(onSelect).toHaveBeenCalledWith('40');
    expect(selector.refresh(request, next)).toBe(false);
  });

  it('keeps a valid nearby row when the highlighted option disappears', () => {
    const shared = deps();
    const onSelect = vi.fn();
    const selector = createOptionSelector(shared);
    const request = {
      title: 'Floors', selectedId: '40', options: [{ id: '20', label: 'Twenty' }, { id: '40', label: 'Forty' }],
      onSelect, onCancel: vi.fn(),
    };
    selector.open(request);
    selector.refresh(request, { ...request, options: [{ id: '20', label: 'Twenty' }] });
    selector.handleInput('Enter', 'Enter');
    expect(onSelect).toHaveBeenCalledWith('20');
  });

  it('uses the shared default-No confirmation without tooltip handling', () => {
    const shared = deps();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const confirmation = createConfirmationController(shared);
    confirmation.open({ prompt: 'Delete wall?', onConfirm, onCancel });

    confirmation.handleInput('Space', ' ');
    expect(shared.updateStatus).not.toHaveBeenCalled();
    confirmation.handleInput('ArrowDown', 'ArrowDown');
    confirmation.handleInput('Enter', 'Enter');
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
