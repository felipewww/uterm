// node-pty launches children through a small helper binary that must be executable; packaging on another OS can drop the bit.
const { chmodSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return
  const res = join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds')
  if (!existsSync(res)) return
  for (const d of readdirSync(res)) {
    const helper = join(res, d, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
