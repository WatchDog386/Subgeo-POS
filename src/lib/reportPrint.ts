/** Formatted report print — matches the legacy "reports chokaa" sheet:
 * landscape page, "Page 1" top-left, the store/licence line, the report
 * title with the date range it was run on, the bordered grid, and
 * Sub Total + Total rows. */

export type PrintCol = { key: string; label: string }

const NUM_RE = /^-?\d+(\.\d+)?$/
const strip = (v: string) => v.replace(/,/g, '')
const isNum = (v: string) => v !== '' && NUM_RE.test(strip(v))
const withCommas = (n: number) => n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

export function printReport(opts: {
  /** "CASH COLLECTION DEBTORS + OTC" */
  title: string
  /** "SUBGEO CHEMIST LTD - CHOKAA ( 01-12-2023 To 31-12-2026 )" */
  store: string
  from: string
  to: string
  /** Name under the column header, e.g. the party or the chemist. */
  party?: string
  cols: PrintCol[]
  rows: Record<string, string>[]
  /** Column keys to total up in the Sub Total / Total rows. */
  totals?: string[]
}): boolean {
  const w = window.open('', '_blank', 'width=1120,height=780')
  if (!w) return false

  const cols = opts.cols
  const firstKey = cols[0]?.key ?? ''
  // The grid already shows its own TOTAL row; the printed sheet computes its own.
  const data = opts.rows.filter((r) => (r[firstKey] ?? '').toUpperCase() !== 'TOTAL')

  const totalKeys =
    opts.totals ??
    cols.filter((c) => data.length > 0 && data.every((r) => isNum(r[c.key] ?? ''))).map((c) => c.key)
  const sums: Record<string, number> = {}
  for (const k of totalKeys) sums[k] = 0
  for (const r of data)
    for (const k of totalKeys) {
      const v = strip(r[k] ?? '')
      if (v !== '' && NUM_RE.test(v)) sums[k] += parseFloat(v)
    }
  const cell = (c: PrintCol) => {
    if (!totalKeys.includes(c.key)) return ''
    return withCommas(sums[c.key])
  }
  const footRow = (label: string) =>
    `<tr class="foot"><td>${esc(label)}</td>${cols.slice(1).map(cell).join('')}</tr>`

  const range = opts.from || opts.to ? ` ( ${opts.from || '01-01-2000'} To ${opts.to || '01-01-2100'} )` : ''

  w.document.write(`<!doctype html><html><head><title>${esc(opts.title)}</title><style>
@page { size: A4 landscape; margin: 10mm }
body { font: 12px Arial, Helvetica, sans-serif; margin: 10px; color: #000 }
.page { margin: 0 }
.store { margin: ${opts.store ? '34px 0 0 30px' : '0'}; font-size: 13.5px; white-space: pre-wrap }
.title { margin: 46px 0 18px 12px; font-size: 13.5px; white-space: pre-wrap }
table { border-collapse: collapse; width: 100% }
th, td { border: 1px solid #4b4b4b; padding: 4px 9px; font-size: 12px; text-align: left; vertical-align: top }
th { padding: 5px 9px; font-weight: bold }
tr.foot td { font-weight: bold }
</style></head><body>
<div class="page">Page 1</div>
${opts.store ? `<div class="store">${esc(opts.store)}</div>` : ''}
<div class="title">${esc(opts.title + range)}</div>
<table>
<tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>
${opts.party !== undefined ? `<tr><td>${esc(opts.party)}</td>${cols.slice(1).map(() => '<td></td>').join('')}</tr>` : ''}
${data.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}
${footRow('Sub Total')}
${footRow('Total')}
</table>
</body></html>`)
  w.document.close()
  w.focus()
  w.print()
  return true
}
