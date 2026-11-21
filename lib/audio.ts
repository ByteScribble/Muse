import { AudioQuality, IOSOutputFormat, RecordingOptions } from "expo-audio";

/**
 * Speech-tuned capture, not music capture.
 *
 * The stock HIGH_QUALITY preset records 44.1kHz stereo at 128kbps — roughly
 * 5x the bytes of what follows, for zero transcription benefit: speech models
 * resample to 16kHz mono anyway. On Android, `voice_recognition` also asks the
 * platform for its speech-tuned capture path (noise suppression + AGC), which
 * the default `mic` source does not apply.
 */
export const SPEECH_RECORDING: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: true, // powers the silence gate below
  android: {
    outputFormat: "mpeg4",
    audioEncoder: "aac",
    audioSource: "voice_recognition",
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 32000,
  },
};

/**
 * Peak level (dBFS) below which a whole recording is treated as "nobody spoke".
 * Speech peaks land around -25..-5; room tone sits below -50; digital silence
 * reads -160. -45 leaves headroom for a quiet talker in a quiet room.
 */
export const SILENCE_PEAK_DBFS = -45;

/** dBFS → 0..1, for bar heights. Below -60 reads as nothing. */
export function levelFromDbfs(metering: number | undefined): number {
  if (metering === undefined || Number.isNaN(metering)) return 0;
  return Math.max(0, Math.min(1, (metering + 60) / 60));
}

/**
 * Tracks the loudest moment of a take. We only need the peak, not a VAD:
 * the user decides when the thought ends by tapping stop, so there is no
 * endpoint to infer — the only question is whether anything was said at all.
 */
export class PeakMeter {
  private peak = Number.NEGATIVE_INFINITY;
  private sawAnyReading = false;

  observe(metering: number | undefined): void {
    if (metering === undefined || Number.isNaN(metering)) return;
    this.sawAnyReading = true;
    if (metering > this.peak) this.peak = metering;
  }

  reset(): void {
    this.peak = Number.NEGATIVE_INFINITY;
    this.sawAnyReading = false;
  }

  get peakDbfs(): number {
    return this.peak;
  }

  /**
   * Only claims silence when metering actually reported something. If a
   * platform never reports levels we must not swallow a real recording.
   */
  isSilent(): boolean {
    return this.sawAnyReading && this.peak < SILENCE_PEAK_DBFS;
  }
}
