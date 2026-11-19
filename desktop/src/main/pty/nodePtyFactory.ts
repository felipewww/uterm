import * as pty from 'node-pty'
import type { PtyFactory } from './ptyManager'

export const nodePtyFactory: PtyFactory = (spec) => {
  const p = pty.spawn(spec.file, spec.args, {
    name: 'xterm-256color', cols: spec.cols, rows: spec.rows, cwd: spec.cwd, env: spec.env
  })
  return {
    pid: p.pid,
    onData: (cb) => { p.onData(cb) },
    onExit: (cb) => { p.onExit((e) => cb(e.exitCode, e.signal)) },
    write: (d) => p.write(d),
    resize: (c, r) => p.resize(c, r),
    kill: (s) => p.kill(s)
  }
}
