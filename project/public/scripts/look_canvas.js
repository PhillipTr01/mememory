/*
 * Performance for the avatar looks of the shop (frames, animations, backgrounds - looks.css): many of them are
 * animated SVG images (SMIL). The browser draws such an image anew for every avatar that shows it, every frame - a
 * chat full of one player's messages, the shop, a table: 30 avatars of one look keep the main thread busy.
 *
 * Here an animated layer that two or more avatars show is drawn only once per frame (into a master canvas, about 30
 * times a second) and every avatar that shows it copies that picture (a canvas in place of the layer - cheap). A look
 * only one avatar shows stays as it is (nothing to share - the shop: every item once). The layer keeps all it has: its
 * place, size, mask, filter and CSS animations (they are copied to the canvas); only its background image moves into
 * the canvas. Nothing changes to the eye.
 *
 * LookCanvas.track(avatar) - after its looks are put on (casino_looks.js), once it is in the page
 * LookCanvas.untrack(avatar) - its looks come off
 * Avatars out of sight (look-idle - casino_looks.js) are not copied to, masters nobody sees are not drawn.
 */
(function () {
  var FPS = 30;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  // The layers a look can draw on: [selector of the element in the avatar (null: the avatar), pseudo element, class
  // on the avatar that takes the background image off the original]
  var LAYERS = [
    [null, "::before", "lkc-b"],
    [null, "::after", "lkc-a"],
    [".look-fx", "::before", "lkc-fb"],
    [".look-fx", "::after", "lkc-fa"],
    [".look-bg", null, "lkc-g"],
    [".look-bg", "::before", "lkc-gb"],
    [".look-bg", "::after", "lkc-ga"],
  ];
  // What the canvas copies from the layer (computed values)
  var COPY = ["position", "top", "left", "width", "height", "zIndex", "transform", "transformOrigin", "filter", "opacity", "borderRadius", "mixBlendMode", "animationName", "animationDuration", "animationTimingFunction", "animationIterationCount", "animationDirection", "animationDelay", "animationFillMode", "maskImage", "maskSize", "maskPosition", "maskRepeat", "webkitMaskImage", "webkitMaskSize", "webkitMaskPosition", "webkitMaskRepeat", "rotate", "translate", "scale"];

  var masters = new Map(); // key -> {images: [{img, size}], color, w, h, canvas, ctx, users: Set}
  var waiting = new Map(); // key -> the one layer that shows it so far (not drawn by a canvas yet): {avatar, host, pseudo, flag}
  var tracked = new Set(); // avatars with canvases
  var running = false;
  var last = 0;

  function supported() {
    var c = document.createElement("canvas");
    return !!(c.getContext && c.getContext("2d"));
  }
  if (!supported()) {
    window.LookCanvas = { track: function () {}, untrack: function () {} };
    return;
  }

  // The background layers of a computed style -> [{url, size}] (top first) - null: not all of them are images
  function layersOf(cs) {
    var image = cs.backgroundImage;
    if (!image || image == "none" || image.indexOf("animate") < 0) return null;
    var urls = [];
    var re = /url\("((?:[^"\\]|\\.)*)"\)|(none)|([a-z-]+-gradient\()/g;
    var m;
    while ((m = re.exec(image))) {
      if (m[3]) return null; // a gradient: left as it is
      if (m[1]) urls.push(m[1].replace(/\\(.)/g, "$1"));
    }
    if (!urls.length) return null;
    var sizes = cs.backgroundSize.split(",").map((s) => s.trim());
    return urls.map((url, i) => ({ url: url, size: sizes[i % sizes.length] || "auto" }));
  }

  function masterFor(layers, color, w, h) {
    var key = layers.map((l) => l.size + "|" + l.url).join("||") + "|" + color + "|" + w + "x" + h; // (as describe)
    var master = masters.get(key);
    if (master) return master;
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    master = {
      key: key,
      images: layers.map((l) => {
        var img = new Image();
        img.decoding = "async";
        img.src = l.url;
        return { img: img, size: l.size };
      }),
      color: color,
      w: w,
      h: h,
      canvas: canvas,
      ctx: canvas.getContext("2d"),
      users: new Set(),
    };
    masters.set(key, master);
    return master;
  }

  // One frame of a master: its images drawn bottom to top (sizes: 100% 100% / cover / contain / auto)
  function drawMaster(master) {
    var ctx = master.ctx;
    var W = master.w;
    var H = master.h;
    ctx.clearRect(0, 0, W, H);
    if (master.color && master.color != "rgba(0, 0, 0, 0)") {
      ctx.fillStyle = master.color;
      ctx.fillRect(0, 0, W, H);
    }
    for (var i = master.images.length - 1; i >= 0; i--) {
      var layer = master.images[i];
      var img = layer.img;
      if (!img.complete || !img.naturalWidth) continue;
      var iw = img.naturalWidth;
      var ih = img.naturalHeight;
      var dw = W;
      var dh = H;
      if (layer.size == "cover" || layer.size == "contain") {
        var k = layer.size == "cover" ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
        dw = iw * k;
        dh = ih * k;
      } else if (layer.size == "auto" || layer.size == "auto auto") {
        dw = iw * DPR;
        dh = ih * DPR;
      }
      try {
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      } catch (e) {}
    }
  }

  // A layer of an avatar -> what it shows ({key, layers, color, w, h, cs}) - null: nothing animated
  function describe(host, pseudo) {
    var cs = getComputedStyle(host, pseudo);
    if (pseudo && (cs.content == "none" || cs.display == "none")) return null;
    var layers = layersOf(cs);
    if (!layers) return null;
    var w = Math.max(1, Math.round(parseFloat(cs.width) * DPR));
    var h = Math.max(1, Math.round(parseFloat(cs.height) * DPR));
    if (!(w > 1 && h > 1)) return null;
    return { key: layers.map((l) => l.size + "|" + l.url).join("||") + "|" + cs.backgroundColor + "|" + w + "x" + h, layers: layers, color: cs.backgroundColor, w: w, h: h, cs: cs };
  }

  function makeCanvas(avatar, host, pseudo, flag, info) {
    var cs = getComputedStyle(host, pseudo);
    var w = info.w;
    var h = info.h;
    var master = masterFor(info.layers, info.color, w, h);
    var canvas = document.createElement("canvas");
    canvas.className = "lkc-layer";
    canvas.width = w;
    canvas.height = h;
    canvas.setAttribute("aria-hidden", "true");
    var style = canvas.style;
    if (pseudo) {
      COPY.forEach((p) => {
        if (cs[p] != null && cs[p] !== "") style[p] = cs[p];
      });
      style.pointerEvents = "none";
      // (the pseudo element's place: before the content or after it)
      if (pseudo == "::before") host.insertBefore(canvas, host.firstChild);
      else host.appendChild(canvas);
    } else {
      // (the element itself - .look-bg: the canvas fills it, under what is in it)
      style.cssText = "position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;pointer-events:none";
      host.insertBefore(canvas, host.firstChild);
    }
    avatar.classList.add(flag);
    var user = { canvas: canvas, ctx: canvas.getContext("2d"), avatar: avatar, master: master };
    master.users.add(user);
    return user;
  }

  function addUser(avatar, user) {
    (avatar._lkc = avatar._lkc || []).push(user);
    tracked.add(avatar);
    start();
  }

  function track(avatar) {
    if (!avatar || !avatar.isConnected) return;
    untrack(avatar);
    avatar._lkc = avatar._lkc || [];
    avatar._lkcWait = [];
    LAYERS.forEach(([sel, pseudo, flag]) => {
      var host = sel ? avatar.querySelector(":scope > " + sel) : avatar;
      if (!host) return;
      var info = describe(host, pseudo);
      if (!info) return;
      var shown = masters.has(info.key);
      var first = waiting.get(info.key);
      if (first && !first.avatar.isConnected) {
        waiting.delete(info.key);
        first = null;
      }
      if (!shown && !first) {
        // (the only one so far: stays as it is until a second one shows it)
        waiting.set(info.key, { avatar: avatar, host: host, pseudo: pseudo, flag: flag, info: info });
        avatar._lkcWait.push(info.key);
        return;
      }
      if (first) {
        waiting.delete(info.key);
        first.avatar._lkcWait = (first.avatar._lkcWait || []).filter((k) => k != info.key);
        var firstUser = makeCanvas(first.avatar, first.host, first.pseudo, first.flag, first.info);
        if (firstUser) addUser(first.avatar, firstUser);
      }
      var user = makeCanvas(avatar, host, pseudo, flag, info);
      if (user) addUser(avatar, user);
    });
    // (tracked: already seen - not described again)
    avatar._lkcSeen = true;
  }

  function untrack(avatar) {
    if (!avatar) return;
    (avatar._lkcWait || []).forEach((key) => {
      if (waiting.get(key) && waiting.get(key).avatar == avatar) waiting.delete(key);
    });
    delete avatar._lkcWait;
    delete avatar._lkcSeen;
    if (!avatar._lkc) return;
    avatar._lkc.forEach((user) => {
      user.master.users.delete(user);
      if (!user.master.users.size) masters.delete(user.master.key);
      user.canvas.remove();
    });
    LAYERS.forEach((l) => avatar.classList.remove(l[2]));
    delete avatar._lkc;
    tracked.delete(avatar);
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!tracked.size) {
      running = false;
      return;
    }
    requestAnimationFrame(tick);
    if (now - last < 1000 / FPS - 2) return;
    last = now;
    // (gone from the page: forgotten)
    tracked.forEach((avatar) => {
      if (!avatar.isConnected) untrack(avatar);
    });
    masters.forEach((master) => {
      var visible = [];
      master.users.forEach((user) => {
        if (!user.avatar.classList.contains("look-idle")) visible.push(user);
      });
      if (!visible.length) return;
      drawMaster(master);
      visible.forEach((user) => {
        user.ctx.clearRect(0, 0, user.canvas.width, user.canvas.height);
        user.ctx.drawImage(master.canvas, 0, 0);
      });
    });
  }

  window.LookCanvas = { track: track, untrack: untrack };
})();
