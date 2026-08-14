export const TUNNEL_SOUND_VOLUME = 0.18;

const TUNNEL_SOUND_DURATION = 60;
const TUNNEL_SOUND_FADE_DURATION = 0.75;
const TUNNEL_SOUND_URL = new URL(
  "../../assets/sounds/667735__theojt__mysterious-ambiance-music.wav",
  import.meta.url,
);

/**
 * A one-shot tunnel soundtrack. It is unlocked by the first user gesture,
 * but playback itself is started exclusively by the spatial Rift-entry event.
 */
export function createTunnelSound() {
  const audio = new Audio(TUNNEL_SOUND_URL);
  audio.preload = "auto";
  audio.loop = false;
  audio.volume = TUNNEL_SOUND_VOLUME;
  audio.muted = true;

  let unlocked = false;
  let entryRequested = false;
  let playing = false;
  let fadeTimer = null;
  let fadeFrame = null;

  const clearEndTimers = () => {
    if (fadeTimer !== null) {
      window.clearTimeout(fadeTimer);
      fadeTimer = null;
    }
    if (fadeFrame !== null) {
      window.cancelAnimationFrame(fadeFrame);
      fadeFrame = null;
    }
  };

  const stop = () => {
    clearEndTimers();
    audio.pause();
    audio.currentTime = 0;
    audio.volume = TUNNEL_SOUND_VOLUME;
    playing = false;
  };

  const fadeOutAndStop = () => {
    const fadeStartedAt = performance.now();
    const updateFade = () => {
      const progress = Math.min(1, (performance.now() - fadeStartedAt) / (TUNNEL_SOUND_FADE_DURATION * 1000));
      audio.volume = TUNNEL_SOUND_VOLUME * (1 - progress);
      if (progress < 1) {
        fadeFrame = window.requestAnimationFrame(updateFade);
        return;
      }
      stop();
    };
    updateFade();
  };

  const scheduleEnd = () => {
    fadeTimer = window.setTimeout(
      fadeOutAndStop,
      (TUNNEL_SOUND_DURATION - TUNNEL_SOUND_FADE_DURATION) * 1000,
    );
  };

  const startPlayback = () => {
    if (!unlocked || playing) {
      return;
    }
    playing = true;
    audio.currentTime = 0;
    audio.volume = TUNNEL_SOUND_VOLUME;
    audio.play()
      .then(scheduleEnd)
      .catch(() => {
        playing = false;
      });
  };

  const arm = async () => {
    if (unlocked) {
      return;
    }
    try {
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      unlocked = true;
      if (entryRequested) {
        startPlayback();
      }
    } catch {
      audio.muted = false;
    }
  };

  const removeArmListeners = () => {
    window.removeEventListener("pointerdown", arm);
    window.removeEventListener("keydown", arm);
  };

  window.addEventListener("pointerdown", arm, { once: true });
  window.addEventListener("keydown", arm, { once: true });
  audio.addEventListener("ended", stop);

  return {
    start() {
      entryRequested = true;
      startPlayback();
    },
    dispose() {
      removeArmListeners();
      audio.removeEventListener("ended", stop);
      stop();
      audio.removeAttribute("src");
      audio.load();
    },
  };
}
