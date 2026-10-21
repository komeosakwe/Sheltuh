"use client";

import { Button } from "@/components/ui/Button";
import DoorIcon from "./DoorIcon";

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Button
      size="sm"
      variant={on ? "solid" : "outline"}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className="min-h-11"
    >
      {on && <DoorIcon name="check" className="size-5" />}
      {label}
    </Button>
  );
}

/** Vibrate (where the phone can) and Sound, remembered on this device (§5.A7). */
export default function DoorSettings({
  vibrateSupported,
  vibrate,
  sound,
  onVibrateChange,
  onSoundChange,
}: {
  vibrateSupported: boolean;
  vibrate: boolean;
  sound: boolean;
  onVibrateChange: (on: boolean) => void;
  onSoundChange: (on: boolean) => void;
}) {
  return (
    <div role="group" aria-label="Result signals" className="flex flex-wrap gap-2">
      {vibrateSupported && <Toggle label="Vibrate" on={vibrate} onChange={onVibrateChange} />}
      <Toggle label="Sound" on={sound} onChange={onSoundChange} />
    </div>
  );
}
