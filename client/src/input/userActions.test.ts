import { describe, expect, it, vi } from 'vitest';
import { getUserActions } from './userActions';
import { formatCommandMenuLabel } from './commandTypes';

describe('personal voice action', () => {
  const alex = { id: 'a', nickname: 'Alex', x: 0, y: 0, z: 0, facingDeg: 0, acousticZoneId: 'floor:0' };

  it('keeps the chosen action and announces the current nickname', () => {
    const getPeer = vi.fn().mockReturnValue(alex);
    const isMuted = vi.fn().mockReturnValue(false);
    const toggleMute = vi.fn();
    const announce = vi.fn();
    const [action] = getUserActions(alex.id, { getPeer, isMuted, toggleMute, announce });
    expect(formatCommandMenuLabel(action)).toBe('Mute voice for me');
    getPeer.mockReturnValue({ ...alex, nickname: 'Alexandra' });
    action.run();
    expect(announce).toHaveBeenCalledWith('Alexandra muted for you.');
    isMuted.mockReturnValue(true);
    action.run();
    expect(toggleMute).toHaveBeenCalledTimes(1);
    expect(getUserActions(alex.id, { getPeer, isMuted, toggleMute, announce })[0].label).toBe('Unmute voice for me');
  });

  it('does not mute another person if the selected connection has left', () => {
    const getPeer = vi.fn().mockReturnValueOnce(alex);
    const toggleMute = vi.fn();
    const announce = vi.fn();
    const [action] = getUserActions(alex.id, { getPeer, isMuted: () => false, toggleMute, announce });
    action.run();
    expect(toggleMute).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith('Alex has left.');
  });
});
