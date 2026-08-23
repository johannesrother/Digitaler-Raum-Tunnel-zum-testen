const WHITE_ROOM_SOUND_VOLUME = 0.8;
const WHITE_ROOM_SOUND_URL = new URL(
  "../../assets/sounds/82078__kapanoush__sinus-aditive.aiff",
  import.meta.url,
);

/** Reuses the tunnel's simple global HTML-audio playback approach. */
export function createWhiteRoomTone({ onActivate } = {}) {
  const whiteRoomAudio = new Audio(WHITE_ROOM_SOUND_URL.href);
  whiteRoomAudio.preload = "auto";
  whiteRoomAudio.loop = false;
  whiteRoomAudio.volume = WHITE_ROOM_SOUND_VOLUME;
  whiteRoomAudio.load();

  let unlocked = false;
  let unlocking = false;
  let activated = false;
  let fadeFrame = null;

  const unlock = async () => {
    if (unlocked || unlocking) {
      return;
    }
    unlocking = true;
    try {
      whiteRoomAudio.volume = 0;
      await whiteRoomAudio.play();
      whiteRoomAudio.pause();
      whiteRoomAudio.currentTime = 0;
      whiteRoomAudio.volume = WHITE_ROOM_SOUND_VOLUME;
      unlocked = true;
      removeUnlockListeners();
    } catch {
      whiteRoomAudio.volume = WHITE_ROOM_SOUND_VOLUME;
    } finally {
      unlocking = false;
    }
  };

  const removeUnlockListeners = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("click", unlock);
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("keydown", unlock);
  };

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("click", unlock);
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("keydown", unlock);

  return {
    activate({ fadeInDuration = 0 } = {}) {
      if (activated) {
        return;
      }
      activated = true;
      onActivate?.();
      whiteRoomAudio.currentTime = 0;
      whiteRoomAudio.volume = fadeInDuration > 0 ? 0 : WHITE_ROOM_SOUND_VOLUME;
      whiteRoomAudio.play().then(() => {
        if (fadeInDuration <= 0) return;
        const startedAt = performance.now();
        const update = () => {
          const progress = Math.min(1, (performance.now() - startedAt) / (fadeInDuration * 1000));
          whiteRoomAudio.volume = WHITE_ROOM_SOUND_VOLUME * progress;
          if (progress < 1) fadeFrame = window.requestAnimationFrame(update);
        };
        update();
      }).catch((error) => console.error("WHITE ROOM AUDIO ERROR:", error));
    },
    deactivate() {
      if (fadeFrame !== null) window.cancelAnimationFrame(fadeFrame);
      whiteRoomAudio.pause();
      whiteRoomAudio.currentTime = 0;
    },
    dispose() {
      removeUnlockListeners();
      whiteRoomAudio.pause();
      whiteRoomAudio.removeAttribute("src");
      whiteRoomAudio.load();
    },
  };
}
