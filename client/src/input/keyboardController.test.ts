// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupKeyboardInputHandlers } from './keyboardController';
import type { GameMode } from '../state/gameState';

afterEach(() => vi.restoreAllMocks());

describe('audio shortcut key repeat', () => {
  it('toggles once per press while preserving arrows and numeric text repeat', () => {
    document.body.innerHTML = '<div class="hidden"></div><canvas tabindex="0"></canvas>';
    const canvas = document.querySelector('canvas')!;
    canvas.focus();
    const state = {
      running: true, mode: 'normal' as GameMode, keysPressed: {}, nicknameInput: '', cursorPos: 0,
    };
    const handleModeInput = vi.fn();
    const listeners = vi.spyOn(document, 'addEventListener');
    const windowListeners = vi.spyOn(window, 'addEventListener');
    setupKeyboardInputHandlers({
      dom: { canvas, settingsModal: document.querySelector('div')! },
      state, handleModeInput,
      isTextEditingMode: (mode) => mode === 'chat',
      closeSettings: vi.fn(), hasBlockedArrowTeleport: () => false,
      canOpenCommandPaletteInMode: () => false, openCommandPalette: vi.fn(),
      getModeKeyUpTarget: () => null, onModeKeyUp: vi.fn(), onReleaseAllKeys: vi.fn(),
      pasteIntoActiveTextInput: () => false, updateStatus: vi.fn(), setReplaceTextOnNextType: vi.fn(),
    });
    const key = (type: string, code: string, shiftKey = false, repeat = false) => {
      document.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Digit4' ? '$' : code, shiftKey, repeat }));
    };
    try {
      for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
        handleModeInput.mockClear();
        key('keydown', code, true);
        key('keydown', code, true, true);
        key('keydown', code, true);
        expect(handleModeInput).toHaveBeenCalledTimes(1);
        key('keyup', code, true);
        key('keydown', code, true);
        expect(handleModeInput).toHaveBeenCalledTimes(2);
        key('keyup', code, true);
      }
      handleModeInput.mockClear();
      key('keydown', 'ArrowUp');
      key('keydown', 'ArrowUp', false, true);
      expect(handleModeInput).toHaveBeenCalledTimes(2);
      key('keyup', 'ArrowUp');
      handleModeInput.mockClear();
      state.mode = 'chat';
      key('keydown', 'Digit4');
      key('keydown', 'Digit4', false, true);
      expect(handleModeInput).toHaveBeenCalledTimes(2);
    } finally {
      for (const [type, listener, options] of listeners.mock.calls) {
        document.removeEventListener(type, listener, options);
      }
      for (const [type, listener, options] of windowListeners.mock.calls) {
        window.removeEventListener(type, listener, options);
      }
    }
  });
});

describe('held keys after focus loss', () => {
  it('releases held keys when the window blurs or the tab is hidden', () => {
    document.body.innerHTML = '<div class="hidden"></div><canvas tabindex="0"></canvas>';
    const canvas = document.querySelector('canvas')!;
    canvas.focus();
    const state = {
      running: true, mode: 'normal' as GameMode, keysPressed: {} as Record<string, boolean>, nicknameInput: '', cursorPos: 0,
    };
    const onReleaseAllKeys = vi.fn();
    const listeners = vi.spyOn(document, 'addEventListener');
    const windowListeners = vi.spyOn(window, 'addEventListener');
    setupKeyboardInputHandlers({
      dom: { canvas, settingsModal: document.querySelector('div')! },
      state, handleModeInput: vi.fn(),
      isTextEditingMode: () => false,
      closeSettings: vi.fn(), hasBlockedArrowTeleport: () => false,
      canOpenCommandPaletteInMode: () => false, openCommandPalette: vi.fn(),
      getModeKeyUpTarget: () => null, onModeKeyUp: vi.fn(), onReleaseAllKeys,
      pasteIntoActiveTextInput: () => false, updateStatus: vi.fn(), setReplaceTextOnNextType: vi.fn(),
    });
    const hidden = vi.spyOn(document, 'hidden', 'get');
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp' }));
      expect(state.keysPressed.ArrowUp).toBe(true);
      window.dispatchEvent(new Event('blur'));
      expect(state.keysPressed.ArrowUp).toBe(false);
      expect(onReleaseAllKeys).toHaveBeenCalledTimes(1);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp' }));
      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(state.keysPressed.ArrowUp).toBe(true);
      hidden.mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(state.keysPressed.ArrowUp).toBe(false);
      expect(onReleaseAllKeys).toHaveBeenCalledTimes(2);
    } finally {
      for (const [type, listener, options] of listeners.mock.calls) {
        document.removeEventListener(type, listener, options);
      }
      for (const [type, listener, options] of windowListeners.mock.calls) {
        window.removeEventListener(type, listener, options);
      }
    }
  });
});
