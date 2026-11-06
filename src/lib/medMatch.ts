// Autocorrect medicine names read from uploaded documents (handwritten order
// books, invoices with typos) against the company's medicine / price list.
//
//   matchMedicine("AMOXILINE 500G CAPS", list) → AMOXICILLIN 500MG CAPSULES (100S)
//
// How it scores a candidate (0 … 1):
//   • the name words (brand / molecule) are compared letter by letter
//     (Damerau-Levenshtein, so swapped / missing / extra letters still score),
//     mostly by how well the typed words are found in the candidate;
//   • strengths and sizes compare as plain numbers (500G written for 500MG
//     still counts as 500); a different number (CALPOL 60ML vs 100ML) costs;
//   • the form (tablet, syrup, cream …) agrees or not.
// Also reads what a pack holds from a name: "(100S)" → 100 pieces, "60ML" → 60 ml.

const FORMS: [RegExp, string][] = [
  [/^(TABS?|TABLETS?|TBS?|TABLT?S?)$/, 'TAB'],
  [/^(CAPS?|CAPSULES?|CAPSULS?)$/, 'CAP'],
  [/^(SYRUP|SYRUPS|SYP|SYR|SYRP|SIRUP|ELIXIR|LIQUID|LINCTUS|MIXTURE|MIXT|TONIC)$/, 'SYR'],
  [/^(SUSP|SUSPENSION|SUSPENTION|SUSPN)$/, 'SUSP'],
  [/^(DROPS?|DRPS?|DRP)$/, 'DROP'],
  [/^(INJ|INJECTION|INJECTIONS|AMP|AMPS|AMPOULES?|VIALS?)$/, 'INJ'],
  [/^(CREAM|CRM|CRE)$/, 'CREAM'],
  [/^(OINT|OINTMENT|OINTMENTS)$/, 'OINT'],
  [/^(GEL|GELS)$/, 'GEL'],
  [/^(LOTION|LOT)$/, 'LOTION'],
  [/^(INHALER|INHALERS|INH|PUFF|PUFFS)$/, 'INHALER'],
  [/^(BALM|BALMS)$/, 'BALM'],
  [/^(LOZENGES?|LOZ|LOZENGS?)$/, 'LOZ'],
  [/^(POWDER|PDR|PWD|SACHETS?)$/, 'POWDER'],
  [/^(SPRAY|SPRAYS)$/, 'SPRAY'],
  [/^(PESSARIES|PESSARY|PESS)$/, 'PESS'],
  [/^(SUPPOSITORIES|SUPPOSITORY|SUPP)$/, 'SUPP'],
]
/** Words that say nothing about which medicine it is. */
const NOISE = new Set(['GENERIC', 'ORIGINAL', 'SMALL', 'BIG', 'LARGE', 'SIZE', 'BLISTER', 'PACK', 'PACKS', 'PKT', 'PKTS', 'OF', 'THE', 'AND', 'FOR', 'WITH', 'BOX', 'BOXES', 'BTL', 'BOTTLE', 'NEW', 'PCS', 'PIECES', 'S', 'X', 'ML', 'MG', 'G', 'GM', 'MCG', 'IU', 'L', 'KG'])

/** A number in a name and what it measures: volume (ML / L), mass (MG / G / MCG / IU), a count (100S, 12X9) or bare. */
export type MedNum = { n: number; kind: 'vol' | 'mass' | 'count' | 'plain' }
export type MedKey = { words: string[]; nums: MedNum[]; form?: string; raw: string }

/** Solid or liquid dose forms: a tablet is never a syrup. */
const GROUP: Record<string, string> = { TAB: 'solid', CAP: 'solid', LOZ: 'solid', SYR: 'liquid', SUSP: 'liquid', DROP: 'liquid', INJ: 'inj', CREAM: 'topical', OINT: 'topical', GEL: 'topical', LOTION: 'topical', BALM: 'topical', INHALER: 'inhaler', POWDER: 'powder', SPRAY: 'spray', PESS: 'pess', SUPP: 'supp' }
const unitKind = (u: string): MedNum['kind'] => (/^(ML|L|LTR|LITRE|LITER)$/.test(u) ? 'vol' : /^(MG|G|GM|GMS|MCG|IU|KG)$/.test(u) ? 'mass' : /^S$/.test(u) ? 'count' : 'plain')

/** The parts of a medicine name that identify it. */
export function medKey(name: string): MedKey {
  const t = ` ${name.toUpperCase()} `
    .replace(/(\d+)\s*'\s*S\b/g, '$1S') // 30'S → 30S
    .replace(/[^A-Z0-9.]+/g, ' ')
  const words: string[] = []
  const nums: MedNum[] = []
  let form: string | undefined
  const toks = t.split(' ').filter(Boolean)
  toks.forEach((tok, i) => {
    // A number, alone or glued to its unit / count: 500, 500MG, 500G, 60ML, 100S, 12X9GM (a pack count)
    const parts = tok.split(/X(?=\d)/)
    let numeric = false
    for (const part of parts) {
      const m = part.match(/^(\d+(?:\.\d+)?)([A-Z]*)$/)
      if (m) {
        // "500 MG": the unit may be the next word.
        const unit = m[2] || (/^(ML|L|MG|G|GM|MCG|IU)$/.test(toks[i + 1] ?? '') ? toks[i + 1] : '')
        nums.push({ n: Number(m[1]), kind: parts.length > 1 ? 'count' : unitKind(unit) })
        numeric = true
      }
    }
    if (numeric) return
    const f = FORMS.find(([re]) => re.test(tok))
    if (f) {
      form ??= f[1]
      return
    }
    if (NOISE.has(tok)) return
    words.push(tok) // single letters too: CARDITAN H, CLOZOLE B
  })
  // No form word: a volume means a liquid (unless it is a cream, gel …).
  if (!form && nums.some((x) => x.kind === 'vol')) form = 'SYR'
  // …and a pack count with no volume, a solid (SEPTRIN 960MG (100S) is tablets).
  else if (!form && nums.some((x) => x.kind === 'count') && nums.some((x) => x.kind === 'mass')) form = 'TAB'
  return { words, nums, form, raw: name }
}

/** Damerau-Levenshtein distance (adjacent swaps count once). */
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 1; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  return d[m][n]
}

/** How alike two words are (0 … 1); a short word that starts the other counts (PARA → PARACETAMOL). */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const sim = 1 - editDistance(a, b) / Math.max(a.length, b.length)
  const pre = a.length >= 4 && b.startsWith(a) ? 0.85 : b.length >= 4 && a.startsWith(b) ? 0.8 : 0
  return Math.max(sim, pre)
}

/** Best similarity of each word of `from` among `to`, weighted by word length (the brand, first, counts more). */
function coverage(from: string[], to: string[]): number {
  if (!from.length || !to.length) return 0
  let sum = 0
  let weight = 0
  from.forEach((w, i) => {
    const best = Math.max(...to.map((x) => wordSimilarity(w, x)))
    const wt = Math.min(w.length, 10) * (i === 0 ? 1.6 : 1)
    sum += best * wt
    weight += wt
  })
  return sum / weight
}

/** 0 … 1: how likely `typed` names the medicine `candidate`. */
export function medScore(typed: MedKey, candidate: MedKey): number {
  if (!typed.words.length || !candidate.words.length) return 0
  // Joined spelling too, for words split or run together ("GOODMORNING" / "GOOD MORNING").
  const joined = wordSimilarity(typed.words.join(''), candidate.words.join(''))
  const fwd = coverage(typed.words, candidate.words)
  const back = coverage(candidate.words, typed.words)
  let s = Math.max(0.78 * fwd + 0.22 * back, 0.9 * joined)
  // Brand word: the first typed word should be found well, or it is likely another product.
  const brand = Math.max(...candidate.words.map((w) => wordSimilarity(typed.words[0], w)))
  if (brand < 0.6 && joined < 0.75) s -= 0.15
  // Strength / size: the same number of the same kind (500G written for 500MG is still mass).
  const same = (a: MedNum, b: MedNum) => a.n === b.n && (a.kind === b.kind || a.kind === 'plain' || b.kind === 'plain')
  /** A size / strength or form that disagrees: never taken by itself. */
  let onlySuggest = false
  const tn = typed.nums.filter((x) => x.kind !== 'count')
  const cn = candidate.nums.filter((x) => x.kind !== 'count')
  if (tn.length && cn.length) {
    if (tn.some((a) => cn.some((b) => same(a, b)))) s += 0.06
    // Another size / strength is another product (60ML vs 100ML, 250MG vs 500MG): only ever a suggestion.
    else {
      s -= tn.some((a) => a.kind !== 'plain' && cn.some((b) => b.kind === a.kind)) ? 0.14 : 0.08
      onlySuggest = true
    }
  }
  if (typed.form && candidate.form) {
    if (typed.form === candidate.form) s += 0.04
    else if (GROUP[typed.form] === GROUP[candidate.form]) s += 0.01
    else {
      s -= 0.12 // tablet vs syrup
      onlySuggest = true
    }
  }
  if (onlySuggest) s = Math.min(s, AUTO_MATCH - 0.02)
  return Math.max(0, Math.min(1, s))
}

export type MedMatch<T> = { item: T; score: number }
/** Above this a match is taken by itself; between SUGGEST and this the buyer is asked. */
export const AUTO_MATCH = 0.86
export const SUGGEST = 0.62

/**
 * The best few medicines for a typed name, best first (only those at SUGGEST or above).
 * `auto` is the one to take without asking: a strong score, clearly ahead of the next.
 */
export function matchMedicine<T>(typed: string, list: T[], nameOf: (t: T) => string, keys?: Map<T, MedKey>): { best: MedMatch<T>[]; auto?: MedMatch<T> } {
  const k = medKey(typed)
  const scored = list
    .map((item) => ({ item, score: medScore(k, keys?.get(item) ?? medKey(nameOf(item))) }))
    .filter((x) => x.score >= SUGGEST)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
  const [a, b] = scored
  const auto = a && a.score >= AUTO_MATCH && (!b || a.score - b.score >= 0.04 || (a.score >= 0.97 && b.score < a.score)) ? a : undefined
  return { best: scored, auto }
}

/** What one pack holds, from a medicine name: pieces ("(100S)", "10X10", "30 TABS") and/or volume ("60ML", "1L"). */
export function packContents(name: string): { pieces?: number; ml?: number; label: string } {
  const t = ` ${name.toUpperCase()} `
  const ml = t.match(/(\d+(?:\.\d+)?)\s*ML\b/) ? Number(t.match(/(\d+(?:\.\d+)?)\s*ML\b/)![1]) : t.match(/\b(\d+(?:\.\d+)?)\s*(?:L|LTR|LITRE|LITER)\b/) ? Number(t.match(/\b(\d+(?:\.\d+)?)\s*(?:L|LTR|LITRE|LITER)\b/)![1]) * 1000 : undefined
  let pieces: number | undefined
  const ok = (n: number) => Number.isInteger(n) && n > 1 && n <= 5000
  const mult = t.match(/\b(\d{1,3})\s*[X×]\s*(\d{1,3})(?:\s*'?S)?\b(?!\s*(?:ML|MG|G|GM|L|MCG|IU|%))/)
  const s = t.match(/\b(\d{1,4})\s*'?\s*S\b/)
  const packOf = t.match(/PACK\s+OF\s+(\d{1,4})\b/)
  const unit = t.match(/\b(\d{1,4})\s*(?:TABS?|TABLETS|CAPS?|CAPSULES|PCS|PIECES|SACHETS|VIALS|AMPOULES|AMPS|PESSARIES|SUPPOSITORIES|LOZENGES)\b/)
  if (mult && ok(Number(mult[1]) * Number(mult[2]))) pieces = Number(mult[1]) * Number(mult[2])
  else if (packOf && ok(Number(packOf[1]))) pieces = Number(packOf[1])
  else if (s && ok(Number(s[1]))) pieces = Number(s[1])
  else if (unit && ok(Number(unit[1]))) pieces = Number(unit[1])
  const form = medKey(name).form
  const what = form === 'CAP' ? 'caps' : form === 'TAB' ? 'tabs' : form === 'LOZ' ? 'lozenges' : 'pcs'
  const label = [pieces ? `${pieces} ${what}` : '', ml ? `${ml >= 1000 && ml % 1000 === 0 ? `${ml / 1000} L` : `${ml} ml`}` : ''].filter(Boolean).join(' · ')
  return { pieces, ml, label }
}
