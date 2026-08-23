const RIFT_SOUND_VOLUME = 0.8;
const RIFT_SOUND_URL = new URL(
  "../../assets/sounds/477648__erokia__traveling-into-a-black-hole.wav",
  import.meta.url,
);

export function createRiftSound() {
  const riftAudio = new Audio(RIFT_SOUND_URL.href);
  riftAudio.preload = "auto";
  riftAudio.loop = false;
  riftAudio.volume = RIFT_SOUND_VOLUME;
  riftAudio.load();
  let started = false;
  let fadeFrame = null;
  let unlocked = false;
  let unlocking = false;

  const removeUnlockListeners = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("click", unlock);
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("keydown", unlock);
  };

  const unlock = async () => {
    if (unlocked || unlocking) {
      return;
    }
    unlocking = true;
    try {
      riftAudio.volume = 0;
      await riftAudio.play();
      riftAudio.pause();
      riftAudio.currentTime = 0;
      riftAudio.volume = RIFT_SOUND_VOLUME;
      unlocked = true;
      removeUnlockListeners();
    } catch {
      riftAudio.volume = RIFT_SOUND_VOLUME;
    } finally {
      unlocking = false;
    }
  };

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("click", unlock);
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("keydown", unlock);

  const fadeOutAndStop = (duration = 2.5) => {
    if (!started) {
      return;
    }
    const from = riftAudio.volume;
    const startedAt = performance.now();
    const update = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / (duration * 1000));
      riftAudio.volume = from * (1 - progress);
      if (progress < 1) {
        fadeFrame = window.requestAnimationFrame(update);
        return;
      }
      riftAudio.pause();
      riftAudio.currentTime = 0;
      riftAudio.volume = RIFT_SOUND_VOLUME;
      started = false;
      fadeFrame = null;
    };
    update();
  };

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      riftAudio.currentTime = 0;
      riftAudio.volume = RIFT_SOUND_VOLUME;
      riftAudio.play().catch(() => { started = false; });
    },
    fadeOutAndStop,
    dispose() {
      removeUnlockListeners();
      if (fadeFrame !== null) {
        window.cancelAnimationFrame(fadeFrame);
      }
      riftAudio.pause();
      riftAudio.removeAttribute("src");
      riftAudio.load();
    },
  };
}
