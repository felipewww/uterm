// electron-builder config for one macOS architecture (MAC_ARCH=arm64|x64): the same as package.json's "build", minus the other
// architecture's native files, so each zip carries only what it can run.
const base = require('../package.json').build
const arch = process.env.MAC_ARCH === 'x64' ? 'x64' : 'arm64'
const other = arch === 'arm64' ? 'x64' : 'arm64'
module.exports = {
  ...base,
  mac: {
    ...base.mac,
    target: [{ target: 'zip', arch: [arch] }],
    files: [...base.mac.files, `!node_modules/onnxruntime-node/bin/napi-v6/darwin/${other}/**`, `!node_modules/@img/*darwin-${other}*/**`, '!node_modules/onnxruntime-web/**']
  }
}
