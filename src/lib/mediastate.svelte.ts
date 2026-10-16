// Runtime-only facts about media (not saved in the project): preview proxies and waveforms.
export interface MediaRuntime {
  proxy: 'none' | 'pending' | 'working' | 'ready' | 'failed';
  progress: number;
  /** the preview copy was made by the browser's hardware encoder (else by ffmpeg) */
  proxyHw?: boolean;
  /** waveform: peak level per 1/PEAKS_PER_SEC s, 0..255 */
  peaks?: Uint8Array;
  /** the browser can play the original file directly */
  playable?: boolean;
}

export const PEAKS_PER_SEC = 50;

export const mediaState = $state<Record<string, MediaRuntime>>({});

export function rt(id: string): MediaRuntime {
  // read back through the state proxy: the object we assign is not the reactive one
  if (!mediaState[id]) mediaState[id] = { proxy: 'none', progress: 0 };
  return mediaState[id];
}
