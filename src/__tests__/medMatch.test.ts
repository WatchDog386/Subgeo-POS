// Autocorrecting medicine names read from uploaded (often handwritten) documents.
import { describe, expect, it } from 'vitest'
import { AUTO_MATCH, matchMedicine, medKey, packContents, wordSimilarity } from '../lib/medMatch'
import { autocorrect, candidatesFrom, packSizeFrom, type CatalogueItem } from '../medapp/pages/InvoiceImport'
import type { Product } from '../db/types'

// Names as they are in the price list.
const LIST = [
  'CALPOL SUSPENSION (60ML)',
  'CALPOL SUSPENSION (100ML)',
  'PARACETAMOL 500MG TABLETS (100S) - INDIA (UNICURE)',
  'PARACETAMOL SYRUP (60ML) - MICROMOL',
  'CETRIZINE 10MG TABLETS (100S) - CETZAN (WHITE/OVAL)',
  'CETRIZINE HYDROCHLORIDE 5MG SYRUP (60ML) - CETZAN',
  'IBUPROFEN 400MG - BRUFEN (100S)',
  'BRUFEN SYRUP (60ML) - PROFEN',
  'MELOXICAM 15MG TABLETS (100S) - MELONAC',
  'MELOXICAM 7.5MG TABLETS (100S) - MELONAC',
  'TRICOHIST EXPECTORANT (100ML)',
  'TRICOHIST EXPECTORANT (60ML)',
  'BONNISAN LIQUID (120ML)',
  'SURGICAL SPIRIT (50ML) - SMALL SIZE.',
  'GOOD MORNING TABLETS (100S)',
  'GOOD MORNING LUNG TONIC (60ML)',
  'DEXAMETHASONE 4MG TABLETS 100S',
  'COFTA TABLETS (100S)',
  'FANLAR TABLETS (25X3S)',
]
const m = (typed: string) => matchMedicine(typed, LIST, (x) => x)

describe('medicine name autocorrect', () => {
  it('corrects handwritten spellings to the medicine in the list', () => {
    expect(m('CALPO 60ML').auto?.item).toBe('CALPOL SUSPENSION (60ML)')
    expect(m('BONISAN').auto?.item).toBe('BONNISAN LIQUID (120ML)')
    expect(m('GOODMORNING TABS').auto?.item).toBe('GOOD MORNING TABLETS (100S)')
    expect(m('DEXAMETHASON TABS').auto?.item).toBe('DEXAMETHASONE 4MG TABLETS 100S')
    // 500G / 400G / 15G written for MG still finds the strength.
    expect(m('PARACETAMOL 500G').auto?.item).toMatch(/^PARACETAMOL 500MG TABLETS/)
    expect(m('BRUFEN 400G').auto?.item).toBe('IBUPROFEN 400MG - BRUFEN (100S)')
    expect(m('MELOXICAM 15G').auto?.item).toMatch(/^MELOXICAM 15MG/)
  })

  it('tells tablets from syrups and one size from another', () => {
    expect(m('CETRIZINE TABS').auto?.item).toMatch(/^CETRIZINE 10MG TABLETS/)
    expect(m('CETRIZINE 60ML').auto?.item).toMatch(/SYRUP \(60ML\)/)
    expect(m('TRICOHIST 100ML').auto?.item).toBe('TRICOHIST EXPECTORANT (100ML)')
    expect(m('TRICOHIST 60ML').auto?.item).toBe('TRICOHIST EXPECTORANT (60ML)')
  })

  it('only suggests when the size or form disagrees, or it is not sure', () => {
    // 100ML is not the 50ML bottle: offered, never taken by itself.
    const s = m('SURGICAL SPIRIT 100ML')
    expect(s.auto).toBeUndefined()
    expect(s.best[0].item).toMatch(/^SURGICAL SPIRIT/)
    expect(s.best[0].score).toBeLessThan(AUTO_MATCH)
    const c = m('COPTA TABS')
    expect(c.auto).toBeUndefined()
    expect(c.best[0].item).toBe('COFTA TABLETS (100S)')
    // Nothing like it: nothing offered.
    expect(m('ZZYZX QWERTY').best).toEqual([])
  })

  it('reads the parts of a name and compares words letter by letter', () => {
    expect(medKey('AMOXIL 500MG CAPS')).toMatchObject({ words: ['AMOXIL'], form: 'CAP', nums: [{ n: 500, kind: 'mass' }] })
    expect(medKey('CALPOL 60ML').form).toBe('SYR') // a volume with no form is a liquid
    expect(wordSimilarity('DEXAMETHASON', 'DEXAMETHASONE')).toBeGreaterThan(0.9)
    expect(wordSimilarity('CALPOL', 'PANADOL')).toBeLessThan(0.6)
  })
})

describe('what a pack holds', () => {
  it('pieces in a pack of tablets, ml in a bottle', () => {
    expect(packContents('PARACETAMOL 500MG TABLETS (100S)')).toMatchObject({ pieces: 100, label: '100 tabs' })
    expect(packContents('IBUCAP FORTE CAPSULES (10\'S)')).toMatchObject({ pieces: 10, label: '10 caps' })
    expect(packContents('FANLAR TABLETS (25X3S)').pieces).toBe(75)
    expect(packContents('CALPOL SUSPENSION (60ML)')).toMatchObject({ ml: 60, label: '60 ml' })
    expect(packContents('RANFERON 1L').label).toBe('1 L')
    expect(packContents('AMOXIL 500MG').label).toBe('')
    expect(packSizeFrom('FANLAR TABLETS (25X3S)')).toBe(75)
  })
})

describe('autocorrect against this chemist and the company list', () => {
  const prod = (id: number, name: string, sku: string): Product => ({ id, sku, barcode: sku, name, fitment: [], cost: 100, price: 200, stock: 5, reorderLevel: 0, taxable: false, serialized: false, trackStock: true, active: true, createdAt: 1, updatedAt: 1 }) as Product
  const cat = (name: string, sku: string, over: Partial<CatalogueItem> = {}): CatalogueItem => ({ name, sku, price: 1500, cost: 900, minPrice: 1200, taxable: false, packSize: null, sellBy: null, ...over })
  const cands = candidatesFrom([prod(1, 'CALPOL SUSPENSION (60ML)', 'CAL60')], [cat('CALPOL SUSPENSION (60ML)', 'OTHER'), cat('DEXAMETHASONE 4MG TABLETS 100S', 'DEX4', { packSize: 100, sellBy: 1 })])

  it('prefers the medicine in stock here; the company list fills the rest', () => {
    expect(cands.map((c) => [c.name, c.productId, c.sku])).toEqual([
      ['CALPOL SUSPENSION (60ML)', 1, 'CAL60'],
      ['DEXAMETHASONE 4MG TABLETS 100S', undefined, 'DEX4'],
    ])
    expect(autocorrect('CALPO 60ML', cands).use?.productId).toBe(1)
    const d = autocorrect('DEXAMETHASON TABS', cands)
    expect(d.use).toMatchObject({ sku: 'DEX4', price: 1500, minPrice: 1200, packSize: 100 })
    expect(autocorrect('CALPOL SUSPENSION (60ML)', cands).score).toBe(1)
    expect(autocorrect('SOMETHING ELSE', cands).use).toBeUndefined()
  })
})
