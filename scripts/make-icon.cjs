// Regenerates the app icons from desktop/build/icon-source.png using Electron's own image scaler (no extra tools needed).
//  - build/icon.png         512 px, used by electron-builder for the packaged app
//  - build/icon-window.png  192 px, used for the BrowserWindow: Electron/Chromium on X11 silently drops window icons of 256 px or more
const { app, nativeImage } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
app.whenReady().then(() => {
  const dir = join(__dirname, '..', 'desktop', 'build')
  const src = nativeImage.createFromPath(join(dir, 'icon-source.png'))
  if (src.isEmpty()) { console.error('icon-source.png not found'); app.exit(1); return }
  // The artwork has a wide transparent margin (and a soft glow), which makes the icon look small next to others: crop to the visible
  // artwork (alpha above a threshold) plus a little breathing room, keeping it square.
  const { width: w, height: h } = src.getSize(); const bmp = src.toBitmap() // BGRA
  let x0 = w, y0 = h, x1 = 0, y1 = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bmp[(y * w + x) * 4 + 3] > 90) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  const side = Math.round(Math.max(x1 - x0, y1 - y0) * 1.06)
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const sx = Math.max(0, Math.min(w - side, Math.round(cx - side / 2))), sy = Math.max(0, Math.min(h - side, Math.round(cy - side / 2)))
  const art = src.crop({ x: sx, y: sy, width: Math.min(side, w), height: Math.min(side, h) })
  for (const [name, size] of [['icon.png', 512], ['icon-window.png', 192]]) writeFileSync(join(dir, name), art.resize({ width: size, height: size, quality: 'best' }).toPNG())
  console.log('icons regenerated')
  app.quit()
})
