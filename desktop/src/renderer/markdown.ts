/**
 * Tiny, safe markdown for agent messages: headings, bold, inline/fenced code, lists, paragraphs.
 * Everything is HTML-escaped first; links are reduced to their text. The output only ever contains the tags built here.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(raw: string): string {
  let t = esc(raw)
  t = t.replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '$1')
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  return t
}

export function renderMarkdown(src: string): string {
  const out: string[] = []
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  let para: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null
  const flushPara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = [] } }
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`); list = null } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      flushPara(); flushList()
      const body: string[] = []
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!); i++) body.push(lines[i]!)
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`)
      continue
    }
    if (!line.trim()) { flushPara(); flushList(); continue }
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line)
    if (h) { flushPara(); flushList(); out.push(`<p class="md-h">${inline(h[1]!)}</p>`); continue }
    const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line)
    if (li) {
      flushPara()
      const tag = li[1] ? 'ul' : 'ol'
      if (list && list.tag !== tag) flushList()
      list ??= { tag, items: [] }
      list.items.push(inline(li[3]!))
      continue
    }
    flushList()
    para.push(inline(line.trim()))
  }
  flushPara(); flushList()
  return out.join('')
}
