import type { CommandDescriptor } from './commandTypes';
import type { PeerState } from '../state/gameState';

type UserActionsDeps = {
  getPeer: (id: string) => PeerState | undefined;
  isMuted: (peer: PeerState) => boolean;
  toggleMute: (peer: PeerState) => void;
  announce: (message: string) => void;
};

/** Capture the selected connection so roster changes cannot redirect an open menu. */
export function getUserActions(peerId: string, deps: UserActionsDeps): Array<CommandDescriptor & { run: () => void }> {
  const peer = deps.getPeer(peerId);
  if (!peer) return [];
  const shouldMute = !deps.isMuted(peer);
  return [{
    id: 'personalVoiceMute',
    label: shouldMute ? 'Mute voice for me' : 'Unmute voice for me',
    section: 'User actions',
    shortcut: '',
    tooltip: `Turn ${peer.nickname}'s voice ${shouldMute ? 'off' : 'on'} for you.`,
    run: () => {
      const current = deps.getPeer(peerId);
      if (!current) {
        deps.announce(`${peer.nickname} has left.`);
        return;
      }
      if (deps.isMuted(current) !== shouldMute) deps.toggleMute(current);
      deps.announce(`${current.nickname} ${shouldMute ? 'muted' : 'unmuted'} for you.`);
    },
  }];
}
