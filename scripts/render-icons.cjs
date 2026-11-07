// Renders electron-builder-resources/riuplay.svg into the PNG/ICO files the build and the app use.
// Run with Electron (it provides the SVG rasteriser):  npx electron scripts/render-icons.cjs
// Outputs: electron-builder-resources/riuplay.png (1024), riuplay.ico (16-256, PNG-compressed
// entries, supported since Windows Vista), src/renderer/src/assets/app-icon.png (256).
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const res = path.join(root, "electron-builder-resources");
const svg = fs.readFileSync(path.join(res, "riuplay.svg"), "utf8");

async function render(win, size) {
  const html = `<html><body style="margin:0;background:transparent">${svg.replace(
    /width="512" height="512"/,
    `width="${size}" height="${size}"`,
  )}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setContentSize(size, size);
  await new Promise((r) => setTimeout(r, 150));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  return image.resize({ width: size, height: size, quality: "best" }).toPNG();
}

function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of icoSizes) pngs.push({ size, data: await render(win, size) });
  fs.writeFileSync(path.join(res, "riuplay.ico"), buildIco(pngs));
  fs.writeFileSync(path.join(res, "riuplay.png"), await render(win, 1024));
  fs.writeFileSync(path.join(root, "src/renderer/src/assets/app-icon.png"), pngs.find((p) => p.size === 256).data);
  console.log("icons written");
  app.quit();
});
