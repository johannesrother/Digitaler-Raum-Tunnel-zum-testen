const IDYLL_SOUND_VOLUME = 0.7;
const IDYLL_SOUND_URL = new URL("../../assets/sounds/Idylle.wav", import.meta.url);

/** Global, looping background sound for the idyll only. */
export function createIdyllSound() {
  const idyllAudio = new Audio(IDYLL_SOUND_URL.href);
  idyllAudio.preload = "auto";
  idyllAudio.loop = true;
  idyllAudio.volume = IDYLL_SOUND_VOLUME;
  idyllAudio.load();

  let started = false;

  const start = () => {
    if (started) {
      return;
    }
    idyllAudio.play().then(() => {
      started = true;
      removeStartListeners();
    }).catch(() => {
      // A later real interaction retries the same simple HTML-audio play call.
    });
  };

  const removeStartListeners = () => {
    window.removeEventListener("pointerdown", start);
    window.removeEventListener("click", start);
    window.removeEventListener("touchstart", start);
    window.removeEventListener("keydown", start);
  };

  window.addEventListener("pointerdown", start);
  window.addEventListener("click", start);
  window.addEventListener("touchstart", start, { passive: true });
  window.addEventListener("keydown", start);
  start();

  return {
    stop() {
      started = false;
      removeStartListeners();
      idyllAudio.pause();
      idyllAudio.currentTime = 0;
    },
    dispose() {
      this.stop();
      idyllAudio.removeAttribute("src");
      idyllAudio.load();
    },
  };
}
