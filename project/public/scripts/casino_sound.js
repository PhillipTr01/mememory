/*
 * The sounds of the casino: all made right here with Web Audio (no files) - one soft, warm voice
 * for every game: kalimba plucks and glassy bells in D major pentatonic for wins, felt and wood for
 * chips, cards and dice, everything through a gentle low-pass and a small room. Quiet by default.
 *
 * casinoSound.play(name, options) - a sound from SOUNDS (nothing before the first click / tap of the
 * page: the browser allows audio only then). The speaker in the top bar: volume and mute, kept in
 * this browser (localStorage).
 */
(function () {
  var KEY = "casinoSound";
  var DEFAULT_VOLUME = 0.35;
  var settings = { volume: DEFAULT_VOLUME, muted: false };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && typeof saved.volume == "number") settings.volume = Math.min(1, Math.max(0, saved.volume));
    if (saved && typeof saved.muted == "boolean") settings.muted = saved.muted;
  } catch (error) {
    // (no storage: the defaults)
  }

  function store() {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch (error) {
      // (no storage: only for this page)
    }
  }

  var ctx = null;
  var master = null; // volume
  var bus = null; // everything goes in here: low-pass -> dry + room -> master
  var unlocked = false;

  // The room: a short, soft reverb from decaying noise
  function room(context) {
    var length = Math.floor(context.sampleRate * 1.1);
    var impulse = context.createBuffer(2, length, context.sampleRate);
    for (var channel = 0; channel < 2; channel++) {
      var data = impulse.getChannelData(channel);
      for (var i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
    }
    var convolver = context.createConvolver();
    convolver.buffer = impulse;
    return convolver;
  }

  function setup() {
    if (ctx) return ctx;
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    ctx = new Context();
    master = ctx.createGain();
    master.gain.value = level();
    var soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 7200;
    soften.Q.value = 0.4;
    var squeeze = ctx.createDynamicsCompressor();
    squeeze.threshold.value = -18;
    squeeze.ratio.value = 4;
    squeeze.attack.value = 0.004;
    squeeze.release.value = 0.2;
    bus = ctx.createGain();
    bus.gain.value = 0.9;
    var wet = ctx.createGain();
    wet.gain.value = 0.18;
    var reverb = room(ctx);
    bus.connect(soften);
    soften.connect(squeeze);
    squeeze.connect(master);
    soften.connect(reverb);
    reverb.connect(wet);
    wet.connect(master);
    master.connect(ctx.destination);
    noiseBuffer = makeNoise();
    return ctx;
  }

  // (the slider is linear - the ear isn't: a curve, so half way sounds about half as loud)
  function level() {
    return settings.muted ? 0 : Math.pow(settings.volume, 1.8) * 0.9;
  }

  function unlock() {
    if (!setup()) return;
    if (ctx.state == "suspended") ctx.resume();
    unlocked = true;
  }
  ["pointerdown", "keydown", "touchstart"].forEach((type) => window.addEventListener(type, unlock, { capture: true, passive: true }));

  /* ---------- The instruments ---------- */

  var noiseBuffer = null;
  function makeNoise() {
    var buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // An envelope on a gain: a quick rise, an exponential fall
  function envelope(gain, when, peak, attack, decay) {
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }

  function tone(freq, when, options) {
    var o = options || {};
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(freq, when);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, when + (o.glide || o.decay || 0.2));
    if (o.detune) osc.detune.value = o.detune;
    envelope(gain, when, o.gain == null ? 0.2 : o.gain, o.attack || 0.004, o.decay || 0.3);
    osc.connect(gain);
    gain.connect(o.out || bus);
    osc.start(when);
    osc.stop(when + (o.attack || 0.004) + (o.decay || 0.3) + 0.05);
  }

  // Kalimba: the note, a fast bright overtone, a tiny knock
  function pluck(freq, when, gain) {
    var g = gain == null ? 0.22 : gain;
    tone(freq, when, { gain: g, decay: 0.55 });
    tone(freq * 4.02, when, { gain: g * 0.18, decay: 0.08 });
    tone(freq * 2, when, { gain: g * 0.12, decay: 0.2, type: "triangle" });
  }

  // Glass bell: partials that ring out at their own pace
  function bell(freq, when, gain) {
    var g = gain == null ? 0.16 : gain;
    tone(freq, when, { gain: g, decay: 1.4 });
    tone(freq * 2.76, when, { gain: g * 0.35, decay: 0.7 });
    tone(freq * 5.4, when, { gain: g * 0.14, decay: 0.3 });
  }

  // A burst of filtered noise: felt, paper, wood, dice
  function noise(when, options) {
    var o = options || {};
    var source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.playbackRate.value = o.rate || 1;
    var filter = ctx.createBiquadFilter();
    filter.type = o.filter || "bandpass";
    filter.frequency.setValueAtTime(o.freq || 2000, when);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, when + (o.decay || 0.1));
    filter.Q.value = o.q == null ? 1.2 : o.q;
    var gain = ctx.createGain();
    envelope(gain, when, o.gain == null ? 0.25 : o.gain, o.attack || 0.002, o.decay || 0.08);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    var offset = Math.random() * 0.5;
    source.start(when, offset);
    source.stop(when + (o.attack || 0.002) + (o.decay || 0.08) + 0.05);
  }

  // A soft low thud (a reel that stops, a chest that lands)
  function thud(freq, when, gain) {
    tone(freq, when, { gain: gain == null ? 0.3 : gain, to: freq * 0.55, glide: 0.12, decay: 0.18 });
    noise(when, { freq: 400, q: 0.7, gain: 0.08, decay: 0.05, filter: "lowpass" });
  }

  // A wood block (ticks of a wheel, a reel)
  function wood(freq, when, gain) {
    tone(freq, when, { gain: gain == null ? 0.1 : gain, decay: 0.035, type: "triangle" });
    noise(when, { freq: freq * 2, q: 6, gain: (gain == null ? 0.1 : gain) * 0.5, decay: 0.02 });
  }

  // D major pentatonic, from D4 up
  var SCALE = [293.66, 329.63, 369.99, 440.0, 493.88];
  function note(step) {
    var octave = Math.floor(step / 5);
    return SCALE[((step % 5) + 5) % 5] * Math.pow(2, octave);
  }

  function arpeggio(steps, when, gap, gain, voice) {
    steps.forEach((step, i) => (voice || pluck)(note(step), when + i * gap, gain));
  }

  /* ---------- The sounds ---------- */

  var SOUNDS = {
    // UI
    click: (t) => {
      tone(1350, t, { gain: 0.045, decay: 0.03, type: "triangle" });
    },
    open: (t) => {
      pluck(note(7), t, 0.08);
      pluck(note(9), t + 0.05, 0.06);
    },
    error: (t) => {
      tone(233, t, { gain: 0.12, decay: 0.12, type: "triangle" });
      tone(196, t + 0.11, { gain: 0.12, decay: 0.2, type: "triangle" });
    },
    message: (t) => {
      pluck(note(8), t, 0.07);
      pluck(note(10), t + 0.07, 0.06);
    },
    notice: (t) => {
      bell(note(9), t, 0.08);
      bell(note(12), t + 0.12, 0.07);
    },
    tick: (t) => wood(1600, t, 0.07),
    tickHigh: (t) => wood(2300, t, 0.1),
    // Coins and chips
    chip: (t) => {
      noise(t, { freq: 3200, q: 3, gain: 0.22, decay: 0.03 });
      noise(t + 0.045, { freq: 2600, q: 3, gain: 0.16, decay: 0.04 });
      tone(1900, t, { gain: 0.03, decay: 0.05, type: "triangle" });
    },
    chips: (t) => {
      for (var i = 0; i < 6; i++) noise(t + i * 0.035 + Math.random() * 0.015, { freq: 2400 + Math.random() * 1400, q: 3, gain: 0.14, decay: 0.035 });
    },
    coin: (t) => {
      bell(note(14), t, 0.09);
      bell(note(17), t + 0.07, 0.09);
    },
    coins: (t) => {
      for (var i = 0; i < 7; i++) bell(note(12 + ((i * 3) % 7)), t + i * 0.06, 0.05);
    },
    // Cards
    deal: (t) => noise(t, { freq: 1800, to: 5200, q: 0.9, gain: 0.2, decay: 0.11, filter: "bandpass" }),
    flip: (t) => {
      noise(t, { freq: 2600, to: 4200, q: 1, gain: 0.14, decay: 0.07 });
      wood(1400, t + 0.06, 0.05);
    },
    knock: (t) => {
      thud(180, t, 0.18);
      thud(170, t + 0.13, 0.16);
    },
    fold: (t) => noise(t, { freq: 1200, to: 500, q: 0.8, gain: 0.14, decay: 0.16, filter: "lowpass" }),
    // Dice
    shake: (t, o) => {
      var length = (o && o.duration) || 0.7;
      for (var at = 0; at < length; at += 0.045 + Math.random() * 0.04) noise(t + at, { freq: 2200 + Math.random() * 1800, q: 4, gain: 0.07 + Math.random() * 0.05, decay: 0.025 });
    },
    dice: (t) => {
      [0, 0.07, 0.12].forEach((at, i) => {
        noise(t + at, { freq: 1700 + i * 300, q: 3, gain: 0.2, decay: 0.04 });
        thud(240 - i * 20, t + at, 0.08);
      });
    },
    // Wheels, reels
    whoosh: (t) => noise(t, { freq: 500, to: 2600, q: 0.7, gain: 0.12, decay: 0.45, attack: 0.12, filter: "bandpass" }),
    // A wheel / ball that slows down: ticks further and further apart (options.duration: seconds)
    wheel: (t, o) => {
      var length = (o && o.duration) || 4;
      var at = 0;
      var gap = 0.05;
      while (at < length) {
        wood(1500 + Math.random() * 200, t + at, 0.06);
        at += gap;
        gap = 0.05 + Math.pow(at / length, 2.2) * 0.38;
      }
    },
    reelStop: (t, o) => {
      thud(150 + ((o && o.index) || 0) * 12, t, 0.12);
      wood(1200 + ((o && o.index) || 0) * 80, t, 0.06);
    },
    spin: (t) => {
      noise(t, { freq: 900, to: 2400, q: 0.8, gain: 0.1, decay: 0.25, attack: 0.03 });
      pluck(note(5), t, 0.05);
    },
    // Results
    lose: (t) => {
      pluck(note(2), t, 0.08);
      pluck(note(0), t + 0.16, 0.07);
    },
    win: (t) => arpeggio([5, 7, 9], t, 0.08, 0.16),
    bigWin: (t) => {
      arpeggio([5, 7, 9, 10, 12], t, 0.075, 0.17);
      [10, 12, 14].forEach((step) => bell(note(step), t + 0.42, 0.08));
      SOUNDS.coins(t + 0.5);
    },
    jackpot: (t) => {
      arpeggio([0, 2, 4, 5, 7, 9, 10, 12, 14], t, 0.07, 0.15);
      [5, 9, 12, 15].forEach((step, i) => bell(note(step), t + 0.65 + i * 0.02, 0.09));
      SOUNDS.coins(t + 0.7);
      SOUNDS.coins(t + 1.1);
    },
    fanfare: (t) => {
      arpeggio([5, 7, 9, 12], t, 0.11, 0.17, bell);
      [12, 14, 17].forEach((step) => bell(note(step), t + 0.5, 0.1));
    },
    bonus: (t) => {
      noise(t, { freq: 600, to: 6000, q: 0.6, gain: 0.08, decay: 0.6, attack: 0.2 });
      arpeggio([7, 9, 10, 12, 14, 15, 17], t + 0.15, 0.06, 0.12, bell);
    },
    streak: (t) => {
      SOUNDS.coins(t);
      arpeggio([5, 7, 9, 12], t + 0.15, 0.09, 0.15);
    },
    chest: (t) => {
      noise(t, { freq: 300, to: 900, q: 5, gain: 0.1, decay: 0.35, attack: 0.05 });
      thud(120, t + 0.32, 0.22);
      arpeggio([10, 12, 14, 17], t + 0.4, 0.05, 0.1, bell);
    },
    reveal: (t, o) => {
      // (rarity 0 common .. 4 legendary: the higher, the brighter)
      var rarity = (o && o.rarity) || 0;
      pluck(note(5 + rarity * 2), t, 0.12);
      if (rarity >= 2) bell(note(9 + rarity * 2), t + 0.08, 0.06 + rarity * 0.015);
      if (rarity >= 3) SOUNDS.coins(t + 0.12);
    },
    countdown: (t) => wood(1900, t, 0.08),
    go: (t) => {
      pluck(note(9), t, 0.12);
      pluck(note(12), t + 0.08, 0.12);
    },
    rain: (t) => {
      for (var i = 0; i < 14; i++) bell(note(10 + Math.floor(Math.random() * 8)), t + i * 0.09 + Math.random() * 0.04, 0.035);
    },
    gift: (t) => {
      SOUNDS.coin(t);
      arpeggio([7, 9, 12], t + 0.1, 0.08, 0.12);
    },
  };

  // (the same sound many times at the same moment - a page that renders twice: once; at other moments - cards dealt one after the other: each)
  var planned = {};
  function play(name, options) {
    if (settings.muted || settings.volume <= 0 || !unlocked || !SOUNDS[name]) return;
    if (document.hidden) return;
    if (!setup() || ctx.state != "running") return;
    var at = ctx.currentTime + 0.01 + Math.max(0, (options && options.delay) || 0);
    var times = (planned[name] || []).filter((time) => time > ctx.currentTime - 0.1);
    if (times.some((time) => Math.abs(time - at) < 0.025)) return;
    times.push(at);
    planned[name] = times.slice(-24);
    try {
      SOUNDS[name](at, options || {});
    } catch (error) {
      // (a sound never breaks a game)
    }
  }

  function setVolume(value) {
    settings.volume = Math.min(1, Math.max(0, value));
    if (settings.volume > 0) settings.muted = false;
    if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.03);
    store();
    renderButton();
  }

  function setMuted(muted) {
    settings.muted = muted;
    if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.03);
    store();
    renderButton();
  }

  /* ---------- The speaker in the top bar: mute, volume ---------- */

  var button = null;
  var panel = null;

  function icon() {
    var off = settings.muted || settings.volume == 0;
    var waves = off ? '<path d="M16 9l5 6M21 9l-5 6"/>' : settings.volume < 0.5 ? '<path d="M16 9.5a3.5 3.5 0 0 1 0 5"/>' : '<path d="M16 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" stroke="none"/>' + waves + "</svg>";
  }

  function renderButton() {
    if (!button) return;
    button.innerHTML = icon();
    var off = settings.muted || settings.volume == 0;
    button.classList.toggle("off", off);
    button.title = off ? "Sound off" : "Sound " + Math.round(settings.volume * 100) + "%";
    if (panel) {
      panel.querySelector("input").value = Math.round(settings.volume * 100);
      panel.querySelector(".nav-sound-value").innerText = off ? "Off" : Math.round(settings.volume * 100) + "%";
      panel.querySelector(".nav-sound-mute").innerText = settings.muted ? "Sound on" : "Mute";
    }
  }

  function closePanel() {
    if (!panel) return;
    panel.remove();
    panel = null;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
  }

  function outside(event) {
    if (panel && !panel.contains(event.target) && !button.contains(event.target)) closePanel();
  }

  function openPanel() {
    panel = document.createElement("div");
    panel.className = "nav-sound-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Sound");
    panel.innerHTML =
      '<div class="nav-sound-head"><span>Sound</span><span class="nav-sound-value"></span></div>' +
      '<input type="range" min="0" max="100" step="1" aria-label="Volume">' +
      '<div class="nav-sound-actions"><button type="button" class="mm-btn mm-btn-sm nav-sound-mute"></button><button type="button" class="mm-btn mm-btn-sm nav-sound-test">▶ Try</button></div>';
    var slider = panel.querySelector("input");
    slider.addEventListener("input", () => setVolume(Number(slider.value) / 100));
    slider.addEventListener("change", () => play("win"));
    panel.querySelector(".nav-sound-mute").addEventListener("click", () => setMuted(!settings.muted));
    panel.querySelector(".nav-sound-test").addEventListener("click", () => {
      if (settings.muted) setMuted(false);
      play("bigWin");
    });
    button.parentElement.appendChild(panel);
    button.setAttribute("aria-expanded", "true");
    renderButton();
    document.addEventListener("pointerdown", outside, true);
  }

  function addButton() {
    var anchor = document.getElementById("navBonus");
    if (!anchor || button) return;
    var wrap = document.createElement("span");
    wrap.className = "nav-sound";
    button = document.createElement("button");
    button.type = "button";
    button.className = "nav-sound-btn";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Sound");
    button.addEventListener("click", () => (panel ? closePanel() : openPanel()));
    wrap.appendChild(button);
    anchor.parentElement.insertBefore(wrap, anchor);
    document.addEventListener("keydown", (event) => event.key == "Escape" && closePanel());
    renderButton();
  }

  // Every button of the page: a very soft click (not the ones that make their own sound)
  document.addEventListener(
    "click",
    (event) => {
      var target = event.target.closest("button, .mm-btn, [role=tab], [role=radio]");
      if (!target || target.disabled || target.closest("[data-sound=off]") || target.dataset.sound == "off") return;
      play("click");
    },
    true,
  );

  if (document.readyState == "loading") document.addEventListener("DOMContentLoaded", addButton);
  else addButton();

  // (for checks: how loud each sound is on its own - {name: peak})
  function levels() {
    var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var saved = { ctx: ctx, bus: bus, noiseBuffer: noiseBuffer };
    var result = {};
    var jobs = Object.keys(SOUNDS).map((name) => {
      ctx = new Offline(1, 44100 * 3, 44100);
      bus = ctx.createGain();
      bus.connect(ctx.destination);
      noiseBuffer = makeNoise();
      SOUNDS[name](0.01, { duration: 1.5, index: 1, rarity: 2 });
      var job = ctx.startRendering().then((buffer) => {
        var data = buffer.getChannelData(0);
        var peak = 0;
        for (var i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        result[name] = Math.round(peak * 100) / 100;
      });
      return job;
    });
    ctx = saved.ctx;
    bus = saved.bus;
    noiseBuffer = saved.noiseBuffer;
    return Promise.all(jobs).then(() => result);
  }

  // (for checks: every sound once, silently into a buffer - the names that failed)
  function check() {
    var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) return Promise.resolve(["no offline audio"]);
    var failed = [];
    var saved = { ctx: ctx, bus: bus, noiseBuffer: noiseBuffer };
    ctx = new Offline(1, 44100 * 3, 44100);
    bus = ctx.createGain();
    bus.connect(ctx.destination);
    noiseBuffer = makeNoise();
    Object.keys(SOUNDS).forEach((name) => {
      try {
        SOUNDS[name](0.01, { duration: 1, index: 1, rarity: 4 });
      } catch (error) {
        failed.push(name + ": " + error.message);
      }
    });
    var rendering = ctx.startRendering();
    ctx = saved.ctx;
    bus = saved.bus;
    noiseBuffer = saved.noiseBuffer;
    return rendering.then((buffer) => {
      var peak = 0;
      var data = buffer.getChannelData(0);
      for (var i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      return { failed: failed, peak: peak };
    });
  }

  window.casinoSound = { play: play, setVolume: setVolume, setMuted: setMuted, check: check, levels: levels, settings: () => ({ volume: settings.volume, muted: settings.muted }), SOUNDS: Object.keys(SOUNDS) };
})();
