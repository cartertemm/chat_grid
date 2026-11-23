import type { CommandDescriptor } from '../../../input/commandTypes';
import type { OptionSelectorRequest } from '../../../input/optionSelector';
import type { IncomingMessage, OutgoingMessage } from '../../../network/protocol';
import type { GameState } from '../../../state/gameState';
import { platformAt } from '../../../state/platformGeometry';

type ElevatorControlsDeps = {
  state: GameState;
  choose: (request: OptionSelectorRequest) => void;
  closeChoice: (request: OptionSelectorRequest) => boolean;
  send: (packet: OutgoingMessage) => void;
  updateStatus: (message: string) => void;
};

/** Use the common option selector for destinations in the occupied elevator. */
export function createElevatorControls(deps: ElevatorControlsDeps) {
  let activeChoice: OptionSelectorRequest | null = null;
  let selectedElevatorId: string | null = null;

  function reset(): void {
    if (activeChoice) deps.closeChoice(activeChoice);
    activeChoice = null;
    selectedElevatorId = null;
  }

  function open(): void {
    const itemId = deps.state.elevatorItemId;
    const item = itemId ? deps.state.items.get(itemId) : undefined;
    if (!item || item.type !== 'elevator') return;
    const currentZ = Number(item.params.currentZ ?? item.z);
    const moving = item.params.state === 'moving';
    const targetZ = Number(item.params.targetZ);
    const referenceZ = moving ? deps.state.player.z : currentZ;
    const floors = Array.isArray(item.params.floorZs) ? item.params.floorZs.filter((value): value is number => Number.isInteger(value)) : [];
    const options = [...floors].sort((a, b) => a - b).filter((z) => z !== (moving ? targetZ : currentZ)).map((z) => {
      const platform = platformAt(deps.state.platforms, item.x, item.y, z);
      const landing = platform?.name ?? 'open air';
      const direction = z === referenceZ ? 'here' : z > referenceZ ? 'up' : 'down';
      return { id: String(z), label: `${landing}, ${z}, ${direction}`, tooltip: `Request this elevator stop at height ${z}.` };
    });
    if (!options.length) {
      deps.updateStatus('No other elevator stops.');
      return;
    }
    reset();
    selectedElevatorId = item.id;
    activeChoice = {
      title: moving
        ? `Choose floor, height ${referenceZ}, traveling to ${platformAt(deps.state.platforms, item.x, item.y, targetZ)?.name ?? 'open air'}, ${targetZ}`
        : `Choose floor, current stop ${platformAt(deps.state.platforms, item.x, item.y, currentZ)?.name ?? 'open air'}, ${currentZ}`,
      options,
      onCancel: () => { activeChoice = null; selectedElevatorId = null; deps.state.mode = 'normal'; },
      onSelect: (value) => {
        activeChoice = null;
        selectedElevatorId = null;
        deps.state.mode = 'normal';
        if (deps.state.elevatorItemId !== item.id) {
          deps.updateStatus('You are no longer in this elevator.');
          return;
        }
        deps.send({ type: 'elevator_select_floor', itemId: item.id, z: Number(value) });
      },
    };
    deps.choose(activeChoice);
  }

  function reconcile(): void {
    if (selectedElevatorId && (deps.state.elevatorItemId !== selectedElevatorId || !deps.state.items.has(selectedElevatorId))) reset();
  }

  function handleStatus(message: Extract<IncomingMessage, { type: 'item_elevator_status' }>): void {
    reconcile();
    const item = deps.state.items.get(message.itemId);
    if (message.event === 'entered' && Array.isArray(item?.params.floorZs) && item.params.floorZs.length > 2) open();
    if (message.event === 'arrived' && activeChoice && deps.closeChoice(activeChoice)) open();
  }

  function commands(): Array<CommandDescriptor & { run: () => void }> {
    if (!deps.state.elevatorItemId) return [];
    return [{
      id: 'chooseElevatorFloor', label: 'Choose floor', shortcut: '', section: 'Elevator',
      tooltip: 'Choose a destination for the elevator you are riding.', run: open,
    }];
  }

  return { open, handleStatus, reconcile, reset, commands };
}
