import { describe, expect, it, vi } from 'vitest';
import { createOptionSelector } from '../../../input/optionSelector';
import { createInitialState, type WorldItem } from '../../../state/gameState';
import { createElevatorControls } from './controls';

function setup(floors = [0, 20, 40]) {
  const state = createInitialState();
  const item: WorldItem = {
    id: 'car', type: 'elevator', title: 'Elevator', x: 5, y: 6, z: 0,
    createdBy: 'owner', updatedBy: 'owner', createdAt: 0, updatedAt: 0, version: 1,
    params: { floorZs: floors, currentZ: 20 }, capabilities: ['usable'], occupiedOffsets: [{ x: 0, y: 0 }],
  };
  state.items.set(item.id, item);
  state.elevatorItemId = item.id;
  state.platforms.set('studio', { id: 'studio', name: 'Studio', z: 20, startX: 0, startY: 0, endX: 10, endY: 10 });
  state.platforms.set('ground', { id: 'ground', name: 'Ground', z: 0, startX: 0, startY: 0, endX: 10, endY: 10 });
  const announceMenuEntry = vi.fn();
  const updateStatus = vi.fn();
  const send = vi.fn();
  const selector = createOptionSelector({ state, announceMenuEntry, updateStatus, blip: vi.fn(), cancel: vi.fn() });
  const controls = createElevatorControls({ state, choose: selector.open, closeChoice: selector.close, refreshChoice: selector.refresh, send, updateStatus });
  return { state, item, controls, selector, announceMenuEntry, updateStatus, send };
}

describe('elevator floor controls', () => {
  it('opens the shared selector after boarding a multi-stop car and requests the chosen elevation', () => {
    const { controls, selector, announceMenuEntry, updateStatus, send, state } = setup();
    controls.handleStatus({ type: 'item_elevator_status', itemId: 'car', event: 'entered', z: 20 });
    expect(announceMenuEntry).toHaveBeenCalledWith('Choose floor, current stop Studio, 20', 'Ground, 0, down');
    selector.handleInput('ArrowDown', 'ArrowDown');
    expect(updateStatus).toHaveBeenLastCalledWith('open air, 40, up');
    selector.handleInput('Enter', 'Enter');
    expect(send).toHaveBeenCalledWith({ type: 'elevator_select_floor', itemId: 'car', z: 40 });
    expect(state.mode).toBe('normal');
    expect(state.elevatorItemId).toBe('car');
  });

  it('lets Escape dismiss the list and the cabin command reopen it', () => {
    const { controls, selector, send, state } = setup();
    controls.open();
    selector.handleInput('Escape', 'Escape');
    expect(state.elevatorItemId).toBe('car');
    expect(send).not.toHaveBeenCalled();
    controls.commands()[0].run();
    expect(state.mode).toBe('optionSelect');
  });

  it('does not open a two-stop selection automatically', () => {
    const { controls, announceMenuEntry } = setup([0, 40]);
    controls.handleStatus({ type: 'item_elevator_status', itemId: 'car', event: 'entered', z: 0 });
    expect(announceMenuEntry).not.toHaveBeenCalled();
  });

  it('refreshes an open floor list at arrival using the new current stop', () => {
    const { controls, item, announceMenuEntry } = setup();
    controls.open();
    item.params.currentZ = 40;
    controls.handleStatus({ type: 'item_elevator_status', itemId: 'car', event: 'arrived', z: 40 });
    expect(announceMenuEntry).toHaveBeenLastCalledWith('Choose floor, current stop open air, 40', 'Ground, 0, down');
  });

  it('describes travel height and lets a rider request the departure stop again', () => {
    const { controls, item, state, selector, announceMenuEntry, send } = setup();
    item.params.state = 'moving';
    item.params.targetZ = 40;
    state.player.z = 25;
    controls.open();
    expect(announceMenuEntry).toHaveBeenLastCalledWith('Choose floor, traveling to open air, 40', 'Ground, 0, below destination');
    selector.handleInput('ArrowDown', 'ArrowDown');
    selector.handleInput('Enter', 'Enter');
    expect(send).toHaveBeenCalledWith({ type: 'elevator_select_floor', itemId: 'car', z: 20 });
  });

  it('refreshes on departure and arrival without losing the highlighted destination', () => {
    const { controls, item, state, selector, announceMenuEntry, send } = setup([0, 20, 40, 60]);
    controls.open();
    selector.handleInput('ArrowDown', 'ArrowDown');
    selector.handleInput('ArrowDown', 'ArrowDown');
    item.params.state = 'moving';
    item.params.targetZ = 40;
    state.player.z = 20;

    controls.reconcile();

    expect(announceMenuEntry).toHaveBeenLastCalledWith('Choose floor, traveling to open air, 40', 'open air, 60, above destination');
    const count = announceMenuEntry.mock.calls.length;
    state.player.z = 25;
    controls.handleStatus({ type: 'item_elevator_status', itemId: 'car', event: 'moving', z: 25 });
    controls.reconcile();
    expect(announceMenuEntry).toHaveBeenCalledTimes(count);

    item.params.state = 'arriving';
    item.params.currentZ = 40;
    item.params.targetZ = null;
    controls.reconcile();
    expect(announceMenuEntry).toHaveBeenLastCalledWith('Choose floor, current stop open air, 40', 'open air, 60, up');
    controls.handleStatus({ type: 'item_elevator_status', itemId: 'car', event: 'arrived', z: 40 });
    expect(announceMenuEntry).toHaveBeenCalledTimes(count + 1);
    selector.handleInput('Enter', 'Enter');
    expect(send).toHaveBeenCalledWith({ type: 'elevator_select_floor', itemId: 'car', z: 60 });
  });

  it('does not replace a newer selector when the car departs', () => {
    const { controls, item, selector, announceMenuEntry } = setup();
    controls.open();
    const onSelect = vi.fn();
    selector.open({ title: 'Other menu', options: [{ id: 'other', label: 'Other' }], onSelect, onCancel: vi.fn() });
    item.params.state = 'moving';
    item.params.targetZ = 40;
    controls.reconcile();
    expect(announceMenuEntry).toHaveBeenLastCalledWith('Other menu', 'Other');
    selector.handleInput('Enter', 'Enter');
    expect(onSelect).toHaveBeenCalledWith('other');
  });

  it('closes its list after exit and does not close another feature’s selector', () => {
    const { controls, selector, state, send } = setup();
    controls.open();
    state.elevatorItemId = null;
    controls.reconcile();
    expect(state.mode).toBe('normal');
    selector.handleInput('Enter', 'Enter');
    expect(send).not.toHaveBeenCalled();
    state.elevatorItemId = 'car';
    controls.open();
    selector.open({ title: 'Another selector', options: [{ id: 'other', label: 'Other' }], onSelect: vi.fn(), onCancel: vi.fn() });
    state.elevatorItemId = null;
    controls.reconcile();
    expect(state.mode).toBe('optionSelect');
  });
});
