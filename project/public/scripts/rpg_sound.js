/*
 * The sounds of the dungeon: made on the spot (Web Audio) - no files. sfx(name, option) plays one; the button
 * with data-sound mutes them all (remembered on this device).
 */
(function () {
  var MUTE_KEY = "rpgMute";
  var muted = false;
  try {
    muted = localStorage.getItem(MUTE_KEY) == "1";
  } catch (error) {}
  var ctx = null;
  var master = null;
  var noiseBuffer = null;

  // (the browser lets a page play sound only after a click: made then) - a soft compressor glues it all together
  function audio() {
    if (ctx) return ctx;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    var squeeze = ctx.createDynamicsCompressor();
    squeeze.threshold.value = -18;
    squeeze.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(squeeze).connect(ctx.destination);
    // (one second of noise, used by every whoosh and impact)
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }
  document.addEventListener("pointerdown", function () {
    var c = audio();
    if (c && c.state == "suspended") c.resume();
  });

  // An envelope: up fast, down over the length
  function envelope(c, at, attack, length, volume) {
    var gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    return gain;
  }

  // A tone: {from, to, length, type, volume, delay, attack, filter (a lowpass)}
  function tone(o) {
    var c = audio();
    if (!c || muted) return;
    var at = c.currentTime + (o.delay || 0);
    var osc = c.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.from, at);
    if (o.to && o.to != o.from) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.length * 0.9);
    var gain = envelope(c, at, o.attack || 0.005, o.length, o.volume || 0.3);
    var node = osc;
    if (o.filter) {
      var lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = o.filter;
      node = node.connect(lp);
    }
    node.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + o.length + 0.05);
  }

  // Noise through a filter that sweeps: {length, type, from, to, q, volume, delay, attack}
  function noise(o) {
    var c = audio();
    if (!c || muted) return;
    var at = c.currentTime + (o.delay || 0);
    var source = c.createBufferSource();
    source.buffer = noiseBuffer;
    var filter = c.createBiquadFilter();
    filter.type = o.type || "bandpass";
    filter.Q.value = o.q || 1;
    filter.frequency.setValueAtTime(o.from, at);
    if (o.to && o.to != o.from) filter.frequency.exponentialRampToValueAtTime(o.to, at + o.length);
    var gain = envelope(c, at, o.attack || 0.004, o.length, o.volume || 0.3);
    source.connect(filter).connect(gain).connect(master);
    source.start(at, Math.random() * 0.5);
    source.stop(at + o.length + 0.05);
  }

  var CHORD = { common: [523], rare: [523, 659], epic: [523, 659, 784], legendary: [523, 659, 784, 1047], mythic: [523, 659, 784, 1047, 1319] };

  var SOUNDS = {
    // a card off the hand: a quick paper swish
    card: function () {
      noise({ length: 0.13, type: "bandpass", from: 1800, to: 4200, q: 0.8, volume: 0.22, attack: 0.02 });
    },
    // a blade landing: a dull body thump under a short crack
    hit: function () {
      tone({ from: 140, to: 55, length: 0.16, type: "sine", volume: 0.55 });
      noise({ length: 0.09, type: "lowpass", from: 2600, to: 400, volume: 0.45 });
      noise({ length: 0.03, type: "highpass", from: 3000, volume: 0.15 });
    },
    // a critical hit: heavier, with a bright ring
    crit: function () {
      tone({ from: 120, to: 40, length: 0.22, type: "sine", volume: 0.7 });
      noise({ length: 0.14, type: "lowpass", from: 3500, to: 300, volume: 0.55 });
      tone({ from: 1760, to: 1700, length: 0.3, type: "triangle", volume: 0.08, delay: 0.02 });
    },
    // poison or a burn ticking
    dot: function () {
      noise({ length: 0.12, type: "bandpass", from: 500, to: 250, q: 4, volume: 0.25 });
    },
    // a dodge: air
    miss: function () {
      noise({ length: 0.22, type: "bandpass", from: 700, to: 2600, q: 1.2, volume: 0.22, attack: 0.04 });
    },
    // a shield up: a short metal clang
    block: function () {
      noise({ length: 0.05, type: "highpass", from: 2500, volume: 0.25 });
      tone({ from: 660, length: 0.28, type: "triangle", volume: 0.12 });
      tone({ from: 990, length: 0.2, type: "triangle", volume: 0.07 });
      tone({ from: 1385, length: 0.14, type: "sine", volume: 0.04 });
    },
    // healing: a soft rising shimmer
    heal: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone({ from: f, length: 0.5, type: "sine", volume: 0.09, delay: i * 0.05, attack: 0.03 });
      });
    },
    // a hero down: a low fall
    down: function () {
      tone({ from: 180, to: 60, length: 0.6, type: "triangle", volume: 0.25, filter: 600 });
      noise({ length: 0.3, type: "lowpass", from: 800, to: 120, volume: 0.25 });
    },
    // the turn starts: a low soft bell
    turn: function () {
      tone({ from: 294, length: 0.7, type: "sine", volume: 0.12, attack: 0.01 });
      tone({ from: 441, length: 0.5, type: "sine", volume: 0.05 });
    },
    // a fight won: a short bright fanfare
    victory: function () {
      [392, 523, 659, 784].forEach(function (f, i) {
        tone({ from: f, length: 0.45, type: "sawtooth", volume: 0.08, delay: i * 0.1, filter: 2200, attack: 0.02 });
      });
      tone({ from: 1047, length: 0.8, type: "triangle", volume: 0.07, delay: 0.42, attack: 0.02 });
    },
    // the party falls: a dark falling chord
    defeat: function () {
      [220, 185, 147, 110].forEach(function (f, i) {
        tone({ from: f, to: f * 0.97, length: 0.7, type: "sawtooth", volume: 0.08, delay: i * 0.18, filter: 900, attack: 0.03 });
      });
    },
    // a pack card turned: a flick - a chime the rarer it is
    flip: function (rarity) {
      noise({ length: 0.08, type: "bandpass", from: 2500, to: 5000, volume: 0.18 });
      if (rarity == "common") return;
      (CHORD[rarity] || []).forEach(function (f, i) {
        tone({ from: f, length: 0.6, type: "sine", volume: 0.08, delay: 0.05 + i * 0.07, attack: 0.02 });
      });
    },
    // a pack torn open
    burst: function () {
      noise({ length: 0.35, type: "bandpass", from: 600, to: 3000, q: 0.7, volume: 0.35, attack: 0.02 });
      tone({ from: 220, to: 660, length: 0.3, type: "triangle", volume: 0.1 });
    },
    // coins
    coins: function () {
      [1976, 2637, 2349].forEach(function (f, i) {
        tone({ from: f, length: 0.18, type: "triangle", volume: 0.06, delay: i * 0.06 });
      });
    },
  };

  window.sfx = function (name, option) {
    if (muted || !SOUNDS[name]) return;
    try {
      SOUNDS[name](option);
    } catch (error) {}
  };

  // The mute button
  function paint(button) {
    button.innerText = muted ? "🔇" : "🔊";
    button.title = muted ? "Sound off" : "Sound on";
    button.setAttribute("aria-label", button.title);
  }
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-sound]").forEach(function (button) {
      paint(button);
      button.addEventListener("click", function () {
        muted = !muted;
        try {
          localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
        } catch (error) {}
        document.querySelectorAll("[data-sound]").forEach(paint);
        if (!muted) window.sfx("coins");
      });
    });
  });
})();
