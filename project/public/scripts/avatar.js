/*
 * Avatar maker: the parts of an avatar and how it is drawn (SVG).
 * Used by the pages (drawing, editor) and by the server (checking what a
 * user saves), so both always know the same parts.
 */
var AVATAR_PARTS = {
  bg: [
    "#3b4a6b", "#5b3b6b", "#6b3b45", "#3b6b5a", "#6b5a3b", "#2f3e46",
    "#4a4a4a", "#1f5f8b", "#8b3a62", "#2e6b3a", "#7a5230", "#1f2a44",
  ],
  skin: ["#fbe3cc", "#f3d2b3", "#e8b98f", "#d9a577", "#c48a5a", "#a86f43", "#8a5a36", "#5e3b22"],
  hair: [
    "none", "short", "buzz", "side", "undercut", "wavy", "long", "bob",
    "curly", "afro", "bun", "ponytail", "pigtails", "mohawk",
  ],
  hairColor: [
    "#1f1b18", "#4a2f1d", "#8b5a2b", "#b07b3c", "#d9b36c", "#f0dca0",
    "#b8452f", "#e07a3a", "#c9c9c9", "#5b7bd6", "#d65bb4", "#3fae8a",
  ],
  beard: ["none", "stubble", "mustache", "goatee", "beard", "chinstrap"],
  eyes: ["normal", "happy", "wink", "sleepy", "surprised", "angry", "lashes", "hearts", "dizzy"],
  mouth: ["smile", "grin", "laugh", "neutral", "open", "tongue", "smirk", "sad", "kiss"],
  top: ["tshirt", "hoodie", "collar", "vneck", "stripes", "suit"],
  shirt: [
    "#3b82f6", "#1e40af", "#06b6d4", "#3f9d6b", "#84cc16", "#d4a64a",
    "#f97316", "#e0675a", "#be123c", "#ec4899", "#8b5cf6", "#6b4f3a",
    "#2b2b2b", "#6b7280", "#e8e8e8", "#f5e6c8",
  ],
  accessory: [
    "none", "glasses", "roundglasses", "sunglasses", "dealwithit", "monocle", "eyepatch",
    "scumbag", "cap", "beanie", "partyhat", "crown", "halo", "headphones", "flower",
  ],
};

// Labels for the editor (in this order)
var AVATAR_LABELS = {
  bg: "Background",
  skin: "Skin",
  hair: "Hair",
  hairColor: "Hair color",
  beard: "Beard",
  eyes: "Eyes",
  mouth: "Mouth",
  top: "Clothes",
  shirt: "Clothes color",
  accessory: "Extras",
};

var AVATAR_DEFAULT = {
  bg: "#3b4a6b",
  skin: "#e8b98f",
  hair: "short",
  hairColor: "#4a2f1d",
  beard: "none",
  eyes: "normal",
  mouth: "smile",
  top: "tshirt",
  shirt: "#3b82f6",
  accessory: "none",
};

// Only known parts (anything else is replaced by the default); null = no avatar
function cleanAvatar(config) {
  if (config == null || typeof config !== "object") return null;
  var clean = {};
  Object.keys(AVATAR_PARTS).forEach(function (key) {
    clean[key] = AVATAR_PARTS[key].indexOf(config[key]) >= 0 ? config[key] : AVATAR_DEFAULT[key];
  });
  return clean;
}

function randomAvatar() {
  var config = {};
  Object.keys(AVATAR_PARTS).forEach(function (key) {
    var options = AVATAR_PARTS[key];
    config[key] = options[Math.floor(Math.random() * options.length)];
  });
  // Not everybody has a beard or extras
  if (Math.random() < 0.6) config.beard = "none";
  if (Math.random() < 0.4) config.accessory = "none";
  return config;
}

/* ---------- Drawing (only in the browser) ---------- */

var SVG_NS = "http://www.w3.org/2000/svg";
var INK = "#1b1b1b";

function svgElement(name, attributes) {
  var element = document.createElementNS(SVG_NS, name);
  Object.keys(attributes || {}).forEach(function (key) {
    element.setAttribute(key, attributes[key]);
  });
  return element;
}

function svgAdd(svg, name, attributes) {
  svg.appendChild(svgElement(name, attributes));
}

// Darker (amount > 0) or lighter (amount < 0) version of a color
function shade(color, amount) {
  var value = parseInt(color.slice(1), 16);
  var channel = function (shift) {
    return Math.min(255, Math.max(0, ((value >> shift) & 255) - amount));
  };
  return "rgb(" + channel(16) + "," + channel(8) + "," + channel(0) + ")";
}

// A line (no fill) on top of the given attributes
function withLine(attributes, color, width) {
  return Object.assign(attributes, {
    stroke: color || INK,
    "stroke-width": width || 2.6,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    fill: "none",
  });
}

/* ----- Hair ----- */

// Behind the head (long hair, buns, ...)
function drawHairBack(svg, c) {
  var color = c.hairColor;
  switch (c.hair) {
    case "long":
      svgAdd(svg, "path", { d: "M24 44 Q24 18 50 18 Q76 18 76 44 L78 84 L22 84 Z", fill: color });
      break;
    case "bob":
      svgAdd(svg, "path", { d: "M24 46 Q24 18 50 18 Q76 18 76 46 L76 66 Q70 70 64 66 L36 66 Q30 70 24 66 Z", fill: color });
      break;
    case "afro":
      svgAdd(svg, "circle", { cx: 50, cy: 36, r: 31, fill: color });
      break;
    case "curly":
      [[30, 30], [40, 22], [52, 19], [63, 23], [71, 32], [26, 42], [74, 43]].forEach(function (p) {
        svgAdd(svg, "circle", { cx: p[0], cy: p[1], r: 9, fill: color });
      });
      break;
    case "bun":
      svgAdd(svg, "circle", { cx: 50, cy: 15, r: 10, fill: color });
      break;
    case "ponytail":
      svgAdd(svg, "path", { d: "M68 30 Q86 34 82 56 Q80 66 74 70 Q78 54 70 42 Z", fill: color });
      break;
    case "pigtails":
      svgAdd(svg, "circle", { cx: 22, cy: 42, r: 9, fill: color });
      svgAdd(svg, "circle", { cx: 78, cy: 42, r: 9, fill: color });
      break;
  }
}

// On top of the head
function drawHairFront(svg, c) {
  var color = c.hairColor;
  var paths = {
    short: "M27 42 Q26 20 50 20 Q74 20 73 42 Q66 30 50 30 Q34 30 27 42 Z",
    buzz: "M28 38 Q29 21 50 21 Q71 21 72 38 Q62 27 50 27 Q38 27 28 38 Z",
    side: "M26 44 Q24 20 50 19 Q76 19 74 38 Q60 26 30 44 Z",
    undercut: "M30 32 Q34 16 54 17 Q74 18 74 34 Q64 24 46 30 Q36 33 30 32 Z",
    wavy: "M27 42 Q25 20 50 19 Q75 20 73 42 Q70 34 64 34 Q60 28 54 33 Q48 27 42 33 Q37 29 32 35 Q29 36 27 42 Z",
    long: "M27 44 Q26 20 50 20 Q74 20 73 44 Q70 30 58 28 Q50 34 40 29 Q30 32 27 44 Z",
    bob: "M27 44 Q26 20 50 20 Q74 20 73 44 L73 36 L27 36 Z",
    curly: "M28 36 Q32 24 42 26 Q46 20 54 24 Q62 21 66 28 Q73 30 72 38 Q62 31 50 31 Q38 31 28 36 Z",
    afro: "M27 40 Q30 26 50 26 Q70 26 73 40 Q62 32 50 32 Q38 32 27 40 Z",
    bun: "M27 40 Q27 22 50 22 Q73 22 73 40 Q64 30 50 30 Q36 30 27 40 Z",
    ponytail: "M27 40 Q27 21 50 21 Q73 21 73 40 Q64 30 50 30 Q36 30 27 40 Z",
    pigtails: "M27 40 Q27 21 50 21 Q73 21 73 40 Q60 26 50 33 Q40 26 27 40 Z",
  };
  if (paths[c.hair]) svgAdd(svg, "path", { d: paths[c.hair], fill: color });
  if (c.hair == "mohawk") svgAdd(svg, "path", { d: "M44 30 Q44 8 50 6 Q56 8 56 30 Z", fill: color });
  if (c.hair == "pigtails") {
    svgAdd(svg, "circle", { cx: 27, cy: 38, r: 2.5, fill: "#e0675a" });
    svgAdd(svg, "circle", { cx: 73, cy: 38, r: 2.5, fill: "#e0675a" });
  }
}

/* ----- Clothes ----- */

function drawTop(svg, c) {
  var color = c.shirt;
  var dark = shade(color, 35);
  var body = "M16 100 Q18 76 50 74 Q82 76 84 100 Z";
  switch (c.top) {
    case "hoodie":
      svgAdd(svg, "path", { d: "M14 100 Q16 72 50 70 Q84 72 86 100 Z", fill: color });
      svgAdd(svg, "path", { d: "M45 80 L44 92 M55 80 L56 92", stroke: shade(color, -60), "stroke-width": 1.6, "stroke-linecap": "round" });
      break;
    case "collar":
      svgAdd(svg, "path", { d: body, fill: color });
      svgAdd(svg, "path", { d: "M40 74 L50 84 L44 88 L36 76 Z M60 74 L50 84 L56 88 L64 76 Z", fill: shade(color, -50) });
      break;
    case "vneck":
      svgAdd(svg, "path", { d: body, fill: color });
      svgAdd(svg, "path", { d: "M42 75 L50 87 L58 75 Z", fill: shade(c.skin, 20) });
      break;
    case "stripes":
      svgAdd(svg, "path", { d: body, fill: color });
      [82, 89, 96].forEach(function (y) {
        svgAdd(svg, "path", { d: "M18 " + y + " L82 " + y, stroke: shade(color, -55), "stroke-width": 3 });
      });
      break;
    case "suit":
      svgAdd(svg, "path", { d: body, fill: color });
      svgAdd(svg, "path", { d: "M42 75 L50 92 L58 75 Z", fill: "#f2f2f2" });
      svgAdd(svg, "path", { d: "M48 80 L50 77 L52 80 L50 92 Z", fill: "#be123c" });
      svgAdd(svg, "path", { d: "M36 76 L46 96 L42 100 M64 76 L54 96 L58 100", fill: "none", stroke: dark, "stroke-width": 1.8 });
      break;
    default:
      svgAdd(svg, "path", { d: body, fill: color });
      svgAdd(svg, "path", { d: "M42 75 Q50 81 58 75", fill: "none", stroke: dark, "stroke-width": 2 });
  }
}

/* ----- Face ----- */

function drawBeard(svg, c) {
  var color = c.hairColor;
  switch (c.beard) {
    case "stubble":
      svgAdd(svg, "path", { d: "M30 54 Q32 72 50 72 Q68 72 70 54 Q62 64 50 64 Q38 64 30 54 Z", fill: color, opacity: 0.25 });
      break;
    case "goatee":
      svgAdd(svg, "path", { d: "M44 63 Q50 74 56 63 Q50 66 44 63 Z", fill: color });
      break;
    case "beard":
      svgAdd(svg, "path", { d: "M27 46 Q28 74 50 74 Q72 74 73 46 Q70 62 60 62 Q50 58 40 62 Q30 62 27 46 Z", fill: color });
      break;
    case "chinstrap":
      svgAdd(svg, "path", { d: "M27 46 Q28 74 50 74 Q72 74 73 46 Q70 68 50 69 Q30 68 27 46 Z", fill: color });
      break;
  }
}

function drawMustache(svg, c) {
  if (["mustache", "beard", "goatee"].indexOf(c.beard) >= 0) {
    svgAdd(svg, "path", { d: "M41 54 Q46 49 50 52 Q54 49 59 54 Q54 53 50 55 Q46 53 41 54 Z", fill: c.hairColor });
  }
}

function heart(svg, x, y, size, color) {
  var s = size;
  svgAdd(svg, "path", {
    d: "M" + x + " " + (y + s) + " L" + (x - s) + " " + y + " A" + s / 2 + " " + s / 2 + " 0 0 1 " + x + " " + (y - s / 2) +
      " A" + s / 2 + " " + s / 2 + " 0 0 1 " + (x + s) + " " + y + " Z",
    fill: color,
  });
}

function drawEyes(svg, c) {
  var left = 41;
  var right = 59;
  var y = 46;
  var dot = function (x) {
    svgAdd(svg, "circle", { cx: x, cy: y, r: 2.8, fill: INK });
  };
  switch (c.eyes) {
    case "happy":
      [left, right].forEach(function (x) {
        svgAdd(svg, "path", withLine({ d: "M" + (x - 4) + " " + (y + 1) + " Q" + x + " " + (y - 4) + " " + (x + 4) + " " + (y + 1) }));
      });
      break;
    case "wink":
      dot(left);
      svgAdd(svg, "path", withLine({ d: "M" + (right - 4) + " " + y + " L" + (right + 4) + " " + y }));
      break;
    case "sleepy":
      [left, right].forEach(function (x) {
        svgAdd(svg, "path", withLine({ d: "M" + (x - 4) + " " + y + " Q" + x + " " + (y + 3) + " " + (x + 4) + " " + y }));
      });
      break;
    case "surprised":
      [left, right].forEach(function (x) {
        svgAdd(svg, "circle", { cx: x, cy: y, r: 4.2, fill: "#fff", stroke: INK, "stroke-width": 1.5 });
        svgAdd(svg, "circle", { cx: x, cy: y, r: 2, fill: INK });
      });
      break;
    case "angry":
      dot(left);
      dot(right);
      svgAdd(svg, "path", withLine({ d: "M36 39 L45 42 M64 39 L55 42" }));
      break;
    case "lashes":
      dot(left);
      dot(right);
      [left, right].forEach(function (x) {
        svgAdd(svg, "path", withLine({
          d: "M" + (x - 3) + " " + (y - 3) + " L" + (x - 5) + " " + (y - 6) +
            " M" + x + " " + (y - 3.5) + " L" + x + " " + (y - 7) +
            " M" + (x + 3) + " " + (y - 3) + " L" + (x + 5) + " " + (y - 6),
        }, INK, 1.4));
      });
      break;
    case "hearts":
      heart(svg, left, y - 1, 4, "#e0475a");
      heart(svg, right, y - 1, 4, "#e0475a");
      break;
    case "dizzy":
      [left, right].forEach(function (x) {
        svgAdd(svg, "path", withLine({
          d: "M" + (x - 3) + " " + (y - 3) + " L" + (x + 3) + " " + (y + 3) + " M" + (x + 3) + " " + (y - 3) + " L" + (x - 3) + " " + (y + 3),
        }, INK, 2.2));
      });
      break;
    default:
      dot(left);
      dot(right);
  }
}

function drawMouth(svg, c) {
  var dark = "#3a1d1d";
  switch (c.mouth) {
    case "grin":
      // Wide smile with a row of teeth inside the mouth
      svgAdd(svg, "path", { d: "M42 55 L58 55 Q56.5 63 50 63 Q43.5 63 42 55 Z", fill: dark });
      svgAdd(svg, "path", { d: "M42.2 55 L57.8 55 L57.3 57.4 L42.7 57.4 Z", fill: "#fff" });
      break;
    case "laugh":
      svgAdd(svg, "path", { d: "M40 54 L60 54 Q59 68 50 68 Q41 68 40 54 Z", fill: dark });
      svgAdd(svg, "path", { d: "M44 64 Q50 60 56 64 Q53 68 50 68 Q47 68 44 64 Z", fill: "#e0675a" });
      svgAdd(svg, "path", { d: "M41 54 L59 54 L58.6 57 L41.4 57 Z", fill: "#fff" });
      break;
    case "neutral":
      svgAdd(svg, "path", withLine({ d: "M44 58 L56 58" }, dark));
      break;
    case "open":
      svgAdd(svg, "ellipse", { cx: 50, cy: 58, rx: 4, ry: 5, fill: dark });
      break;
    case "tongue":
      svgAdd(svg, "path", withLine({ d: "M43 56 Q50 61 57 56" }, dark));
      svgAdd(svg, "path", { d: "M47.5 58.5 Q47.5 65 51 65 Q54.5 65 54.5 58.5 Z", fill: "#e0675a" });
      break;
    case "smirk":
      svgAdd(svg, "path", withLine({ d: "M44 58 Q52 60 57 54" }, dark));
      break;
    case "sad":
      svgAdd(svg, "path", withLine({ d: "M43 61 Q50 54 57 61" }, dark));
      break;
    case "kiss":
      svgAdd(svg, "path", withLine({ d: "M48 54 Q53 55.5 50 57.5 Q53 59.5 48 61" }, dark, 2.4));
      heart(svg, 60, 58, 2.6, "#e0475a");
      break;
    default:
      svgAdd(svg, "path", withLine({ d: "M43 55 Q50 62 57 55" }, dark));
  }
}

/* ----- Extras ----- */

// Hats cover the hair on top of the head
var HATS = ["scumbag", "cap", "beanie"];

function drawAccessory(svg, c) {
  switch (c.accessory) {
    case "glasses":
      [41, 59].forEach(function (x) {
        svgAdd(svg, "rect", { x: x - 7, y: 41, width: 14, height: 10, rx: 3, fill: "rgba(255,255,255,0.15)", stroke: INK, "stroke-width": 2 });
      });
      svgAdd(svg, "path", { d: "M48 45 L52 45", stroke: INK, "stroke-width": 2 });
      break;
    case "roundglasses":
      [41, 59].forEach(function (x) {
        svgAdd(svg, "circle", { cx: x, cy: 46, r: 6.5, fill: "rgba(255,255,255,0.15)", stroke: INK, "stroke-width": 2 });
      });
      svgAdd(svg, "path", { d: "M47.5 46 L52.5 46", stroke: INK, "stroke-width": 2 });
      break;
    case "sunglasses":
      svgAdd(svg, "path", { d: "M32 42 L68 42 L66 50 Q61 54 55 50 L53 45 L47 45 L45 50 Q39 54 34 50 Z", fill: INK });
      break;
    case "dealwithit":
      // Pixel sunglasses from the meme
      [[32, 42, 36, 3], [34, 45, 9, 3], [52, 45, 9, 3], [36, 48, 5, 3], [54, 48, 5, 3]].forEach(function (p) {
        svgAdd(svg, "rect", { x: p[0], y: p[1], width: p[2], height: p[3], fill: INK });
      });
      svgAdd(svg, "rect", { x: 36, y: 45, width: 3, height: 3, fill: "#fff" });
      svgAdd(svg, "rect", { x: 54, y: 45, width: 3, height: 3, fill: "#fff" });
      break;
    case "monocle":
      svgAdd(svg, "circle", { cx: 59, cy: 46, r: 6.5, fill: "rgba(255,255,255,0.15)", stroke: "#d4a64a", "stroke-width": 2 });
      svgAdd(svg, "path", { d: "M65 49 Q68 60 64 70", fill: "none", stroke: "#d4a64a", "stroke-width": 1.2 });
      break;
    case "eyepatch":
      svgAdd(svg, "path", { d: "M27 38 L73 52", stroke: INK, "stroke-width": 1.8 });
      svgAdd(svg, "ellipse", { cx: 59, cy: 46, rx: 6.5, ry: 5.5, fill: INK });
      break;
    case "scumbag":
      // The brown cap from the MemeMory logo
      svgAdd(svg, "path", { d: "M25 38 Q26 14 50 13 Q74 14 75 38 Z", fill: "#7a4a2a" });
      svgAdd(svg, "path", { d: "M30 26 L70 26 M27 33 L73 33 M38 16 L36 37 M50 13 L50 37 M62 16 L64 37", stroke: "#5a3420", "stroke-width": 1.6 });
      svgAdd(svg, "path", { d: "M70 34 Q84 34 84 40 L70 40 Z", fill: "#7a4a2a" });
      break;
    case "cap":
      svgAdd(svg, "path", { d: "M26 36 Q27 16 50 16 Q73 16 74 36 Z", fill: c.shirt });
      svgAdd(svg, "path", { d: "M50 34 L82 34 Q84 39 78 40 L50 40 Z", fill: shade(c.shirt, 40) });
      break;
    case "beanie":
      svgAdd(svg, "path", { d: "M26 38 Q26 14 50 14 Q74 14 74 38 Z", fill: c.shirt });
      svgAdd(svg, "rect", { x: 25, y: 33, width: 50, height: 7, rx: 3, fill: shade(c.shirt, 35) });
      svgAdd(svg, "circle", { cx: 50, cy: 12, r: 4, fill: shade(c.shirt, -40) });
      break;
    case "partyhat":
      svgAdd(svg, "path", { d: "M38 24 L50 2 L62 24 Z", fill: "#8b5cf6" });
      svgAdd(svg, "path", { d: "M42 17 L58 17 M45 11 L55 11", stroke: "#f5d76e", "stroke-width": 2 });
      svgAdd(svg, "circle", { cx: 50, cy: 3, r: 3, fill: "#f5d76e" });
      break;
    case "crown":
      svgAdd(svg, "path", { d: "M34 24 L36 10 L43 18 L50 6 L57 18 L64 10 L66 24 Z", fill: "#e8c050", stroke: "#b8902a", "stroke-width": 1.2 });
      break;
    case "halo":
      svgAdd(svg, "ellipse", { cx: 50, cy: 11, rx: 15, ry: 4, fill: "none", stroke: "#f5d76e", "stroke-width": 2.5 });
      break;
    case "headphones":
      svgAdd(svg, "path", { d: "M25 46 Q25 16 50 16 Q75 16 75 46", fill: "none", stroke: INK, "stroke-width": 4 });
      svgAdd(svg, "rect", { x: 20, y: 40, width: 9, height: 15, rx: 3, fill: "#e0675a" });
      svgAdd(svg, "rect", { x: 71, y: 40, width: 9, height: 15, rx: 3, fill: "#e0675a" });
      break;
    case "flower":
      [[0, -4], [4, 0], [0, 4], [-4, 0]].forEach(function (p) {
        svgAdd(svg, "circle", { cx: 68 + p[0], cy: 26 + p[1], r: 3.4, fill: "#ec4899" });
      });
      svgAdd(svg, "circle", { cx: 68, cy: 26, r: 2.4, fill: "#f5d76e" });
      break;
  }
}

// The whole avatar as an <svg> (square, the round shape comes from the CSS)
function drawAvatar(config) {
  var c = cleanAvatar(config) || AVATAR_DEFAULT;
  // Zoomed in a bit, so the face is easy to see in small avatars
  var svg = svgElement("svg", { viewBox: "8 4 84 84", "aria-hidden": "true", class: "mm-avatar-svg" });
  svgAdd(svg, "rect", { x: 0, y: 0, width: 100, height: 100, fill: c.bg });
  drawHairBack(svg, c);
  drawTop(svg, c);
  svgAdd(svg, "rect", { x: 44, y: 62, width: 12, height: 14, fill: shade(c.skin, 25) }); // neck
  // Hoodie: the hood lies around the neck
  if (c.top == "hoodie") svgAdd(svg, "path", { d: "M33 73 Q50 88 67 73 Q50 80 33 73 Z", fill: shade(c.shirt, 35) });
  // Head and ears
  svgAdd(svg, "circle", { cx: 27, cy: 48, r: 5, fill: c.skin });
  svgAdd(svg, "circle", { cx: 73, cy: 48, r: 5, fill: c.skin });
  svgAdd(svg, "ellipse", { cx: 50, cy: 46, rx: 23, ry: 25, fill: c.skin });
  // Cheeks
  svgAdd(svg, "circle", { cx: 36, cy: 54, r: 3.5, fill: "rgba(224,103,90,0.22)" });
  svgAdd(svg, "circle", { cx: 64, cy: 54, r: 3.5, fill: "rgba(224,103,90,0.22)" });
  drawBeard(svg, c);
  if (HATS.indexOf(c.accessory) < 0 || c.hair == "long" || c.hair == "bob") drawHairFront(svg, c);
  drawEyes(svg, c);
  drawMouth(svg, c);
  drawMustache(svg, c);
  drawAccessory(svg, c);
  return svg;
}

if (typeof module !== "undefined") {
  module.exports = { AVATAR_PARTS: AVATAR_PARTS, AVATAR_DEFAULT: AVATAR_DEFAULT, cleanAvatar: cleanAvatar };
}
