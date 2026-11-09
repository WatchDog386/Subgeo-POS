// The company default price: what most chemists charge, never one chemist's own change.
import { describe, expect, it } from 'vitest'
import { companyPrice } from '../lib/companyPrice'

const c = (chem: string, price: number, updatedAt: number, minPrice?: number, cost = 1000) => ({ chem, price, minPrice, cost, updatedAt })

describe('company default price', () => {
  it('editing one chemist does not change the default the others use', () => {
    // SUBGEO10 raised its own price last: the default stays what most chemists charge.
    const cp = companyPrice([c('SUBGEO1', 5000, 1, 4500), c('SUBGEO2', 5000, 2, 4500), c('SUBGEO10', 6500, 9, 6000)])
    expect(cp).toMatchObject({ price: 5000, minPrice: 4500 })
  })
  it('one chemist only: its price; a tie: the latest; blanks are ignored', () => {
    expect(companyPrice([c('SUBGEO1', 5000, 1)])?.price).toBe(5000)
    expect(companyPrice([c('SUBGEO1', 5000, 1), c('SUBGEO2', 5200, 3)])?.price).toBe(5200)
    expect(companyPrice([c('SUBGEO1', 0, 9), c('SUBGEO2', 5200, 3)])).toMatchObject({ price: 5200, chem: 'SUBGEO2' })
  })
  it('Best Price comes from a chemist at that price, else one at or below it', () => {
    expect(companyPrice([c('A', 5000, 1), c('B', 5000, 2, 4200), c('C', 9000, 3, 8000)])?.minPrice).toBe(4200)
    expect(companyPrice([c('A', 5000, 5), c('B', 5000, 6), c('C', 4800, 3, 4000), c('D', 9000, 1, 8000)])?.minPrice).toBe(4000)
  })
})
