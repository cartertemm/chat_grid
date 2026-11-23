import type { CommandDescriptor } from '../../../input/commandTypes';
import type { OptionSelectorRequest } from '../../../input/optionSelector';
import type { IncomingMessage, OutgoingMessage } from '../../../network/protocol';
import type { GameState } from '../../../state/gameState';
import { platformAt } from '../../../state/platformGeometry';

type ElevatorControlsDeps = {
  state: GameState;
  choose: (request: OptionSelectorRequest) => void;
  closeChoice: (request: OptionSelectorRequest) => boolean;
  refreshChoice: (active: OptionSelectorRequest, next: OptionSelectorRequest) => boolean;
  send: (packet: OutgoingMessage) => void;
  updateStatus: (message: string) => void;
};

/** Use the common option selector for destinations in the occupied elevator. */
export function createElevatorControls(deps: ElevatorControlsDeps) {
  let activeChoice: OptionSelectorRequest | null = null;
  let selectedElevatorId: string | null = null;
  let activeContext = '';

  function reset(): void {
    if (activeChoice) deps.closeChoice(activeChoice);
    activeChoice = null;
    selectedElevatorId = null;
    activeContext = '';
  }

  function choiceContext(): string {
    const item = deps.state.items.get(deps.state.elevatorItemId ?? '');
    if (!item) return '';
    const moving = item.params.state === 'moving';
    return `${moving ? 'moving' : 'parked'}:${item.params.currentZ}:${moving ? item.params.targetZ : ''}`;
  }

  function buildChoice(): OptionSelectorRequest | null {
    const itemId = deps.state.elevatorItemId;
    const item = itemId ? deps.state.items.get(itemId) : undefined;
    if (!item || item.type !== 'elevator') return null;
    const currentZ = Number(item.params.currentZ ?? item.z);
    const moving = item.params.state === 'moving';
    const targetZ = Number(item.params.targetZ);
    const referenceZ = moving ? targetZ : currentZ;
    const floors = Array.isArray(item.params.floorZs) ? item.params.floorZs.filter((value): value is number => Number.isInteger(value)) : [];
    const options = [...floors].sort((a, b) => a - b).filter((z) => z !== (moving ? targetZ : currentZ)).map((z) => {
      const platform = platformAt(deps.state.platforms, item.x, item.y, z);
      const landing = platform?.name ?? 'open air';
      const direction = moving
        ? z > referenceZ ? 'above destination' : 'below destination'
        : z > referenceZ ? 'up' : 'down';
      return { id: String(z), label: `${landing}, ${z}, ${direction}`, tooltip: `Request this elevator stop at height ${z}.` };
    });
    if (!options.length) {
      deps.updateStatus('No other elevator stops.');
      return null;
    }
    return {
      title: moving
        ? `Choose floor, traveling to ${platformAt(deps.state.platforms, item.x, item.y, targetZ)?.name ?? 'open air'}, ${targetZ}`
        : `Choose floor, current stop ${platformAt(deps.state.platforms, item.x, item.y, currentZ)?.name ?? 'open air'}, ${currentZ}`,
      options,
      onCancel: () => { reset(); deps.state.mode = 'normal'; },
      onSelect: (value) => {
        reset();
        deps.state.mode = 'normal';
        if (deps.state.elevatorItemId !== item.id) {
          deps.updateStatus('You are no longer in this elevator.');
          return;
        }
        deps.send({ type: 'elevator_select_floor', itemId: item.id, z: Number(value) });
      },
    };
  }

  function open(): void {
    const choice = buildChoice();
    if (!choice) return;
    reset();
    selectedElevatorId = deps.state.elevatorItemId;
    activeChoice = choice;
    activeContext = choiceContext();
    deps.choose(choice);
  }

  function reconcile(): void {
    if (selectedElevatorId && (deps.state.elevatorItemId !== selectedElevatorId || !deps.state.items.has(selectedElevatorId))) {
      reset();
      return;
    }
    if (!activeChoice) return;
    const context = choiceContext();
    if (context === activeContext) return;
    const choice = buildChoice();
    if (!choice || !deps.refreshChoice(activeChoice, choice)) {
      reset();
      return;
    }
    activeChoice = choice;
    activeContext = context;
  }

  function handleStatus(message: Extract<IncomingMessage, { type: 'item_elevator_status' }>): void {
    reconcile();
    const item = deps.state.items.get(message.itemId);
    if (message.event === 'entered' && Array.isArray(item?.params.floorZs) && item.params.floorZs.length > 2) open();
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
