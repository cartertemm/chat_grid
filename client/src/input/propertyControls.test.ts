import { describe, expect, it, vi } from 'vitest';
import {
  adjustPropertyValue,
  applyNumericPropertyKey,
  announcePropertyValue,
  describePropertyHelp,
  getPropertyOptions,
  validateNumericPropertyInput,
} from './propertyControls';

describe('shared property controls', () => {
  it('recovers invalid numeric text, updates the cursor, and reports the clamped value once', () => {
    const state = { nicknameInput: 'invalid', cursorPos: 2 };
    const feedback = {
      setReplaceTextOnNextType: vi.fn(),
      updateStatus: vi.fn(),
      cue: vi.fn(),
    };
    const metadata = { valueType: 'number', range: { min: 0, max: 1, step: 0.05 } };
    expect(applyNumericPropertyKey('PageUp', state, metadata, feedback, 0.95)).toMatchObject({
      value: 1, hitBoundary: true,
    });
    expect(state).toEqual({ nicknameInput: '1', cursorPos: 1 });
    expect(feedback.setReplaceTextOnNextType).toHaveBeenCalledWith(false);
    expect(feedback.updateStatus.mock.calls).toEqual([['1']]);
    expect(feedback.cue).toHaveBeenCalledWith(false);
    expect(applyNumericPropertyKey('ArrowLeft', state, metadata, feedback)).toBeNull();
    expect(feedback.updateStatus).toHaveBeenCalledTimes(1);
  });

  it('announces the display value of a selected setting', () => {
    const spoken: string[] = [];
    const announce = (value: string) => spoken.push(value);
    announcePropertyValue(announce, 'positive', { options: [{ id: 'positive', label: 'North' }] });
    announcePropertyValue(announce, 0.1 + 0.2, { range: { min: 0, max: 1, step: 0.05 } });
    announcePropertyValue(announce, false);
    announcePropertyValue(announce, 'Studio, upstairs');
    expect(spoken).toEqual(['North', '0.3', 'off', 'Studio, upstairs']);
  });

  it('normalizes and cycles labeled options', () => {
    const metadata = {
      valueType: 'list',
      options: [{ id: 'brick', label: 'Brick' }, { id: 'curtain', label: 'Curtain' }],
    };
    expect(getPropertyOptions(metadata)).toHaveLength(2);
    expect(adjustPropertyValue('ArrowRight', 'brick', metadata)).toEqual({
      value: 'curtain',
      displayValue: 'Curtain',
      hitBoundary: false,
    });
  });

  it('steps, clamps, and validates numeric metadata consistently', () => {
    const metadata = {
      valueType: 'number',
      range: { min: 0, max: 1, step: 0.05, anchor: 0 },
    };
    expect(adjustPropertyValue('ArrowRight', 0.5, metadata)?.value).toBe(0.55);
    expect(adjustPropertyValue('PageUp', 0.95, metadata)).toEqual({
      value: 1,
      displayValue: '1',
      hitBoundary: true,
    });
    expect(validateNumericPropertyInput('Volume', '0.53', metadata, false)).toEqual({
      ok: true,
      value: 0.55,
    });
  });

  it('combines descriptive help with global type and option details', () => {
    const help = describePropertyHelp('Type', {
      valueType: 'list',
      tooltip: 'Choose a wall preset.',
      options: ['Brick', 'Curtain'],
    }, true);
    expect(help).toBe('Choose a wall preset. Type: list. Options: Brick, Curtain. Editable.');
  });
});
