import { HEARING_RADIUS } from '../state/gameState';
import {
  AudioEngine,
  type SpatialAudioPosition,
  type SpatialTransmissionResolver,
} from './audioEngine';

export const WORLD_FOOTSTEP_GAIN = 0.7;

export type WorldSoundSource = SpatialAudioPosition & {
  gain?: number;
  range?: number;
  doorOrientation?: 'horizontal' | 'vertical';
};

type ListenerPositionGetter = () => SpatialAudioPosition;
type AcousticConnectivityResolver = (
  source: SpatialAudioPosition,
  listener: SpatialAudioPosition,
) => boolean;

/** Central entry point for positional one-shot sounds emitted by the world. */
export class WorldAudioRouter {
  constructor(
    private readonly audio: AudioEngine,
    private readonly getListenerPosition: ListenerPositionGetter,
    private readonly isWorldLayerEnabled: () => boolean,
    private readonly resolveTransmission: SpatialTransmissionResolver,
    private readonly canRouteSource: AcousticConnectivityResolver,
  ) {
    this.audio.setSpatialTransmissionResolver(resolveTransmission);
  }

  playSample(url: string, source: WorldSoundSource): void {
    const audibleSource = this.sourceOnListenerSide(source);
    if (!url || !this.canRoute(audibleSource)) return;
    void this.audio.playSpatialSample(
      url,
      audibleSource,
      this.getListenerPosition(),
      source.gain ?? 1,
      source.range ?? HEARING_RADIUS,
    );
  }

  async playSequence(urls: string[], source: WorldSoundSource): Promise<void> {
    if (urls.length === 0 || !this.canRoute(source)) return;
    for (const url of urls) {
      if (!url || !this.canRoute(source)) return;
      await this.audio.playSpatialSampleAndWait(
        url,
        this.sourceOnListenerSide(source),
        this.getListenerPosition(),
        source.gain ?? 1,
        source.range ?? HEARING_RADIUS,
      );
    }
  }

  private sourceOnListenerSide(source: WorldSoundSource): WorldSoundSource {
    const listener = this.getListenerPosition();
    if (source.doorOrientation === 'horizontal' && listener.y < source.y) {
      return { ...source, y: source.y - 1 };
    }
    if (source.doorOrientation === 'vertical' && listener.x < source.x) {
      return { ...source, x: source.x - 1 };
    }
    return source;
  }

  private canRoute(source: WorldSoundSource): boolean {
    return this.isWorldLayerEnabled()
      && this.canRouteSource(source, this.getListenerPosition());
  }
}
