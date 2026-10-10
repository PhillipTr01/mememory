/*
 * Avatar maker: the parts of an avatar and how it is drawn (SVG).
 * Used by the pages (drawing, editor) and by the server (checking what a
 * user saves), so both always know the same parts.
 */
var AVATAR_PARTS = {
  bg: [
    "#7c5cff", "#5b8def", "#38bdf8", "#3dc1d3", "#22c3a6", "#4cc96b", "#a3d45a", "#ffc93c",
    "#ff9f43", "#ff7a59", "#ff6b6b", "#ff7eb6", "#e056fd", "#c56cf0", "#8e7cc3", "#f6c6a8",
    "#2f3e66", "#4a4a5a",
  ],
  skin: ["#ffe8d6", "#fbe3cc", "#f3d2b3", "#e8b98f", "#d9a577", "#c48a5a", "#a86f43", "#8a5a36", "#5e3b22", "#3d2414"],
  hair: [
    "none", "buzz", "short", "crew", "quiff", "side", "undercut", "messy", "wavy",
    "long", "bob", "curly", "afro", "bun", "ponytail", "pigtails", "mohawk",
  ],
  hairColor: [
    "#0d0b0a", "#1f1b18", "#3b2a20", "#4a2f1d", "#6b3e26", "#8b5a2b", "#b07b3c", "#d9b36c",
    "#f0dca0", "#b8452f", "#e07a3a", "#9a9a9a", "#e6e6e6", "#5b7bd6", "#7a3b8f", "#d65bb4",
    "#3fae8a", "#e05050",
  ],
  beard: ["none", "stubble", "mustache", "goatee", "beard", "chinstrap"],
  eyes: [
    "normal", "big", "happy", "laughing", "wink", "sleepy", "tired", "side", "suspicious",
    "surprised", "angry", "lashes", "crying", "hearts", "stars", "money", "dizzy",
  ],
  mouth: [
    "smile", "wide", "grin", "laugh", "neutral", "open", "wow", "tongue", "smirk",
    "cat", "sad", "nervous", "kiss", "whistle", "fangs", "bucktooth", "drool",
  ],
  top: ["tshirt", "hoodie", "collar", "vneck", "stripes", "suit"],
  shirt: [
    "#3b82f6", "#1e40af", "#06b6d4", "#14b8a6", "#3f9d6b", "#84cc16", "#facc15", "#d4a64a",
    "#f97316", "#e0675a", "#f43f5e", "#be123c", "#ec4899", "#a855f7", "#8b5cf6", "#6b4f3a",
    "#2b2b2b", "#6b7280", "#e8e8e8", "#f5e6c8",
  ],
  accessory: [
    "none", "glasses", "roundglasses", "sunglasses", "dealwithit", "monocle", "eyepatch",
    "scumbag", "cap", "beanie", "bowler", "sombrero", "bandana", "partyhat", "headphones",
    "flower", "mask", "ninja",
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
  bg: "#7c5cff",
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

// Colors can also be picked freely (any #rrggbb)
var AVATAR_COLORS = ["bg", "skin", "hairColor", "shirt"];
var COLOR_REGEX = /^#[0-9a-f]{6}$/;

// Only known parts (anything else is replaced by the default); null = no avatar
function cleanAvatar(config) {
  if (config == null || typeof config !== "object") return null;
  var clean = {};
  Object.keys(AVATAR_PARTS).forEach(function (key) {
    var value = config[key];
    var color = AVATAR_COLORS.indexOf(key) >= 0 && typeof value == "string" && COLOR_REGEX.test(value.toLowerCase());
    if (color) clean[key] = value.toLowerCase();
    else clean[key] = AVATAR_PARTS[key].indexOf(value) >= 0 ? value : AVATAR_DEFAULT[key];
  });
  return clean;
}

// random: a function like Math.random (default)
function randomAvatar(random) {
  random = random || Math.random;
  var config = {};
  Object.keys(AVATAR_PARTS).forEach(function (key) {
    var options = AVATAR_PARTS[key];
    config[key] = options[Math.floor(random() * options.length)];
  });
  // Not everybody has a beard or extras
  if (random() < 0.6) config.beard = "none";
  if (random() < 0.4) config.accessory = "none";
  return config;
}

/*
 * The avatar of users who didn't make their own: random, but always the
 * same for the same name (the name is the seed), so nothing has to be stored.
 */
function nameAvatar(name) {
  var seed = 2166136261;
  for (var i = 0; i < name.length; i++) {
    seed = Math.imul(seed ^ name.charCodeAt(i), 16777619);
  }
  // mulberry32: small random number generator with a seed
  var random = function () {
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return randomAvatar(random);
}

// Stored value for "I want the letter, not a drawing"
var AVATAR_LETTER = "letter";

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

/*
 * Hair has up to three parts, so it always sits right on the head:
 * - back:  behind the head (long hair, buns, tails)
 * - cap:   the hair on the skull - cut to the shape of the head (clip path),
 *          only the hairline has to be drawn
 * - top:   volume above the skull (covered by hats)
 * plus a few darker strands for some texture.
 */
var HAIR = {
  buzz: {
    cap: "M10 0 H90 V42 L74 42 Q72 31 50 29 Q28 31 26 42 L10 42 Z",
    capOpacity: 0.85,
    strands: "M36 25 L37 28 M43 23 L44 26 M50 22 L50 25 M57 23 L56 26 M64 25 L63 28",
  },
  short: {
    cap: "M10 0 H90 V47 L74 47 Q73 34 63 31 Q50 35 37 31 Q27 34 26 47 L10 47 Z",
    top: "M27 36 Q26 19 36 16 Q41 12 48 14 Q54 11 60 14 Q68 14 71 21 Q75 27 73 36 Q66 24 50 24 Q34 24 27 36 Z",
    strands: "M37 20 Q41 25 39 31 M47 17 Q51 24 48 31 M57 18 Q60 25 58 31 M66 23 Q67 27 66 32",
  },
  crew: {
    cap: "M10 0 H90 V45 L74 45 Q72 32 50 30 Q28 32 26 45 L10 45 Z",
    top: "M28 32 Q28 18 50 17 Q72 18 72 32 Q62 26 50 26 Q38 26 28 32 Z",
    strands: "M40 21 L41 26 M50 19 L50 25 M60 21 L59 26",
  },
  quiff: {
    cap: "M10 0 H90 V46 L74 46 Q72 33 60 31 Q48 33 40 31 Q28 33 26 46 L10 46 Z",
    top: "M30 32 Q28 13 46 10 Q60 7 69 16 Q75 22 72 32 Q66 22 54 25 Q44 27 38 29 Q33 30 30 32 Z",
    strands: "M40 14 Q48 18 52 27 M50 11 Q58 15 62 25 M60 12 Q66 17 68 25",
  },
  side: {
    cap: "M10 0 H90 V46 L74 46 Q73 30 62 27 Q48 30 38 37 Q30 41 26 46 L10 46 Z",
    top: "M26 41 Q23 18 48 16 Q72 15 74 34 Q66 23 56 25 Q42 29 26 41 Z",
    strands: "M60 17 Q58 22 60 27 M46 19 Q40 26 34 34 M52 19 Q46 27 40 33",
  },
  undercut: {
    cap: "M10 0 H90 V42 L74 42 Q72 32 50 30 Q28 32 26 42 L10 42 Z",
    capOpacity: 0.4,
    top: "M30 34 Q28 14 50 12 Q72 12 73 28 Q73 32 72 34 Q64 26 50 27 Q38 28 30 34 Z",
    strands: "M40 16 Q48 19 52 25 M52 13 Q60 17 63 24",
  },
  messy: {
    cap: "M10 0 H90 V47 L74 47 Q74 34 64 32 Q58 36 52 32 Q46 36 40 32 Q30 34 26 47 L10 47 Z",
    top: "M26 36 Q22 26 28 22 Q26 14 36 15 Q40 8 48 12 Q54 6 60 12 Q68 9 70 17 Q78 19 74 28 Q76 32 73 36 Q66 26 50 26 Q34 26 26 36 Z",
    strands: "M34 18 L38 26 M44 13 L46 24 M54 11 L52 23 M64 15 L60 25",
  },
  wavy: {
    back: "M24 44 Q22 20 50 18 Q78 20 76 44 Q80 56 74 64 Q76 54 70 48 L30 48 Q24 54 26 64 Q20 56 24 44 Z",
    cap: "M10 0 H90 V56 L73 56 Q73 34 64 32 Q58 28 52 33 Q46 28 40 33 Q30 32 27 56 L10 56 Z",
    top: "M27 34 Q26 19 50 18 Q74 19 73 34 Q64 25 50 25 Q36 25 27 34 Z",
    strands: "M40 22 Q44 27 41 33 M52 20 Q55 26 52 32 M63 23 Q65 28 63 33",
  },
  long: {
    back: "M23 44 Q23 18 50 18 Q77 18 77 44 L79 86 L21 86 Z",
    cap: "M10 0 H90 V66 L74 66 Q73 36 57 28 L50 26 L43 28 Q27 36 26 66 L10 66 Z",
    strands: "M50 21 L50 27 M30 50 Q28 66 30 80 M70 50 Q72 66 70 80",
  },
  bob: {
    back: "M23 46 Q23 18 50 18 Q77 18 77 46 L77 66 Q71 70 65 66 L35 66 Q29 70 23 66 Z",
    cap: "M10 0 H90 V64 L73 64 L73 37 Q62 34 50 35 Q38 34 27 37 L27 64 L10 64 Z",
    strands: "M36 22 L35 35 M44 21 L43 35 M52 21 L52 35 M60 22 L61 35",
  },
  curly: {
    back: [[29, 30, 9], [39, 21, 9], [51, 18, 9], [62, 21, 9], [71, 30, 9], [25, 42, 8], [75, 42, 8]],
    cap: "M10 0 H90 V44 L74 44 Q74 32 66 31 Q62 36 56 31 Q50 36 44 31 Q38 36 34 31 Q26 32 26 44 L10 44 Z",
  },
  afro: {
    back: [[50, 36, 31]],
    cap: "M10 0 H90 V46 L74 46 Q72 31 50 30 Q28 31 26 46 L10 46 Z",
  },
  bun: {
    back: [[50, 14, 10]],
    cap: "M10 0 H90 V42 L74 42 Q71 28 50 27 Q29 28 26 42 L10 42 Z",
    strands: "M40 23 Q45 26 48 29 M60 23 Q55 26 52 29",
  },
  ponytail: {
    back: "M68 30 Q87 34 83 57 Q81 67 74 71 Q78 55 70 43 Z",
    cap: "M10 0 H90 V42 L74 42 Q71 28 50 27 Q29 28 26 42 L10 42 Z",
    strands: "M38 24 Q50 21 66 25",
  },
  pigtails: {
    back: [[21, 42, 9], [79, 42, 9]],
    cap: "M10 0 H90 V44 L74 44 Q72 30 52 28 L50 27 L48 28 Q28 30 26 44 L10 44 Z",
    strands: "M50 20 L50 27",
    bands: true,
  },
  mohawk: {
    cap: "M10 0 H90 V42 L74 42 Q72 32 50 30 Q28 32 26 42 L10 42 Z",
    capOpacity: 0.3,
    top: "M44 31 Q43 10 50 5 Q57 10 56 31 Z",
    strands: "M48 10 L48 28 M52 10 L52 28",
  },
};

var avatarClipId = 0;

// Behind the head (long hair, buns, tails)
function drawHairBack(svg, c, headwear) {
  var hair = HAIR[c.hair];
  if (hair == null || hair.back == null) return;
  // A bun doesn't fit under a hat or a crown
  if (c.hair == "bun" && headwear) return;
  if (typeof hair.back == "string") {
    svgAdd(svg, "path", { d: hair.back, fill: c.hairColor });
    return;
  }
  var circles = hair.back;
  if (headwear == "hat") {
    // Under a hat only the hair at the sides puffs out
    if (c.hair == "afro") circles = [[50, 46, 28]];
    if (c.hair == "curly") circles = circles.filter(function (circle) { return circle[1] >= 30; });
  }
  circles.forEach(function (circle) {
    svgAdd(svg, "circle", { cx: circle[0], cy: circle[1], r: circle[2], fill: c.hairColor });
  });
}

// How high the hair goes (y of the top), so crowns sit on the hair
var HAIR_TOP = {
  none: 21, buzz: 20, short: 13, crew: 16, quiff: 9, side: 15, undercut: 12, messy: 8, wavy: 18,
  long: 18, bob: 18, curly: 10, afro: 6, bun: 20, ponytail: 21, pigtails: 21, mohawk: 20,
};

// On the head; with a hat only the hair below the hat shows,
// with a crown / party hat no mohawk
function drawHairFront(svg, c, hat, crown) {
  var hair = HAIR[c.hair];
  if (hair == null) return;
  // Lighter strands: a shine on the hair (flat, no dark lines)
  var shine = shade(c.hairColor, -38);

  // Cut to the head (a bit bigger than the face, so it covers the edge)
  var id = "mm-hair-" + ++avatarClipId;
  var defs = svgElement("defs");
  var clip = svgElement("clipPath", { id: id });
  clip.appendChild(svgElement("ellipse", { cx: 50, cy: 46, rx: 24.5, ry: 26.5 }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  var group = svgElement("g", { "clip-path": "url(#" + id + ")" });
  group.appendChild(svgElement("path", { d: hair.cap, fill: c.hairColor, opacity: hair.capOpacity || 1 }));
  if (hair.strands && !hat) {
    group.appendChild(svgElement("path", Object.assign(withLine({ d: hair.strands }, shine, 1.6), { opacity: 0.55 })));
  }
  svg.appendChild(group);

  if (hair.top && !hat && !(crown && c.hair == "mohawk")) {
    svgAdd(svg, "path", { d: hair.top, fill: c.hairColor });
    if (hair.strands) svgAdd(svg, "path", Object.assign(withLine({ d: hair.strands }, shine, 1.6), { opacity: 0.55 }));
  }
  if (hair.wrap) {
    svgAdd(svg, "path", { d: hair.wrap, fill: c.hairColor });
    svgAdd(svg, "path", { d: "M30 70 Q50 82 70 70", fill: "none", stroke: shade(c.hairColor, 22), "stroke-width": 1.4, "stroke-linecap": "round", opacity: 0.6 });
  }
  if (hair.bands) {
    svgAdd(svg, "circle", { cx: 26, cy: 39, r: 2.5, fill: "#e0675a" });
    svgAdd(svg, "circle", { cx: 74, cy: 39, r: 2.5, fill: "#e0675a" });
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
  // Ovals with a little shine
  var dot = function (x) {
    svgAdd(svg, "ellipse", { cx: x, cy: y, rx: 2.7, ry: 3.3, fill: INK });
    svgAdd(svg, "circle", { cx: x + 0.9, cy: y - 1.2, r: 0.95, fill: "#fff" });
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
    case "big":
      [left, right].forEach(function (x) {
        svgAdd(svg, "circle", { cx: x, cy: y, r: 4.6, fill: INK });
        svgAdd(svg, "circle", { cx: x + 1.5, cy: y - 1.6, r: 1.6, fill: "#fff" });
      });
      break;
    case "laughing":
      // > <
      svgAdd(svg, "path", withLine({ d: "M" + (left - 3) + " " + (y - 3) + " L" + (left + 3) + " " + y + " L" + (left - 3) + " " + (y + 3) }, INK, 2.2));
      svgAdd(svg, "path", withLine({ d: "M" + (right + 3) + " " + (y - 3) + " L" + (right - 3) + " " + y + " L" + (right + 3) + " " + (y + 3) }, INK, 2.2));
      break;
    case "tired":
      dot(left);
      dot(right);
      [left, right].forEach(function (x) {
        svgAdd(svg, "path", withLine({ d: "M" + (x - 4) + " " + (y - 2.5) + " L" + (x + 4) + " " + (y - 2.5) }, INK, 1.8));
        svgAdd(svg, "path", withLine({ d: "M" + (x - 3) + " " + (y + 4) + " Q" + x + " " + (y + 6) + " " + (x + 3) + " " + (y + 4) }, "rgba(80,40,60,0.45)", 1.4));
      });
      break;
    case "side":
      [left, right].forEach(function (x) {
        svgAdd(svg, "ellipse", { cx: x, cy: y, rx: 4.4, ry: 3.6, fill: "#fff" });
        svgAdd(svg, "circle", { cx: x + 2, cy: y, r: 2.2, fill: INK });
      });
      break;
    case "suspicious":
      [left, right].forEach(function (x) {
        svgAdd(svg, "path", { d: "M" + (x - 4.5) + " " + (y - 0.5) + " L" + (x + 4.5) + " " + (y - 0.5) + " Q" + (x + 4) + " " + (y + 3.5) + " " + x + " " + (y + 3.5) + " Q" + (x - 4) + " " + (y + 3.5) + " " + (x - 4.5) + " " + (y - 0.5) + " Z", fill: "#fff" });
        svgAdd(svg, "circle", { cx: x - 1.5, cy: y + 1.3, r: 1.8, fill: INK });
        svgAdd(svg, "path", withLine({ d: "M" + (x - 5) + " " + (y - 0.5) + " L" + (x + 5) + " " + (y - 0.5) }, INK, 1.8));
      });
      break;
    case "crying":
      [left, right].forEach(function (x) {
        svgAdd(svg, "path", withLine({ d: "M" + (x - 4) + " " + (y + 1) + " Q" + x + " " + (y - 3) + " " + (x + 4) + " " + (y + 1) }));
      });
      svgAdd(svg, "path", { d: "M" + (left - 1) + " " + (y + 3) + " Q" + (left - 3.5) + " " + (y + 8) + " " + (left - 1) + " " + (y + 9) + " Q" + (left + 1.5) + " " + (y + 8) + " " + (left - 1) + " " + (y + 3) + " Z", fill: "#7cc4f0" });
      svgAdd(svg, "path", { d: "M" + (right + 1) + " " + (y + 3) + " Q" + (right - 1.5) + " " + (y + 8) + " " + (right + 1) + " " + (y + 9) + " Q" + (right + 3.5) + " " + (y + 8) + " " + (right + 1) + " " + (y + 3) + " Z", fill: "#7cc4f0" });
      break;
    case "stars":
      [left, right].forEach(function (x) {
        var points = [];
        for (var i = 0; i < 10; i++) {
          var radius = i % 2 == 0 ? 5 : 2.2;
          var angle = (Math.PI / 5) * i - Math.PI / 2;
          points.push((x + radius * Math.cos(angle)).toFixed(2) + "," + (y + radius * Math.sin(angle)).toFixed(2));
        }
        svgAdd(svg, "polygon", { points: points.join(" "), fill: "#f5c542" });
      });
      break;
    case "money":
      // $ $ - for the jackpot fans
      [left, right].forEach(function (x) {
        var text = svgElement("text", { x: x, y: y + 3.5, "text-anchor": "middle", "font-size": 10, "font-weight": 700, "font-family": "Arial, sans-serif", fill: "#3f9d6b" });
        text.textContent = "$";
        svg.appendChild(text);
      });
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

/*
 * Eyebrows in the color of the hair (no hair: a bit darker than the skin).
 * Some eyes bring their own (angry); surprised ones are raised, sad ones sink.
 */
var BROWS = {
  angry: null,
  surprised: "M36 38 Q41 35 46 37.5 M54 37.5 Q59 35 64 38",
  stars: "M36 38.5 Q41 35.5 46 38 M54 38 Q59 35.5 64 38.5",
  crying: "M36 40.5 Q41 38.5 46 39 M54 39 Q59 38.5 64 40.5",
  tired: "M36 41 Q41 40 46 41 M54 41 Q59 40 64 41",
  suspicious: "M36 41.5 Q41 40.5 46 41.5 M54 39.5 Q59 37.5 64 39",
  side: "M36 40 Q41 38 46 40 M54 40 Q59 38 64 40",
};

function drawBrows(svg, c) {
  var path = c.eyes in BROWS ? BROWS[c.eyes] : "M36 40.5 Q41 37.5 46 40 M54 40 Q59 37.5 64 40.5";
  if (path == null) return;
  var color = c.hair == "none" ? shade(c.skin, 70) : shade(c.hairColor, 20);
  svgAdd(svg, "path", withLine({ d: path }, color, 2.2));
}

// A small soft nose, a bit darker than the skin
function drawNose(svg, c) {
  svgAdd(svg, "path", { d: "M47.6 51.4 Q50 47.6 52.4 51.4 Q50 53.2 47.6 51.4 Z", fill: shade(c.skin, 28) });
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
    case "wide":
      svgAdd(svg, "path", withLine({ d: "M39 54 Q50 64 61 54" }, dark));
      break;
    case "wow":
      svgAdd(svg, "ellipse", { cx: 50, cy: 59, rx: 5.5, ry: 6.5, fill: dark });
      svgAdd(svg, "ellipse", { cx: 50, cy: 62.5, rx: 3.2, ry: 2.2, fill: "#e0675a" });
      break;
    case "cat":
      // :3
      svgAdd(svg, "path", withLine({ d: "M43 56 Q46.5 60 50 56 Q53.5 60 57 56" }, dark, 2.2));
      break;
    case "nervous":
      svgAdd(svg, "path", withLine({ d: "M42 58 L45 56 L48 58 L51 56 L54 58 L57 56" }, dark, 2));
      break;
    case "whistle":
      svgAdd(svg, "circle", { cx: 53, cy: 58, r: 2.6, fill: "none", stroke: dark, "stroke-width": 2 });
      svgAdd(svg, "path", withLine({ d: "M62 52 L62 46 L65 45" }, "#6b7280", 1.4));
      svgAdd(svg, "circle", { cx: 61, cy: 52.5, r: 1.4, fill: "#6b7280" });
      break;
    case "fangs":
      svgAdd(svg, "path", withLine({ d: "M42 55 Q50 61 58 55" }, dark));
      svgAdd(svg, "path", { d: "M44.5 56.4 L46 60.5 L47.5 57.5 Z M55.5 56.4 L54 60.5 L52.5 57.5 Z", fill: "#fff" });
      break;
    case "bucktooth":
      svgAdd(svg, "path", withLine({ d: "M43 55 Q50 60 57 55" }, dark));
      svgAdd(svg, "rect", { x: 47.4, y: 57.2, width: 5.2, height: 4.2, rx: 0.8, fill: "#fff", stroke: "#cfcfcf", "stroke-width": 0.5 });
      svgAdd(svg, "path", { d: "M50 57.2 L50 61.4", stroke: "#cfcfcf", "stroke-width": 0.6 });
      break;
    case "drool":
      svgAdd(svg, "path", withLine({ d: "M43 56 Q50 61 57 56" }, dark));
      svgAdd(svg, "path", { d: "M54 58.5 Q53 64 55 65 Q57 64 56 58.2 Z", fill: "#9fd6f5" });
      break;
    case "kiss":
      svgAdd(svg, "path", withLine({ d: "M48 54 Q53 55.5 50 57.5 Q53 59.5 48 61" }, dark, 2.4));
      heart(svg, 60, 58, 2.6, "#e0475a");
      break;
    default:
      // An open smile: the teeth on top, the tongue below
      svgAdd(svg, "path", { d: "M42.5 55.5 Q50 57 57.5 55.5 Q56.5 63.5 50 63.5 Q43.5 63.5 42.5 55.5 Z", fill: dark });
      svgAdd(svg, "path", { d: "M45.5 60.8 Q50 58.6 54.5 60.8 Q52.5 63.5 50 63.5 Q47.5 63.5 45.5 60.8 Z", fill: "#e0675a" });
      svgAdd(svg, "path", { d: "M43 55.6 Q50 57 57 55.6 L56.6 57.6 Q50 58.8 43.4 57.6 Z", fill: "#fff" });
  }
}

/* ----- Extras ----- */

// Hats cover the hair on top of the head
var HATS = ["scumbag", "cap", "beanie", "bowler", "sombrero", "bandana", "ninja"];

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
    case "partyhat": {
      var party = onTop(svg, c, 22, 0.8);
      svgAdd(party, "path", { d: "M38 24 L50 2 L62 24 Z", fill: "#8b5cf6" });
      svgAdd(party, "path", { d: "M42 17 L58 17 M45 11 L55 11", stroke: "#f5d76e", "stroke-width": 2 });
      svgAdd(party, "circle", { cx: 50, cy: 3, r: 3, fill: "#f5d76e" });
      break;
    }
    case "bowler":
      svgAdd(svg, "path", { d: "M31 34 Q30 12 50 12 Q70 12 69 34 Z", fill: "#2b2b33" });
      svgAdd(svg, "rect", { x: 31, y: 28, width: 38, height: 5, fill: "#7a3b3b" });
      svgAdd(svg, "ellipse", { cx: 50, cy: 34.5, rx: 26, ry: 4, fill: "#1f1f26" });
      break;
    case "sombrero":
      svgAdd(svg, "ellipse", { cx: 50, cy: 31, rx: 40, ry: 7.5, fill: "#e8b04a" });
      svgAdd(svg, "path", { d: "M36 31 Q36 8 50 8 Q64 8 64 31 Z", fill: "#f0c35c" });
      svgAdd(svg, "path", { d: "M36.5 25 Q50 28 63.5 25 L64 30 Q50 33 36 30 Z", fill: "#e0475a" });
      svgAdd(svg, "path", { d: "M14 31 Q50 42 86 31", fill: "none", stroke: "#c98a2a", "stroke-width": 1.6 });
      break;
    case "bandana":
      svgAdd(svg, "path", { d: "M26 38 Q26 17 50 16 Q74 17 74 38 Q62 32 50 32 Q38 32 26 38 Z", fill: c.shirt });
      svgAdd(svg, "path", { d: "M73 33 L84 28 L82 37 Z M73 35 L83 42 L76 44 Z", fill: shade(c.shirt, 30) });
      [[38, 23], [50, 21], [62, 23], [44, 28], [56, 28]].forEach(function (p) {
        svgAdd(svg, "circle", { cx: p[0], cy: p[1], r: 1.3, fill: "#fff", opacity: 0.8 });
      });
      break;
    case "mask":
      // A medical mask over the nose and the mouth
      svgAdd(svg, "path", { d: "M29 47 L38 50 M71 47 L62 50 M29 60 L38 62 M71 60 L62 62", stroke: "#e8f1f8", "stroke-width": 1.4 });
      svgAdd(svg, "path", { d: "M37 49 Q50 45 63 49 L63 62 Q50 71 37 62 Z", fill: "#a8d8f0" });
      svgAdd(svg, "path", { d: "M39 53.5 L61 53.5 M39 58 L61 58", stroke: "#86c2e2", "stroke-width": 1.2 });
      break;
    case "ninja": {
      // Wrapped in cloth, only the eyes free
      var id = "mm-ninja-" + ++avatarClipId;
      var defs = svgElement("defs");
      var clip = svgElement("clipPath", { id: id });
      clip.appendChild(svgElement("ellipse", { cx: 50, cy: 46, rx: 24, ry: 26 }));
      defs.appendChild(clip);
      svg.appendChild(defs);
      var cloth = "#2b2b38";
      svgAdd(svg, "circle", { cx: 27, cy: 48, r: 5.5, fill: cloth });
      svgAdd(svg, "circle", { cx: 73, cy: 48, r: 5.5, fill: cloth });
      var wrap = svgElement("g", { "clip-path": "url(#" + id + ")" });
      wrap.appendChild(svgElement("path", { d: "M0 0 H100 V40 Q50 37 0 40 Z M0 52 Q50 55 100 52 V100 H0 Z", fill: cloth }));
      svg.appendChild(wrap);
      svgAdd(svg, "path", { d: "M72 38 L86 32 L83 41 Z M72 40 L84 48 L77 49 Z", fill: "#e0475a" });
      svgAdd(svg, "rect", { x: 26, y: 36.5, width: 48, height: 3.5, rx: 1.5, fill: "#e0475a" });
      break;
    }
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

/*
 * A group for things that sit on the head (drawn for a bald head, base y 24):
 * moved up onto high hair. Very high hair: it sinks in a bit and gets smaller,
 * so it still fits into the picture.
 */
function onTop(svg, c, lowest, smaller) {
  var base = 24 + (HAIR_TOP[c.hair] - 21);
  var scale = 1;
  if (base < lowest) {
    base = lowest;
    scale = smaller;
  }
  var group = svgElement("g", { transform: "translate(50 " + base + ") scale(" + scale + ") translate(-50 -24)" });
  svg.appendChild(group);
  return group;
}

// The whole avatar as an <svg> (square, the round shape comes from the CSS)
function drawAvatar(config) {
  var c = cleanAvatar(config) || AVATAR_DEFAULT;
  // Zoomed in: a big head with the shoulders, easy to see in small avatars
  var svg = svgElement("svg", { viewBox: "10 6 80 80", "aria-hidden": "true", class: "mm-avatar-svg" });
  svgAdd(svg, "rect", { x: 0, y: 0, width: 100, height: 100, fill: c.bg });
  var hat = HATS.indexOf(c.accessory) >= 0;
  var crown = c.accessory == "partyhat";
  if (c.accessory != "ninja") drawHairBack(svg, c, hat ? "hat" : crown ? "crown" : null);
  drawTop(svg, c);
  svgAdd(svg, "rect", { x: 44, y: 62, width: 12, height: 14, fill: shade(c.skin, 25) }); // neck
  // Hoodie: the hood lies around the neck
  if (c.top == "hoodie") svgAdd(svg, "path", { d: "M33 73 Q50 88 67 73 Q50 80 33 73 Z", fill: shade(c.shirt, 35) });
  // Head and ears (a head scarf covers the ears)
  if (!(HAIR[c.hair] && HAIR[c.hair].noEars)) {
    [27, 73].forEach(function (x) {
      svgAdd(svg, "circle", { cx: x, cy: 48, r: 5, fill: c.skin });
      svgAdd(svg, "circle", { cx: x + (x < 50 ? 0.6 : -0.6), cy: 48, r: 2.4, fill: shade(c.skin, 22) });
    });
  }
  svgAdd(svg, "ellipse", { cx: 50, cy: 46, rx: 23, ry: 25, fill: c.skin });
  // Soft cheeks
  svgAdd(svg, "ellipse", { cx: 35.5, cy: 54, rx: 4.6, ry: 3.2, fill: "rgba(240,96,96,0.2)" });
  svgAdd(svg, "ellipse", { cx: 64.5, cy: 54, rx: 4.6, ry: 3.2, fill: "rgba(240,96,96,0.2)" });
  drawBeard(svg, c);
  drawHairFront(svg, c, hat, crown);
  drawBrows(svg, c);
  drawEyes(svg, c);
  drawNose(svg, c);
  drawMouth(svg, c);
  drawMustache(svg, c);
  drawAccessory(svg, c);
  return svg;
}

if (typeof module !== "undefined") {
  module.exports = {
    AVATAR_PARTS: AVATAR_PARTS,
    AVATAR_DEFAULT: AVATAR_DEFAULT,
    AVATAR_COLORS: AVATAR_COLORS,
    AVATAR_LETTER: AVATAR_LETTER,
    cleanAvatar: cleanAvatar,
    nameAvatar: nameAvatar,
  };
}
