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

  // (the browser lets a page play sound only after a click: made then)
  function audio() {
    if (ctx) return ctx;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return ctx;
  }
  document.addEventListener("pointerdown", function () {
    var c = audio();
    if (c && c.state == "suspended") c.resume();
  });

  // A tone: frequency (from - to), length, wave, loudness, delay
  function tone(from, to, length, type, volume, delay) {
    var c = audio();
    if (!c || muted) return;
    var at = c.currentTime + (delay || 0);
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(from, at);
    if (to && to != from) osc.frequency.exponentialRampToValueAtTime(to, at + length);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume || 0.5, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  // A burst of noise through a filter: a whoosh, a thud, a flick
  function noise(length, frequency, volume, delay, type) {
    var c = audio();
    if (!c || muted) return;
    var at = c.currentTime + (delay || 0);
    var buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * length)), c.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    var source = c.createBufferSource();
    source.buffer = buffer;
    var filter = c.createBiquadFilter();
    filter.type = type || "bandpass";
    filter.frequency.value = frequency;
    var gain = c.createGain();
    gain.gain.value = volume || 0.4;
    source.connect(filter).connect(gain).connect(master);
    source.start(at);
  }

  var CHORD = { common: [523], rare: [523, 659], epic: [523, 659, 784], legendary: [523, 659, 784, 1047], mythic: [523, 659, 784, 1047, 1319] };

  var SOUNDS = {
    card: function () {
      noise(0.12, 2400, 0.25);
    },
    hit: function () {
      tone(170, 55, 0.18, "sine", 0.7);
      noise(0.08, 900, 0.3);
    },
    crit: function () {
      tone(240, 60, 0.25, "sine", 0.8);
      noise(0.1, 1400, 0.4);
      tone(1300, 900, 0.25, "triangle", 0.15, 0.03);
    },
    dot: function () {
      tone(300, 200, 0.12, "sine", 0.25);
    },
    miss: function () {
      noise(0.18, 3500, 0.2, 0, "highpass");
    },
    block: function () {
      tone(850, 820, 0.18, "triangle", 0.3);
      tone(1270, 1250, 0.14, "triangle", 0.15);
    },
    heal: function () {
      [660, 880, 1100].forEach(function (f, i) {
        tone(f, f, 0.22, "sine", 0.22, i * 0.06);
      });
    },
    down: function () {
      tone(220, 70, 0.5, "sawtooth", 0.18);
    },
    turn: function () {
      tone(392, 392, 0.4, "sine", 0.18);
      tone(588, 588, 0.4, "sine", 0.1);
    },
    victory: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone(f, f, 0.35, "triangle", 0.3, i * 0.11);
      });
    },
    defeat: function () {
      [392, 330, 262, 196].forEach(function (f, i) {
        tone(f, f * 0.98, 0.4, "sawtooth", 0.15, i * 0.16);
      });
    },
    flip: function (rarity) {
      noise(0.07, 3000, 0.25);
      (CHORD[rarity] || []).forEach(function (f, i) {
        if (rarity == "common") return;
        tone(f, f, 0.5, "sine", 0.18, 0.05 + i * 0.07);
      });
    },
    burst: function () {
      noise(0.45, 600, 0.5, 0, "lowpass");
      tone(200, 600, 0.3, "triangle", 0.2);
    },
    coins: function () {
      [1568, 2093, 1760].forEach(function (f, i) {
        tone(f, f, 0.12, "square", 0.06, i * 0.05);
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
