/*
 * Avatar maker: the parts of an avatar and how it is drawn (SVG).
 * Used by the pages (drawing, editor) and by the server (checking what a
 * user saves), so both always know the same parts.
 */
var AVATAR_PARTS = {
  bg: ["#3b4a6b", "#5b3b6b", "#6b3b45", "#3b6b5a", "#6b5a3b", "#2f3e46", "#4a4a4a", "#1f5f8b"],
  skin: ["#f3d2b3", "#e8b98f", "#d39b6a", "#b07b4f", "#8a5a36", "#5e3b22"],
  hair: ["none", "short", "long", "curly", "mohawk", "bun", "spiky", "side"],
  hairColor: ["#1f1b18", "#4a2f1d", "#8b5a2b", "#d9b36c", "#b8452f", "#c9c9c9", "#5b7bd6", "#d65bb4"],
  eyes: ["normal", "happy", "wink", "sleepy", "surprised", "angry"],
  mouth: ["smile", "grin", "neutral", "open", "tongue", "smirk"],
  shirt: ["#3b82f6", "#3f9d6b", "#e0675a", "#d4a64a", "#8b5cf6", "#2b2b2b", "#e8e8e8", "#ec4899"],
  accessory: ["none", "glasses", "sunglasses", "dealwithit", "scumbag", "crown", "headphones", "cap"],
};

// Labels for the editor
var AVATAR_LABELS = {
  bg: "Background",
  skin: "Skin",
  hair: "Hair",
  hairColor: "Hair color",
  eyes: "Eyes",
  mouth: "Mouth",
  shirt: "Shirt",
  accessory: "Extras",
};

var AVATAR_DEFAULT = {
  bg: "#3b4a6b",
  skin: "#e8b98f",
  hair: "short",
  hairColor: "#4a2f1d",
  eyes: "normal",
  mouth: "smile",
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
  return config;
}

/* ---------- Drawing (only in the browser) ---------- */

var SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes) {
  var element = document.createElementNS(SVG_NS, name);
  Object.keys(attributes || {}).forEach(function (key) {
    element.setAttribute(key, attributes[key]);
  });
  return element;
}

// A slightly darker color for shadows and lines
function shade(color, amount) {
  var value = parseInt(color.slice(1), 16);
  var r = Math.max(0, ((value >> 16) & 255) - amount);
  var g = Math.max(0, ((value >> 8) & 255) - amount);
  var b = Math.max(0, (value & 255) - amount);
  return "rgb(" + r + "," + g + "," + b + ")";
}

function drawHairBack(svg, c) {
  var color = c.hairColor;
  if (c.hair == "long") svg.appendChild(svgElement("path", { d: "M24 44 Q24 18 50 18 Q76 18 76 44 L78 82 L22 82 Z", fill: color }));
  if (c.hair == "bun") svg.appendChild(svgElement("circle", { cx: 50, cy: 15, r: 10, fill: color }));
  if (c.hair == "curly") {
    [[30, 30], [40, 22], [52, 19], [63, 23], [71, 32], [26, 42], [74, 43]].forEach(function (p) {
      svg.appendChild(svgElement("circle", { cx: p[0], cy: p[1], r: 9, fill: color }));
    });
  }
}

function drawHairFront(svg, c) {
  var color = c.hairColor;
  var paths = {
    short: "M27 42 Q26 20 50 20 Q74 20 73 42 Q66 30 50 30 Q34 30 27 42 Z",
    long: "M27 44 Q26 20 50 20 Q74 20 73 44 Q70 30 58 28 Q50 34 40 29 Q30 32 27 44 Z",
    bun: "M27 40 Q27 22 50 22 Q73 22 73 40 Q64 30 50 30 Q36 30 27 40 Z",
    side: "M26 44 Q24 20 50 19 Q76 19 74 38 Q60 26 30 44 Z",
    spiky: "M27 40 L30 22 L37 30 L42 16 L48 28 L54 14 L58 28 L65 18 L67 30 L74 24 L73 40 Q62 30 50 30 Q38 30 27 40 Z",
  };
  if (paths[c.hair]) svg.appendChild(svgElement("path", { d: paths[c.hair], fill: color }));
  if (c.hair == "mohawk") svg.appendChild(svgElement("path", { d: "M44 30 Q44 8 50 6 Q56 8 56 30 Z", fill: color }));
}

function drawEyes(svg, c) {
  var dark = "#1b1b1b";
  var line = { stroke: dark, "stroke-width": 2.6, "stroke-linecap": "round", fill: "none" };
  var left = 41;
  var right = 59;
  var y = 46;
  var eye = function (x) {
    svg.appendChild(svgElement("circle", { cx: x, cy: y, r: 2.8, fill: dark }));
  };
  switch (c.eyes) {
    case "happy":
      [left, right].forEach(function (x) {
        svg.appendChild(svgElement("path", Object.assign({ d: "M" + (x - 4) + " " + (y + 1) + " Q" + x + " " + (y - 4) + " " + (x + 4) + " " + (y + 1) }, line)));
      });
      break;
    case "wink":
      eye(left);
      svg.appendChild(svgElement("path", Object.assign({ d: "M" + (right - 4) + " " + y + " L" + (right + 4) + " " + y }, line)));
      break;
    case "sleepy":
      [left, right].forEach(function (x) {
        svg.appendChild(svgElement("path", Object.assign({ d: "M" + (x - 4) + " " + y + " Q" + x + " " + (y + 3) + " " + (x + 4) + " " + y }, line)));
      });
      break;
    case "surprised":
      [left, right].forEach(function (x) {
        svg.appendChild(svgElement("circle", { cx: x, cy: y, r: 4.2, fill: "#fff", stroke: dark, "stroke-width": 1.5 }));
        svg.appendChild(svgElement("circle", { cx: x, cy: y, r: 2, fill: dark }));
      });
      break;
    case "angry":
      eye(left);
      eye(right);
      svg.appendChild(svgElement("path", Object.assign({ d: "M36 39 L45 42 M64 39 L55 42" }, line)));
      break;
    default:
      eye(left);
      eye(right);
  }
}

function drawMouth(svg, c) {
  var dark = "#3a1d1d";
  var line = { stroke: dark, "stroke-width": 2.6, "stroke-linecap": "round", fill: "none" };
  switch (c.mouth) {
    case "grin":
      svg.appendChild(svgElement("path", { d: "M41 55 Q50 66 59 55 Z", fill: dark }));
      svg.appendChild(svgElement("path", { d: "M43 56 L57 56 L56 58 L44 58 Z", fill: "#fff" }));
      break;
    case "neutral":
      svg.appendChild(svgElement("path", Object.assign({ d: "M44 58 L56 58" }, line)));
      break;
    case "open":
      svg.appendChild(svgElement("ellipse", { cx: 50, cy: 58, rx: 4, ry: 5, fill: dark }));
      break;
    case "tongue":
      svg.appendChild(svgElement("path", Object.assign({ d: "M43 56 Q50 62 57 56" }, line)));
      svg.appendChild(svgElement("path", { d: "M48 59 Q48 65 51.5 65 Q55 65 54 59 Z", fill: "#e0675a" }));
      break;
    case "smirk":
      svg.appendChild(svgElement("path", Object.assign({ d: "M44 58 Q52 60 57 54" }, line)));
      break;
    default:
      svg.appendChild(svgElement("path", Object.assign({ d: "M43 55 Q50 62 57 55" }, line)));
  }
}

function drawAccessory(svg, c) {
  var dark = "#1b1b1b";
  switch (c.accessory) {
    case "glasses":
      [41, 59].forEach(function (x) {
        svg.appendChild(svgElement("circle", { cx: x, cy: 46, r: 6.5, fill: "rgba(255,255,255,0.15)", stroke: dark, "stroke-width": 2 }));
      });
      svg.appendChild(svgElement("path", { d: "M47.5 46 L52.5 46", stroke: dark, "stroke-width": 2 }));
      break;
    case "sunglasses":
      svg.appendChild(svgElement("path", { d: "M32 42 L68 42 L66 50 Q61 54 55 50 L53 45 L47 45 L45 50 Q39 54 34 50 Z", fill: dark }));
      break;
    case "dealwithit": {
      // Pixel sunglasses from the meme
      var pixels = [
        [32, 42, 36, 3], [34, 45, 9, 3], [52, 45, 9, 3], [36, 48, 5, 3], [54, 48, 5, 3],
      ];
      pixels.forEach(function (p) {
        svg.appendChild(svgElement("rect", { x: p[0], y: p[1], width: p[2], height: p[3], fill: dark }));
      });
      svg.appendChild(svgElement("rect", { x: 36, y: 45, width: 3, height: 3, fill: "#fff" }));
      svg.appendChild(svgElement("rect", { x: 54, y: 45, width: 3, height: 3, fill: "#fff" }));
      break;
    }
    case "scumbag":
      // The brown cap from the MemeMory logo
      svg.appendChild(svgElement("path", { d: "M25 38 Q26 14 50 13 Q74 14 75 38 Z", fill: "#7a4a2a" }));
      svg.appendChild(svgElement("path", { d: "M30 26 L70 26 M27 33 L73 33 M38 16 L36 37 M50 13 L50 37 M62 16 L64 37", stroke: "#5a3420", "stroke-width": 1.6 }));
      svg.appendChild(svgElement("path", { d: "M70 34 Q84 34 84 40 L70 40 Z", fill: "#7a4a2a" }));
      break;
    case "crown":
      svg.appendChild(svgElement("path", { d: "M34 24 L36 10 L43 18 L50 6 L57 18 L64 10 L66 24 Z", fill: "#e8c050", stroke: "#b8902a", "stroke-width": 1.2 }));
      break;
    case "headphones":
      svg.appendChild(svgElement("path", { d: "M25 46 Q25 16 50 16 Q75 16 75 46", fill: "none", stroke: dark, "stroke-width": 4 }));
      svg.appendChild(svgElement("rect", { x: 20, y: 40, width: 9, height: 15, rx: 3, fill: "#e0675a" }));
      svg.appendChild(svgElement("rect", { x: 71, y: 40, width: 9, height: 15, rx: 3, fill: "#e0675a" }));
      break;
    case "cap":
      svg.appendChild(svgElement("path", { d: "M26 36 Q27 16 50 16 Q73 16 74 36 Z", fill: c.shirt }));
      svg.appendChild(svgElement("path", { d: "M50 34 L82 34 Q84 39 78 40 L50 40 Z", fill: shade(c.shirt, 40) }));
      break;
  }
}

// The whole avatar as an <svg> (square, the round shape comes from the CSS)
function drawAvatar(config) {
  var c = cleanAvatar(config) || AVATAR_DEFAULT;
  // Zoomed in a bit, so the face is easy to see in small avatars
  var svg = svgElement("svg", { viewBox: "8 4 84 84", "aria-hidden": "true", class: "mm-avatar-svg" });
  svg.appendChild(svgElement("rect", { x: 0, y: 0, width: 100, height: 100, fill: c.bg }));
  drawHairBack(svg, c);
  // Shirt and neck
  svg.appendChild(svgElement("path", { d: "M18 100 Q20 76 50 74 Q80 76 82 100 Z", fill: c.shirt }));
  svg.appendChild(svgElement("rect", { x: 44, y: 62, width: 12, height: 14, fill: shade(c.skin, 25) }));
  // Head and ears
  svg.appendChild(svgElement("circle", { cx: 27, cy: 48, r: 5, fill: c.skin }));
  svg.appendChild(svgElement("circle", { cx: 73, cy: 48, r: 5, fill: c.skin }));
  svg.appendChild(svgElement("ellipse", { cx: 50, cy: 46, rx: 23, ry: 25, fill: c.skin }));
  // Cheeks
  svg.appendChild(svgElement("circle", { cx: 36, cy: 54, r: 3.5, fill: "rgba(224,103,90,0.22)" }));
  svg.appendChild(svgElement("circle", { cx: 64, cy: 54, r: 3.5, fill: "rgba(224,103,90,0.22)" }));
  if (["scumbag", "cap"].indexOf(c.accessory) < 0 || c.hair == "long") drawHairFront(svg, c);
  drawEyes(svg, c);
  drawMouth(svg, c);
  drawAccessory(svg, c);
  return svg;
}

if (typeof module !== "undefined") {
  module.exports = { AVATAR_PARTS: AVATAR_PARTS, AVATAR_DEFAULT: AVATAR_DEFAULT, cleanAvatar: cleanAvatar };
}
