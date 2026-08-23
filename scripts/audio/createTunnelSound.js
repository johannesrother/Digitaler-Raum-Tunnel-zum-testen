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
  let watchdogTimer = null;
  let resumePending = false;
  let lastPlaybackTime = 0;
  let stalledChecks = 0;
  let fadeInFrame = null;

  tunnelAudio.addEventListener("canplay", () => {
    console.info("TUNNEL WAV CANPLAY");
  }, { once: true });

  const disableWatchdog = () => {
    if (watchdogTimer !== null) {
      window.clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    resumePending = false;
    stalledChecks = 0;
  };

  const stop = () => {
    // Mark the soundtrack inactive before pausing so the Safari watchdog can
    // never revive it after the White Room transition or disposal.
    started = false;
    disableWatchdog();
    if (stopTimer !== null) {
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }
    tunnelAudio.pause();
    tunnelAudio.currentTime = 0;
    if (fadeInFrame !== null) {
      window.cancelAnimationFrame(fadeInFrame);
      fadeInFrame = null;
    }
  };

  const fadeIn = (duration) => {
    if (duration <= 0) {
      tunnelAudio.volume = TUNNEL_SOUND_VOLUME;
      return;
    }
    const startedAt = performance.now();
    const update = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / (duration * 1000));
      tunnelAudio.volume = TUNNEL_SOUND_VOLUME * progress;
      if (progress < 1) {
        fadeInFrame = window.requestAnimationFrame(update);
      } else {
        fadeInFrame = null;
      }
    };
    update();
  };

  const resumePlayback = () => {
    const beforeFileEnd = !Number.isFinite(tunnelAudio.duration)
      || tunnelAudio.currentTime < tunnelAudio.duration - 0.1;
    if (!started || resumePending || tunnelAudio.ended || !beforeFileEnd) {
      return;
    }
    resumePending = true;
    tunnelAudio.play().then(() => {
      console.info("TUNNEL AUDIO RESUMED");
    }).catch((error) => {
      console.error("TUNNEL AUDIO RESUME ERROR", error);
    }).finally(() => {
      resumePending = false;
    });
  };

  const enableWatchdog = () => {
    if (watchdogTimer !== null) {
      return;
    }
    lastPlaybackTime = tunnelAudio.currentTime;
    watchdogTimer = window.setInterval(() => {
      if (!started || tunnelAudio.ended) {
        disableWatchdog();
        return;
      }
      const currentTime = tunnelAudio.currentTime;
      const hasStoppedProgressing = !tunnelAudio.paused
        && tunnelAudio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
        && Math.abs(currentTime - lastPlaybackTime) < 0.02;
      stalledChecks = hasStoppedProgressing ? stalledChecks + 1 : 0;
      if (tunnelAudio.paused || stalledChecks >= 2) {
        resumePlayback();
      }
      lastPlaybackTime = currentTime;
    }, 1000);
  };

  const onPause = () => {
    if (!started) {
      return;
    }
    console.info("TUNNEL AUDIO SAFARI PAUSED");
    resumePlayback();
  };

  const onStalled = () => {
    if (!started) {
      return;
    }
    console.info("TUNNEL AUDIO SAFARI STALLED");
    resumePlayback();
  };

  const onPlaying = () => {
    lastPlaybackTime = tunnelAudio.currentTime;
    stalledChecks = 0;
  };

  const onEnded = () => {
    started = false;
    disableWatchdog();
  };

  const onError = () => {
    if (started) {
      console.error("TUNNEL AUDIO RESUME ERROR", tunnelAudio.error);
    }
  };

  tunnelAudio.addEventListener("pause", onPause);
  tunnelAudio.addEventListener("stalled", onStalled);
  tunnelAudio.addEventListener("suspend", onStalled);
  tunnelAudio.addEventListener("waiting", onStalled);
  tunnelAudio.addEventListener("playing", onPlaying);
  tunnelAudio.addEventListener("ended", onEnded);
  tunnelAudio.addEventListener("error", onError);

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
    start({ fadeInDuration = 0 } = {}) {
      if (started) {
        return;
      }
      started = true;
      tunnelAudio.currentTime = 0;
      tunnelAudio.volume = fadeInDuration > 0 ? 0 : TUNNEL_SOUND_VOLUME;
      tunnelAudio.play().then(() => {
        console.info("TUNNEL WAV PLAY OK");
        enableWatchdog();
        fadeIn(fadeInDuration);
        stopTimer = window.setTimeout(stop, TUNNEL_SOUND_DURATION * 1000);
      }).catch((error) => {
        started = false;
        console.error("TUNNEL WAV ERROR:", error);
      });
    },
    stop,
    dispose() {
      removeUnlockListeners();
      stop();
      tunnelAudio.removeEventListener("pause", onPause);
      tunnelAudio.removeEventListener("stalled", onStalled);
      tunnelAudio.removeEventListener("suspend", onStalled);
      tunnelAudio.removeEventListener("waiting", onStalled);
      tunnelAudio.removeEventListener("playing", onPlaying);
      tunnelAudio.removeEventListener("ended", onEnded);
      tunnelAudio.removeEventListener("error", onError);
      tunnelAudio.removeAttribute("src");
      tunnelAudio.load();
    },
    getDebugState() {
      return { unlocked, playing: !tunnelAudio.paused, volume: tunnelAudio.volume };
    },
  };
}
