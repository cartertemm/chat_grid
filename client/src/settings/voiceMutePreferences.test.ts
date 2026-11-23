// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from './settingsStore';
import { VoiceMutePreferences } from './voiceMutePreferences';

beforeEach(() => localStorage.clear());

describe('personal voice mute preferences', () => {
  it('remembers speaker accounts across sessions while isolating grids and listeners', () => {
    const preferences = new VoiceMutePreferences(new SettingsStore());
    preferences.setScope('https://grid.test/ws', 'listener');
    expect(preferences.toggleMute({ id: 'connection-1', userId: 'speaker' })).toBe(true);
    const reloaded = new VoiceMutePreferences(new SettingsStore());
    reloaded.setScope('https://grid.test/ws', 'listener');
    expect(reloaded.isMuted({ id: 'connection-2', userId: 'speaker' })).toBe(true);
    expect(reloaded.isMuted({ id: 'connection-1', userId: 'other-speaker' })).toBe(false);
    reloaded.setScope('https://other-grid.test/ws', 'listener');
    expect(reloaded.isMuted({ id: 'connection-2', userId: 'speaker' })).toBe(false);
    reloaded.setScope('https://grid.test/ws', 'other-listener');
    expect(reloaded.isMuted({ id: 'connection-2', userId: 'speaker' })).toBe(false);
    preferences.toggleMute({ id: 'connection-2', userId: 'speaker' });
    reloaded.setScope('https://grid.test/ws', 'listener');
    expect(reloaded.isMuted({ id: 'connection-3', userId: 'speaker' })).toBe(false);
  });

  it('keeps anonymous identities local to the connection and clears them on disconnect', () => {
    const preferences = new VoiceMutePreferences(new SettingsStore());
    preferences.setScope('grid', 'listener');
    preferences.toggleMute({ id: 'guest' });
    preferences.setScope('grid', 'listener');
    expect(preferences.isMuted({ id: 'guest' })).toBe(true);
    expect(preferences.isMuted({ id: 'other-guest' })).toBe(false);
    preferences.clearSession();
    expect(preferences.isMuted({ id: 'guest' })).toBe(false);
    preferences.setScope('grid', null);
    preferences.toggleMute({ id: 'speaker', userId: 'account' });
    preferences.setScope('other-grid', null);
    expect(preferences.isMuted({ id: 'speaker', userId: 'account' })).toBe(false);
  });

  it('keeps mute usable when browser storage is corrupt or unavailable', () => {
    localStorage.setItem('chatGridVoiceMutes', 'null');
    const preferences = new VoiceMutePreferences(new SettingsStore());
    preferences.setScope('grid', 'listener');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(preferences.toggleMute({ id: 'peer', userId: 'speaker' })).toBe(true);
    expect(preferences.isMuted({ id: 'peer-2', userId: 'speaker' })).toBe(true);
    expect(preferences.toggleMute({ id: 'peer', userId: 'speaker' })).toBe(false);
    setItem.mockRestore();
  });
});
