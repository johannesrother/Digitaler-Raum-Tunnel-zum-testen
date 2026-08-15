export const TUNNEL_SOUND_VOLUME = 0.7;

const TUNNEL_SOUND_DURATION = 60;
const TUNNEL_SOUND_FADE_DURATION = 0.75;
const TUNNEL_SOUND_URL = new URL(
  "../../assets/sounds/667735__theojt__mysterious-ambiance-music.wav",
  import.meta.url,
);

/**
 * A global, non-positional tunnel soundtrack. The WAV is decoded ahead of
 * time, while its AudioContext is resumed by the experience's first existing
 * user interaction. Actual playback remains tied only to the Rift crossing.
 */
export function createTunnelSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  let context = null;
  let gain = null;
  let buffer = null;
  let source = null;
  let loadPromise = null;
  let entryRequested = false;
  let playing = false;
  let unlocked = false;
  let fadeTimer = null;
  let stopTimer = null;

  const clearEndTimers = () => {
    if (fadeTimer !== null) {
      window.clearTimeout(fadeTimer);
      fadeTimer = null;
    }
    if (stopTimer !== null) {
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }
  };

  const ensureContext = () => {
    if (context || !AudioContext) {
      return context;
    }
    context = new AudioContext();
    gain = context.createGain();
    gain.gain.value = TUNNEL_SOUND_VOLUME;
    gain.connect(context.destination);
    return context;
  };

  const stop = () => {
    clearEndTimers();
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source that has already ended cannot be stopped again.
      }
      source.disconnect();
      source = null;
    }
    if (gain && context) {
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setValueAtTime(TUNNEL_SOUND_VOLUME, context.currentTime);
    }
    playing = false;
  };

  const fadeOutAndStop = () => {
    if (!context || !gain || !playing) {
      stop();
      return;
    }
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + TUNNEL_SOUND_FADE_DURATION);
    stopTimer = window.setTimeout(stop, TUNNEL_SOUND_FADE_DURATION * 1000);
  };

  const scheduleEnd = () => {
    fadeTimer = window.setTimeout(
      fadeOutAndStop,
      (TUNNEL_SOUND_DURATION - TUNNEL_SOUND_FADE_DURATION) * 1000,
    );
  };

  const startPlayback = () => {
    if (!entryRequested || playing || !buffer) {
      return;
    }
    const activeContext = ensureContext();
    if (!activeContext || activeContext.state !== "running" || !gain) {
      console.warn("TUNNEL AUDIO START WAITING FOR AUDIO CONTEXT");
      return;
    }
    source = activeContext.createBufferSource();
    source.buffer = buffer;
    source.loop = false;
    source.connect(gain);
    source.onended = () => {
      source?.disconnect();
      source = null;
      playing = false;
      clearEndTimers();
      console.info("TUNNEL AUDIO ENDED");
    };
    gain.gain.cancelScheduledValues(activeContext.currentTime);
    gain.gain.setValueAtTime(TUNNEL_SOUND_VOLUME, activeContext.currentTime);
    source.start();
    playing = true;
    console.info("TUNNEL AUDIO START", {
      timestamp: performance.now(),
      tunnelTime: 0,
      volume: TUNNEL_SOUND_VOLUME,
      contextState: activeContext.state,
    });
    scheduleEnd();
  };

  const load = async () => {
    try {
      const response = await fetch(TUNNEL_SOUND_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const data = await response.arrayBuffer();
      const activeContext = ensureContext();
      if (!activeContext) {
        throw new Error("Web Audio is not supported by this browser");
      }
      buffer = await activeContext.decodeAudioData(data);
      console.info("TUNNEL AUDIO LOAD OK", {
        url: TUNNEL_SOUND_URL.href,
        duration: buffer.duration,
      });
      startPlayback();
    } catch (error) {
      console.error("TUNNEL AUDIO LOAD ERROR:", error);
    }
  };

  const arm = async () => {
    const activeContext = ensureContext();
    if (!activeContext) {
      console.error("AUDIO CONTEXT STATE: unavailable");
      return;
    }
    console.info("AUDIO CONTEXT STATE:", activeContext.state);
    try {
      await activeContext.resume();
      unlocked = activeContext.state === "running";
      if (unlocked) {
        console.info("AUDIO CONTEXT RUNNING");
        removeArmListeners();
        startPlayback();
      }
    } catch (error) {
      console.error("AUDIO CONTEXT RESUME ERROR:", error);
    }
  };

  const removeArmListeners = () => {
    window.removeEventListener("pointerdown", arm);
    window.removeEventListener("click", arm);
    window.removeEventListener("touchstart", arm);
    window.removeEventListener("keydown", arm);
  };

  loadPromise = load();
  window.addEventListener("pointerdown", arm);
  window.addEventListener("click", arm);
  window.addEventListener("touchstart", arm, { passive: true });
  window.addEventListener("keydown", arm);

  return {
    start() {
      entryRequested = true;
      startPlayback();
    },
    dispose() {
      removeArmListeners();
      stop();
      loadPromise = null;
      if (context) {
        context.close();
      }
    },
    getDebugState() {
      return {
        loaded: Boolean(buffer),
        context: context?.state ?? "unavailable",
        playing,
        volume: TUNNEL_SOUND_VOLUME,
        unlocked,
      };
    },
  };
}
