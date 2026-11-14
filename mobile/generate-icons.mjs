// The phone app's icons and splash screens, drawn from the Sheltüh ü mark
// (public/brand/sheltuh-u.svg, docs/pwa.md "Regenerating the icons") in black
// on Signal Orange. Rerun after changing the mark or after `npx cap add`
// recreates a native project:
//
//   node mobile/generate-icons.mjs
//
// It overwrites the PNGs Capacitor's templates put in android/ and ios/,
// each at the size the template already has, and sets the Android adaptive
// icon's background colour. Needs only sharp (already a dependency); makes
// no network requests.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const sharp = require("sharp");

const SIGNAL = "#ff4800";
const INK = "#000000";

// The official secondary ü, as in docs/pwa.md's icon script.
const source = fs.readFileSync(path.join(ROOT, "public/brand/sheltuh-u.svg"), "utf8");
const [vx, vy, vw, vh] = source.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const d = source.match(/<path d="([^"]+)"/)[1];

/** An SVG of `width`×`height`: optional background, the ü centred at `share` of the shorter side. */
function svg(width, height, share, { background = SIGNAL, circle = false } = {}) {
  const scale = (Math.min(width, height) * share) / vh;
  const tx = width / 2 - (vx + vw / 2) * scale;
  const ty = height / 2 - (vy + vh / 2) * scale;
  const bg =
    background === null
      ? ""
      : circle
        ? `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2}" fill="${background}"/>`
        : `<rect width="${width}" height="${height}" fill="${background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}<path transform="matrix(${scale} 0 0 ${scale} ${tx} ${ty})" fill="${INK}" d="${d}"/></svg>`;
}

async function write(file, makeSvg, { opaque = false } = {}) {
  const abs = path.join(ROOT, file);
  const { width, height } = await sharp(abs).metadata();
  let image = sharp(Buffer.from(makeSvg(width, height)));
  if (opaque) image = image.flatten({ background: SIGNAL }).removeAlpha();
  await image.png({ compressionLevel: 9 }).toFile(`${abs}.tmp`);
  fs.renameSync(`${abs}.tmp`, abs);
  return `${file} ${width}x${height}`;
}

function filesNamed(dir, name) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, name))
    .filter((file) => fs.existsSync(path.join(ROOT, file)))
    .sort();
}

const done = [];
const res = "android/app/src/main/res";

// Android: square legacy icon (as the PWA's), round icon, and the adaptive icon's foreground
// (transparent, the ü inside the 66dp-of-108dp safe zone) over an orange background colour.
for (const file of filesNamed(res, "ic_launcher.png")) done.push(await write(file, (w, h) => svg(w, h, 0.53)));
for (const file of filesNamed(res, "ic_launcher_round.png"))
  done.push(await write(file, (w, h) => svg(w, h, 0.5, { circle: true })));
for (const file of filesNamed(res, "ic_launcher_foreground.png"))
  done.push(await write(file, (w, h) => svg(w, h, 0.36, { background: null })));
const backgroundXml = path.join(ROOT, res, "values/ic_launcher_background.xml");
if (fs.existsSync(backgroundXml)) {
  fs.writeFileSync(
    backgroundXml,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${SIGNAL.toUpperCase()}</color>\n</resources>\n`,
  );
  done.push(`${res}/values/ic_launcher_background.xml ${SIGNAL.toUpperCase()}`);
}
// Android splash (shown before the site loads; Android 12+ shows the icon instead).
for (const file of filesNamed(res, "splash.png"))
  done.push(await write(file, (w, h) => svg(w, h, 0.2), { opaque: true }));

// iOS: the single 1024 App Store icon (opaque: iOS fills transparency with black), and the splash.
const iconset = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png";
if (fs.existsSync(path.join(ROOT, iconset))) done.push(await write(iconset, (w, h) => svg(w, h, 0.53), { opaque: true }));
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  const file = `ios/App/App/Assets.xcassets/Splash.imageset/${name}`;
  if (fs.existsSync(path.join(ROOT, file))) done.push(await write(file, (w, h) => svg(w, h, 0.14), { opaque: true }));
}

console.log(done.length ? done.join("\n") : "No native projects found: run `npx cap add android` / `npx cap add ios` first.");
