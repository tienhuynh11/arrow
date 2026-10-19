// Thanh trượt âm lượng nhạc / hiệu ứng cho hộp Cài đặt (chèn <AudioVolumes /> ngay dưới công tắc "Âm thanh").
import { musicVol, saveSettings, sfxVol, sound } from '../settings';
import { sfx } from '../audio';
import './audio-settings.css';

function Slider({ label, sig, test }: { label: string; sig: typeof musicVol; test?: () => void }) {
  return (
    <label class="set-row vol-row">
      <b>{label}</b>
      <input
        type="range"
        class="vol-range"
        min="0"
        max="100"
        step="5"
        value={Math.round(sig.value * 100)}
        disabled={!sound.value}
        aria-label={label}
        onInput={(e) => {
          sig.value = Number((e.currentTarget as HTMLInputElement).value) / 100;
        }}
        onChange={() => {
          saveSettings();
          test?.();
        }}
      />
      <span class="vol-num">{Math.round(sig.value * 100)}</span>
    </label>
  );
}

export function AudioVolumes() {
  return (
    <>
      <Slider label="Nhạc nền" sig={musicVol} />
      <Slider label="Hiệu ứng" sig={sfxVol} test={() => sfx('hit')} />
    </>
  );
}
