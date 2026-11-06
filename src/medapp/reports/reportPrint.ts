// Printed report sheet: every row (not just what fits on screen), company
// header, report name and period, column headings repeated on every page,
// section heads, SUB TOTAL rows and the GRAND TOTAL set apart from the lines.
import type { Col } from '../ui'

/** Rows of a report. `_kind` marks a section head, a sub total or the grand total. */
export type ReportRow = Record<string, string> & { _kind?: 'head' | 'sub' | 'total' }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function reportHtml(o: { company: string; title: string; period?: string; cols: Col[]; rows: ReportRow[]; printedBy?: string }): string {
  const cols = o.cols.filter((c) => c.label)
  const td = (c: Col, v: string) => `<td class="${c.align === 'right' ? 'r' : ''}">${esc(v ?? '')}</td>`
  const body = o.rows
    .map((r) => {
      if (r._kind === 'head') return `<tr class="head"><td colspan="${cols.length}">${esc(r[cols[0].key] ?? '')}</td></tr>`
      return `<tr class="${r._kind ?? ''}">${cols.map((c) => td(c, r[c.key] ?? '')).join('')}</tr>`
    })
    .join('')
  const stamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>
@page{size:A4;margin:14mm 12mm}
body{font:11px Arial,Helvetica,sans-serif;color:#000;margin:0}
.top{text-align:center;margin-bottom:8px}
.top .co{font-size:16px;font-weight:bold}
.top .ti{font-size:13px;font-weight:bold;margin-top:3px;letter-spacing:.5px}
.top .pe{margin-top:2px}
.meta{display:flex;justify-content:space-between;font-size:10px;color:#333;margin:4px 0 6px}
table{border-collapse:collapse;width:100%}
thead{display:table-header-group}
th{border-top:1.5px solid #000;border-bottom:1.5px solid #000;padding:4px 5px;text-align:left;font-size:11px}
th.r,td.r{text-align:right}
td{padding:3px 5px;border-bottom:1px solid #ddd;font-size:11px}
tr{page-break-inside:avoid}
tr.head td{font-weight:bold;padding-top:9px;border-bottom:1px solid #000;letter-spacing:.4px}
tr.sub td{font-weight:bold;background:#f0f0f0;border-top:1px solid #000;border-bottom:1px solid #000}
tr.total td{font-weight:bold;font-size:12px;border-top:2px solid #000;border-bottom:3px double #000;background:#e4e4e4}
</style></head><body>
<div class="top"><div class="co">${esc(o.company)}</div><div class="ti">${esc(o.title)}</div>${o.period ? `<div class="pe">${esc(o.period)}</div>` : ''}</div>
<div class="meta"><span>Printed ${esc(stamp)}${o.printedBy ? ` by ${esc(o.printedBy)}` : ''}</span><span>${o.rows.filter((r) => !r._kind).length} line(s)</span></div>
<table><thead><tr>${cols.map((c) => `<th class="${c.align === 'right' ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
</body></html>`
}

/** Open the sheet in a print window. false when the browser blocked the window. */
export function printReport(o: Parameters<typeof reportHtml>[0]): boolean {
  const w = window.open('', '_blank', 'width=900,height=760')
  if (!w) return false
  w.document.write(reportHtml(o))
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 150)
  return true
}

/** Search keeps the section heads, sub totals and grand total; it filters the lines. */
export function filterReport(rows: ReportRow[], q: string): ReportRow[] {
  const t = q.trim().toLowerCase()
  if (!t) return rows
  return rows.filter((r) => r._kind || Object.entries(r).some(([k, v]) => k !== '_kind' && String(v).toLowerCase().includes(t)))
}
