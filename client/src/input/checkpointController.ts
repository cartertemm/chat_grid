import type { CheckpointPreview, CheckpointSummary, IncomingMessage } from '../network/protocol';
import type { WorldBuilderDeps } from './worldBuilderController';
import { handleMenuRowKey } from './listController';
import { getEditSessionAction } from './editSession';

type Row = { id: string; label: string; tooltip: string };
const DATASET_LABELS: Record<string, string> = { structures: 'walls', piano_songs: 'recorded songs' };

/** Manual checkpoint capture, browsing, comparison and confirmed restore. */
export function createCheckpointController(deps: WorldBuilderDeps, back: () => void) {
  let index = 0;
  let page = 0;
  let listIndex = 0;
  let checkpoints: CheckpointSummary[] = [];
  let hasNext = false;
  let preview: CheckpointPreview | null = null;
  let waiting = false;

  const allowed = (action: 'capture' | 'view' | 'restore') => deps.hasPermission(`world.checkpoint.${action}`);
  function menuRows(): Row[] {
    const rows: Row[] = [];
    if (allowed('capture')) rows.push({ id: 'save', label: 'Save checkpoint', tooltip: 'Save the current items, saved songs, walls, doors, ambiances and named regions together.' });
    if (allowed('view')) rows.push({ id: 'browse', label: 'Browse checkpoints', tooltip: 'Browse saved checkpoints and preview their changes before restoring.' });
    return rows;
  }
  function open() {
    waiting = false;
    preview = null;
    index = 0;
    const rows = menuRows();
    if (!rows.length) { back(); return; }
    deps.state.mode = 'checkpointMenu';
    deps.announceMenuEntry('World checkpoints', rows[0].label);
  }
  function counts(checkpoint: CheckpointSummary): string {
    return Object.entries(checkpoint.counts).map(([type, count]) => `${count} ${DATASET_LABELS[type] ?? type}`).join(', ');
  }
  function label(checkpoint: CheckpointSummary): string {
    const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' }).format(checkpoint.createdAt);
    return `${checkpoint.label || 'Unnamed checkpoint'}, ${time}, ${counts(checkpoint)}`;
  }
  function listRows(): Row[] {
    const rows = checkpoints.map((checkpoint) => ({ id: checkpoint.id, label: label(checkpoint), tooltip: `Saved by ${checkpoint.createdBy}. Press Enter to preview changes.` }));
    if (page > 0) rows.push({ id: 'previous', label: 'Previous page', tooltip: 'Show the previous 25 checkpoints.' });
    if (hasNext) rows.push({ id: 'next', label: 'Next page', tooltip: 'Show the next 25 checkpoints.' });
    return rows;
  }
  function showList() {
    deps.state.mode = 'checkpointList';
    const rows = listRows();
    index = Math.min(index, Math.max(0, rows.length - 1));
    deps.announceMenuEntry('Checkpoints', rows[index]?.label ?? 'No saved checkpoints.');
  }
  function requestList(nextPage: number) {
    waiting = true;
    index = 0;
    deps.state.mode = 'checkpointList';
    deps.send({ type: 'checkpoint_action', action: 'list', page: nextPage });
  }
  function summary(value: CheckpointPreview): string {
    const changes = Object.entries(value.changes).map(([type, change]) => `${DATASET_LABELS[type] ?? type}: ${change.added} added, ${change.removed} removed, ${change.modified} modified`).join('. ');
    return `${label(value.checkpoint)}. ${changes || 'No changes.'}${value.warnings.length ? '. ' + value.warnings.join('. ') : ''}`;
  }
  function previewRows(): Row[] {
    const rows = [{ id: 'summary', label: 'Preview changes', tooltip: preview ? summary(preview) : 'No preview available.' }];
    if (allowed('restore')) rows.push({ id: 'restore', label: 'Restore this checkpoint', tooltip: 'Replace the authored world for everyone. A recovery checkpoint is saved before restore.' });
    return rows;
  }
  function showPreview() {
    deps.state.mode = 'checkpointPreview';
    index = 0;
    if (preview) deps.updateStatus(summary(preview));
  }
  function handleInput(code: string, key: string, ctrlKey = false) {
    if (deps.state.mode === 'checkpointLabel') {
      const action = getEditSessionAction(code);
      if (action === 'cancel') { deps.setReplaceTextOnNextType(false); open(); return; }
      if (action === 'submit') {
        if (!allowed('capture')) { open(); return; }
        waiting = true;
        deps.send({ type: 'checkpoint_action', action: 'capture', label: deps.state.nicknameInput.trim() });
        deps.setReplaceTextOnNextType(false);
        deps.state.mode = 'checkpointMenu';
      } else deps.applyTextInputEdit(code, key, 100, ctrlKey, true);
      return;
    }
    if (waiting) return;
    const mode = deps.state.mode;
    const rows = mode === 'checkpointMenu' ? menuRows() : mode === 'checkpointList' ? listRows() : previewRows();
    if (code === 'Escape' && !rows.length) { open(); return; }
    const control = handleMenuRowKey(code, key, rows, index, {
      label: (row) => row.label, tooltip: (row) => row.tooltip, updateStatus: deps.updateStatus, blip: deps.blip,
    });
    if (control.type === 'move') { index = control.index; return; }
    if (control.type === 'cancel') {
      if (mode === 'checkpointMenu') back();
      else if (mode === 'checkpointPreview') { index = listIndex; showList(); }
      else open();
      deps.cancel();
      return;
    }
    if (control.type !== 'select') return;
    const row = rows[index];
    if (mode === 'checkpointMenu') {
      if (row.id === 'save') {
        deps.state.nicknameInput = '';
        deps.state.cursorPos = 0;
        deps.setReplaceTextOnNextType(true);
        deps.state.mode = 'checkpointLabel';
        deps.updateStatus('Checkpoint label. Enter saves.');
      } else requestList(0);
    } else if (mode === 'checkpointList') {
      if (row.id === 'previous' || row.id === 'next') { index = 0; requestList(page + (row.id === 'next' ? 1 : -1)); }
      else {
        listIndex = index;
        waiting = true;
        deps.send({ type: 'checkpoint_action', action: 'preview', checkpointId: row.id });
      }
    } else if (row.id === 'summary') {
      if (preview) deps.updateStatus(summary(preview));
    } else if (preview && allowed('restore')) {
      const selected = preview;
      deps.openConfirmation({
        prompt: `Restore ${selected.checkpoint.label || 'this checkpoint'} for everyone? ${summary(selected)}`,
        onCancel: showPreview,
        onConfirm: () => {
          if (!allowed('restore')) { open(); return; }
          waiting = true;
          deps.state.mode = 'checkpointPreview';
          deps.send({ type: 'checkpoint_action', action: 'restore', checkpointId: selected.checkpoint.id, worldRevision: selected.worldRevision });
        },
      });
    }
  }
  function result(message: Extract<IncomingMessage, { type: 'checkpoint_result' }>) {
    waiting = false;
    if (!message.ok) {
      if (message.preview) { preview = message.preview; showPreview(); }
      deps.updateStatus(message.message);
      deps.cancel();
      return;
    }
    if (message.action === 'list') {
      page = message.page ?? 0;
      checkpoints = message.checkpoints ?? [];
      hasNext = message.hasNext ?? false;
      showList();
    } else if (message.action === 'preview' && message.preview) {
      preview = message.preview;
      showPreview();
    } else {
      deps.state.mode = message.action === 'restore' ? 'normal' : 'checkpointMenu';
      index = 0;
      deps.updateStatus(message.message);
      deps.confirm();
    }
  }
  return { open, handleInput, result };
}
