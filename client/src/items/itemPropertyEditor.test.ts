import { describe, expect, it, vi } from 'vitest';
import { createItemPropertyEditor } from './itemPropertyEditor';
import type { WorldItem } from '../state/gameState';

describe('item property value feedback', () => {
  it('announces only on or off when Enter toggles a boolean and suppresses its server echo', () => {
    const item: WorldItem = {
      id: 'radio', type: 'radio_station', title: 'Studio radio',
      x: 0, y: 0, z: 0, createdBy: 'self', updatedBy: 'self',
      createdAt: 1, updatedAt: 1, version: 1,
      capabilities: [], carrierId: null, occupiedOffsets: [{ x: 0, y: 0 }],
      params: { enabled: true },
    };
    const state = {
      mode: 'itemProperties', selectedItemId: item.id, editingPropertyKey: null,
      itemPropertyKeys: ['enabled'], itemPropertyIndex: 0, nicknameInput: '', cursorPos: 0,
      items: new Map([[item.id, item]]),
    };
    const signalingSend = vi.fn();
    const updateStatus = vi.fn();
    const suppressItemPropertyEchoMs = vi.fn();
    const describeItemPropertyHelp = vi.fn(() => 'Enable or disable playback. Type: boolean. Editable.');
    const sfxUiBlip = vi.fn();
    const editor = createItemPropertyEditor({
      state,
      signalingSend,
      updateStatus,
      suppressItemPropertyEchoMs,
      getItemPropertyValue: () => 'on',
      itemPropertyLabel: () => 'Enabled',
      isItemPropertyEditable: () => true,
      getItemPropertyOptionValues: () => undefined,
      openOptionSelector: vi.fn(),
      describeItemPropertyHelp,
      getItemPropertyMetadata: () => ({ valueType: 'boolean' }),
      validateNumericItemPropertyInput: () => ({ ok: false, message: 'Not numeric.' }),
      applyTextInputEdit: vi.fn(),
      setReplaceTextOnNextType: vi.fn(),
      sfxUiBlip,
      sfxUiCancel: vi.fn(),
    });

    editor.handleItemPropertiesModeInput('Space', ' ');
    expect(updateStatus).toHaveBeenLastCalledWith('Enable or disable playback. Type: boolean. Editable.');
    expect(describeItemPropertyHelp).toHaveBeenCalledWith(item, 'enabled');
    expect(sfxUiBlip).toHaveBeenCalledOnce();
    expect(signalingSend).not.toHaveBeenCalled();
    updateStatus.mockClear();
    editor.handleItemPropertiesModeInput('Enter', 'Enter');

    expect(updateStatus.mock.calls).toEqual([['off']]);
    expect(signalingSend).toHaveBeenCalledWith({ type: 'item_update', itemId: item.id, params: { enabled: false } });
    expect(suppressItemPropertyEchoMs).toHaveBeenCalledWith(600);
    expect(state.mode).toBe('itemProperties');
  });
});
