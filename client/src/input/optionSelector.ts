import type { GameMode } from '../state/gameState';
import { handleMenuRowKey } from './listController';

export type OptionSelectorEntry = { id: string; label: string; tooltip?: string };

export type OptionSelectorRequest = {
  title: string;
  options: OptionSelectorEntry[];
  selectedId?: string;
  propertyHelp?: () => string;
  onSelect: (id: string) => void;
  onCancel: () => void;
};

type OptionSelectorDeps = {
  state: { mode: GameMode };
  announceMenuEntry: (title: string, option: string) => void;
  updateStatus: (message: string) => void;
  blip: () => void;
  cancel: () => void;
};

/** Create the shared option-list interaction used by item and structure properties. */
export function createOptionSelector(deps: OptionSelectorDeps) {
  let request: OptionSelectorRequest | null = null;
  let index = 0;

  function open(next: OptionSelectorRequest): void {
    if (next.options.length === 0) return;
    request = next;
    const selectedIndex = next.options.findIndex((entry) => entry.id === next.selectedId);
    index = selectedIndex >= 0 ? selectedIndex : 0;
    deps.state.mode = 'optionSelect';
    deps.announceMenuEntry(next.title, next.options[index].label);
  }

  function handleInput(code: string, key: string): void {
    if (!request || request.options.length === 0) {
      deps.state.mode = 'normal';
      return;
    }
    if (code === 'PageUp' || code === 'PageDown') {
      const jump = Math.min(10, Math.max(1, request.options.length - 1));
      const delta = code === 'PageUp' ? -jump : jump;
      index = (index + delta + request.options.length * 1000) % request.options.length;
      deps.updateStatus(request.options[index].label);
      deps.blip();
      return;
    }
    const control = handleMenuRowKey(code, key, request.options, index, {
      label: (entry) => entry.label,
      tooltip: (entry) => entry.tooltip ?? request?.propertyHelp?.(),
      updateStatus: deps.updateStatus,
      blip: deps.blip,
    });
    if (control.type === 'move') {
      index = control.index;
      return;
    }
    if (control.type === 'select') {
      const active = request;
      request = null;
      active.onSelect(active.options[index].id);
      return;
    }
    if (control.type === 'cancel') {
      const active = request;
      request = null;
      active.onCancel();
      deps.cancel();
    }
  }

  /** Close a selector owned by a feature without disturbing a newer menu. */
  function close(active: OptionSelectorRequest): boolean {
    if (request !== active) return false;
    request = null;
    if (deps.state.mode === 'optionSelect') deps.state.mode = 'normal';
    return true;
  }

  /** Refresh an owned list while retaining its highlighted option when available. */
  function refresh(active: OptionSelectorRequest, next: OptionSelectorRequest): boolean {
    if (request !== active || deps.state.mode !== 'optionSelect' || next.options.length === 0) return false;
    const selectedId = request.options[index].id;
    const nextIndex = next.options.findIndex((entry) => entry.id === selectedId);
    index = nextIndex >= 0 ? nextIndex : Math.min(index, next.options.length - 1);
    request = next;
    deps.announceMenuEntry(next.title, next.options[index].label);
    return true;
  }

  return { open, handleInput, close, refresh };
}
