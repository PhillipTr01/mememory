const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { BOOT_ID } = require("../game/version");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const HTML_DIR = path.join(__dirname, "..", "html");

/*
 * Browsers keep CSS/JS files in their cache. After an update they could
 * mix new HTML with old styles and scripts (broken layout, errors).
 * Every /static link in the HTML pages gets "?v=<hash of the file>", so a
 * changed file always has a new URL and is downloaded again.
 */
function fileVersion(relativePath) {
  try {
    const content = fs.readFileSync(path.join(PUBLIC_DIR, relativePath));
    return crypto.createHash("md5").update(content).digest("hex").slice(0, 10);
  } catch (error) {
    return null;
  }
}

function addVersions(html) {
  return html.replace(/(href|src)="\/static\/([^"?#]+)"/g, (match, attribute, file) => {
    const version = fileVersion(file);
    return version ? `${attribute}="/static/${file}?v=${version}"` : match;
  });
}

const cache = new Map();

function render(file) {
  // In development the files change all the time -> no caching
  if (process.env.NODE_ENV === "production" && cache.has(file)) {
    return cache.get(file);
  }
  const html = addVersions(fs.readFileSync(path.join(HTML_DIR, file), "utf8")).replace(
    /<head>/i,
    `<head>\n    <meta name="app-version" content="${BOOT_ID}">`,
  );
  cache.set(file, html);
  return html;
}

// Express handler that sends a page with versioned asset links;
// extraHead(req): optional HTML for the end of <head> (made per request)
function page(file, extraHead) {
  return (req, res, next) => {
    try {
      res.set("Cache-Control", "no-cache");
      const html = render(file);
      const extra = extraHead ? extraHead(req) : "";
      res.type("html").send(extra ? html.replace(/<\/head>/i, extra + "\n</head>") : html);
    } catch (error) {
      next(error);
    }
  };
}

// Static files: always ask the server whether the cached copy is still current (cheap 304)
function staticHeaders(res) {
  res.setHeader("Cache-Control", "no-cache");
}

module.exports = { page, addVersions, staticHeaders };
