/**
 * Non-visual result signals at the door (docs/design/check-in.md §5.A4):
 * vibration where the browser has it, and short square-wave beeps that cut
 * through crowd noise. Both are best effort and never throw.
 */
import type { DoorTone } from "./door-copy";
import { DOOR_TONES, DOOR_VIBRATION } from "./timing";

export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function vibrateFor(tone: DoorTone): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate([...DOOR_VIBRATION[tone]]);
  } catch {
    // Some browsers throw without a recent user gesture: no vibration then.
  }
}

/**
 * Web Audio beeps. Browsers only allow sound after a user gesture, so
 * `unlock()` is called from the Start-camera, Check and Sound taps.
 */
export class DoorSound {
  private context: AudioContext | null = null;

  unlock(): void {
    if (typeof window === "undefined" || typeof window.AudioContext !== "function") return;
    try {
      this.context ??= new window.AudioContext();
      if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
    } catch {
      this.context = null;
    }
  }

  play(tone: DoorTone): void {
    const context = this.context;
    if (!context) return;
    try {
      const { hz, ms, count, gapMs } = DOOR_TONES[tone];
      let at = context.currentTime;
      for (let i = 0; i < count; i += 1) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "square";
        oscillator.frequency.value = hz;
        gain.gain.value = 0.2;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + ms / 1000);
        at += (ms + gapMs) / 1000;
      }
    } catch {
      // No sound is better than a broken scanner.
    }
  }

  close(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
