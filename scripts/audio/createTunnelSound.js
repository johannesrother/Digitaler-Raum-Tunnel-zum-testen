export const TUNNEL_SOUND_VOLUME = 0.8;

const TUNNEL_SOUND_DURATION = 60;
const TUNNEL_SOUND_URL = new URL(
  "../../assets/sounds/667735__theojt__mysterious-ambiance-music.wav",
  import.meta.url,
);

/** A single global HTML audio element for the tunnel soundtrack. */
export function createTunnelSound() {
  const tunnelAudio = new Audio(TUNNEL_SOUND_URL.href);
  tunnelAudio.preload = "auto";
  tunnelAudio.loop = false;
  tunnelAudio.volume = TUNNEL_SOUND_VOLUME;
  tunnelAudio.load();
  console.info("TUNNEL WAV URL:", TUNNEL_SOUND_URL.href);

  let unlocked = false;
  let unlocking = false;
  let started = false;
  let stopTimer = null;

  tunnelAudio.addEventListener("canplay", () => {
    console.info("TUNNEL WAV CANPLAY");
  }, { once: true });

  const stop = () => {
    if (stopTimer !== null) {
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }
    tunnelAudio.pause();
    tunnelAudio.currentTime = 0;
    started = false;
  };

  const unlock = async () => {
    if (unlocked || unlocking) {
      return;
    }
    unlocking = true;
    try {
      // This runs only as part of the first real user interaction. It makes
      // later playback at the spatial Rift crossing eligible for autoplay.
      tunnelAudio.volume = 0;
      await tunnelAudio.play();
      tunnelAudio.pause();
      tunnelAudio.currentTime = 0;
      tunnelAudio.volume = TUNNEL_SOUND_VOLUME;
      unlocked = true;
      removeUnlockListeners();
    } catch (error) {
      tunnelAudio.volume = TUNNEL_SOUND_VOLUME;
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
    start() {
      if (started) {
        return;
      }
      started = true;
      tunnelAudio.currentTime = 0;
      tunnelAudio.volume = TUNNEL_SOUND_VOLUME;
      tunnelAudio.play().then(() => {
        console.info("TUNNEL WAV PLAY OK");
        stopTimer = window.setTimeout(stop, TUNNEL_SOUND_DURATION * 1000);
      }).catch((error) => {
        started = false;
        console.error("TUNNEL WAV ERROR:", error);
      });
    },
    dispose() {
      removeUnlockListeners();
      stop();
      tunnelAudio.removeAttribute("src");
      tunnelAudio.load();
    },
    getDebugState() {
      return { unlocked, playing: !tunnelAudio.paused, volume: tunnelAudio.volume };
    },
  };
}
