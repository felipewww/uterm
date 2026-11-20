import { readFileSync, renameSync, writeFileSync } from 'node:fs'

/** Which sessions had a tab open, so the next launch can bring them back. Ids only: never any content. */
export function readOpenTabs(file: string): string[] {
  try { const v = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 100) : [] } catch { return [] }
}
export function writeOpenTabs(file: string, ids: string[]): void {
  try { writeFileSync(`${file}.tmp`, JSON.stringify(ids)); renameSync(`${file}.tmp`, file) } catch { /* best effort */ }
}
