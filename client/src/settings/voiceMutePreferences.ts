import type { SettingsStore } from './settingsStore';

export type VoiceMuteTarget = { id: string; userId?: string | null };

/** Stores personal voice choices separately from the user's listen volume. */
export class VoiceMutePreferences {
  private scope: string | null = null;
  private context: string | null = null;
  private readonly mutedUserIds = new Set<string>();
  private readonly mutedSessionIds = new Set<string>();

  constructor(private readonly settings: Pick<SettingsStore, 'loadVoiceMutes' | 'saveVoiceMutes'>) {}

  /** Select preferences for this grid and authenticated listener before attaching voice. */
  setScope(gridId: string, listenerUserId?: string | null): void {
    const scope = gridId && listenerUserId ? JSON.stringify([gridId, listenerUserId]) : null;
    const context = JSON.stringify([gridId, listenerUserId ?? null]);
    if (context === this.context) return;
    this.context = context;
    this.scope = scope;
    this.mutedUserIds.clear();
    this.mutedSessionIds.clear();
    if (scope) {
      for (const userId of this.settings.loadVoiceMutes(scope)) this.mutedUserIds.add(userId);
    }
  }

  isMuted(target: VoiceMuteTarget): boolean {
    return Boolean(this.scope && target.userId && this.mutedUserIds.has(target.userId)) || this.mutedSessionIds.has(target.id);
  }

  /** Return the resulting mute state, applying it to all sessions of a known account. */
  toggleMute(target: VoiceMuteTarget): boolean {
    const muted = !this.isMuted(target);
    if (this.scope && target.userId) {
      this.mutedSessionIds.delete(target.id);
      if (muted) this.mutedUserIds.add(target.userId);
      else this.mutedUserIds.delete(target.userId);
      this.settings.saveVoiceMutes(this.scope, [...this.mutedUserIds]);
    } else {
      if (muted) this.mutedSessionIds.add(target.id);
      else this.mutedSessionIds.delete(target.id);
    }
    return muted;
  }

  /** End session-only preferences when the listener disconnects. */
  clearSession(): void {
    this.mutedSessionIds.clear();
  }
}
