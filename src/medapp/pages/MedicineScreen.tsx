// Medicine master (legacy screenshots 31 Oct 2026):
//   "+"    → "Medicine" with PRODUCT / DETAIL tabs (a new medicine)
//   edit   → "MEDICINE  Status : ← →" — the same form for an existing medicine,
//            with the arrows stepping through the list and a lookup to find another.
// A medicine is a product (prices, stock, limits) plus its Medicine-form record
// in the docs table (UOM, pack size, molecular name, product type, markup…).
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { DocRecord, Product, Supplier } from '../../db/types'
import { toCents } from '../../lib/money'
import { useSession } from '../../session'
import { useToast } from '../../components/ui'
import { dmy, nextDocNo, peekDocNo, saveDoc, useMedDefaults } from '../data'
import { EyeIcon } from '../icons'
import { Btn, Check, DateField, IBtn, Input, PickList } from '../ui'
import { Field, LookupBtn, RefreshGlyph, SubTabs, c2, n, panel, printSheet, openSms, useEntryKeys } from './EntryScreens'
import { ProductLookup } from './ProductLookup'

const SLUG = 'medicine'
const PRODUCT_TYPES = ['MEDICINE', 'SURGICAL', 'COSMETIC', 'SUPPLEMENT', 'NON-PHARMA']

type Form = {
  code: string
  name: string
  group: string
  uom: string
  packSize: string
  type: string
  molecular: string
  productType: string
  supplier: string
  cost: string
  markup: string
  retail: string
  whole: string
  vat: string
  date: string
  user: string
  barcode: string
  minPrice: string
  reorder: string
  maxStock: string
  active: boolean
}

/** The Medicine-form record that belongs to a product (by code, else by name). */
export function medicineDocFor(p: Product, docs: DocRecord[]): DocRecord | undefined {
  const code = p.sku.trim().toUpperCase()
  const name = p.name.trim().toUpperCase()
  return docs.find((d) => (d.values.docNo ?? '').trim().toUpperCase() === code) ?? docs.find((d) => (d.values.name ?? '').trim().toUpperCase() === name)
}

/** Validate the typed form; returns what is stored on the product. */
export function medicineValues(f: Pick<Form, 'name' | 'cost' | 'retail' | 'whole' | 'minPrice' | 'reorder' | 'maxStock' | 'markup' | 'packSize'>) {
  if (!f.name.trim()) throw new Error('PRODUCT: Product Name is required')
  const money = (v: string, label: string) => {
    const t = v.trim()
    if (!t) return 0
    if (!/^\d+(\.\d{0,2})?$/.test(t)) throw new Error(`${label} must be an amount, e.g. 150.00`)
    return toCents(t)
  }
  const cost = money(f.cost, 'Cost Rate')
  const price = money(f.retail, 'Retail Sale Price')
  const whole = money(f.whole, 'Whole sale price')
  const minPrice = f.minPrice.trim() ? money(f.minPrice, 'Best Price') : undefined
  if (price <= 0) throw new Error('PRODUCT: enter the Retail Sale Price')
  const count = (v: string, label: string) => {
    const t = v.trim()
    if (!t) return undefined
    if (!/^\d+$/.test(t)) throw new Error(`DETAIL: ${label} must be a whole number`)
    return Number(t)
  }
  const reorderLevel = count(f.reorder, 'Re-order Level') ?? 0
  const maxStock = count(f.maxStock, 'Max Level')
  if (f.markup.trim() && !(n(f.markup) >= 0)) throw new Error('Markup% must be 0 or more')
  if (f.packSize.trim() && !(n(f.packSize) > 0)) throw new Error('Pack Size must be above 0')
  if (minPrice !== undefined && price < minPrice) throw new Error(`Best Price ${c2(minPrice)} is above the Retail Sale Price ${c2(price)} — the best price is the lowest it may be sold for`)
  if (minPrice !== undefined && whole > 0 && whole < minPrice) throw new Error(`Whole sale price ${c2(whole)} is below the Best Price ${c2(minPrice)}`)
  if (maxStock !== undefined && maxStock < reorderLevel) throw new Error(`DETAIL: Max Level ${maxStock} is below the Re-order Level ${reorderLevel}`)
  return { cost, price, whole: whole || price, minPrice, reorderLevel, maxStock }
}

export function MedicineEntry({ productId, onClose }: { productId?: number; onClose: () => void }) {
  const toast = useToast()
  const { user } = useSession()
  const d = useMedDefaults()
  const products = useLiveQuery(async () => (await db.products.filter((p) => !/^SRV-/i.test(p.sku)).toArray()).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true })), [], [] as Product[])
  const docs = useLiveQuery(() => db.docs.where('slug').equals(SLUG).toArray(), [], [] as DocRecord[])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [] as Supplier[])
  const cats = useLiveQuery(() => db.categories.toArray(), [], [])
  const [current, setCurrent] = useState<number | undefined>(productId)
  const [tab, setTab] = useState<'product' | 'detail'>('product')
  const [pick, setPick] = useState<'group' | 'type' | 'molecular' | 'productType' | 'supplier' | 'find' | null>(null)
  const [jasper, setJasper] = useState(false)
  const [sms, setSms] = useState(false)
  const [saving, setSaving] = useState(false)
  const blank = (): Form => ({
    code: '',
    name: '',
    group: '',
    uom: '',
    packSize: '1.00',
    type: 'S',
    molecular: 'NONE',
    productType: 'MEDICINE',
    supplier: '',
    cost: '0.00',
    markup: '0.00',
    retail: '0.00',
    whole: '0.00',
    vat: '',
    date: dmy(Date.now(), '/'),
    user: user?.name.toUpperCase() ?? '',
    barcode: '',
    minPrice: '',
    reorder: '0',
    maxStock: '',
    active: true,
  })
  const [f, setF] = useState<Form>(blank)
  const [loadedFor, setLoadedFor] = useState<number | 'new' | undefined>()
  const product = current !== undefined ? products.find((p) => p.id === current) : undefined
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }))

  // A new medicine: next code, the usual supplier.
  useEffect(() => {
    if (current !== undefined || loadedFor === 'new') return
    setLoadedFor('new')
    setF(blank())
    void peekDocNo('PRD00').then((code) => setF((x) => ({ ...x, code })))
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps
  // An existing medicine: load it once the lists are in.
  useEffect(() => {
    if (current === undefined || loadedFor === current || !product) return
    const v = medicineDocFor(product, docs)?.values ?? {}
    const sup = product.supplierId !== undefined ? suppliers.find((s) => s.id === product.supplierId)?.name : undefined
    const cat = product.categoryId !== undefined ? cats.find((c) => c.id === product.categoryId)?.name : undefined
    setF({
      code: product.sku,
      name: product.name.toUpperCase(),
      group: (cat || v.group || '').toUpperCase(),
      uom: v.uom || '',
      packSize: v.packSize || '1.00',
      type: product.trackStock ? 'S' : 'N',
      molecular: v.molecular || 'NONE',
      productType: v.productType || 'MEDICINE',
      supplier: (sup || v.supplier || '').toUpperCase(),
      cost: c2(product.cost),
      markup: v.markup || '0.00',
      retail: c2(product.price),
      whole: v.whole || c2(product.price),
      vat: product.taxable ? 'YES' : v.vat === 'NO' ? 'NO' : '',
      date: (v.date || dmy(product.updatedAt || product.createdAt)).replace(/-/g, '/'),
      user: v.user || '',
      barcode: product.barcode || '',
      minPrice: product.minPrice ? c2(product.minPrice) : '',
      reorder: String(product.reorderLevel ?? 0),
      maxStock: product.maxStock !== undefined ? String(product.maxStock) : '',
      active: product.active,
    })
    setLoadedFor(current)
  }, [current, product, docs.length, suppliers.length, cats.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Markup%: the retail (and whole-sale) price follows the cost.
  const withMarkup = (cost: string, markup: string) => {
    const m = n(markup)
    if (!(m > 0) || !(n(cost) > 0)) return {}
    const retail = c2(Math.round(toCents(cost) * (1 + m / 100)))
    return { retail, whole: f.whole === f.retail || n(f.whole) === 0 ? retail : f.whole }
  }

  const groups = useMemo(() => [...new Set([...cats.map((c) => c.name.toUpperCase()), ...docs.map((x) => (x.values.group ?? '').toUpperCase())].filter(Boolean))].sort(), [cats, docs])
  const moleculars = useMemo(() => [...new Set(['NONE', ...docs.map((x) => (x.values.molecular ?? '').toUpperCase()).filter(Boolean)])], [docs])
  const productTypes = useMemo(() => [...new Set([...PRODUCT_TYPES, ...docs.map((x) => (x.values.productType ?? '').toUpperCase()).filter(Boolean)])], [docs])

  // ← → step through the medicines (by product code).
  const pos = current === undefined ? -1 : products.findIndex((p) => p.id === current)
  const go = (step: -1 | 1) => {
    if (!products.length) return
    const i = pos < 0 ? (step > 0 ? 0 : products.length - 1) : pos + step
    if (i < 0) return toast('This is the first medicine', 'error')
    if (i >= products.length) return toast('This is the last medicine', 'error')
    setCurrent(products[i].id)
  }

  const save = async () => {
    if (saving || !user) return
    let v: ReturnType<typeof medicineValues>
    try {
      v = medicineValues(f)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTab(msg.startsWith('DETAIL') ? 'detail' : 'product')
      return toast(msg, 'error')
    }
    const name = f.name.trim().toUpperCase()
    const clash = products.find((p) => p.id !== current && p.name.trim().toUpperCase() === name)
    if (clash) return toast(`${name} already exists (${clash.sku}) — open it with the lookup to change it`, 'error')
    const barcode = f.barcode.trim()
    if (barcode && products.some((p) => p.id !== current && p.barcode === barcode)) return toast(`Barcode ${barcode} is already on another medicine`, 'error')
    const supName = f.supplier.trim().toUpperCase()
    const groupName = f.group.trim().toUpperCase()
    setSaving(true)
    try {
      let code = f.code
      let pid = current
      await db.transaction('rw', [db.products, db.docs, db.suppliers, db.categories, db.kv], async () => {
        let supplierId: number | undefined
        if (supName) {
          const s = (await db.suppliers.toArray()).find((x) => x.name.toUpperCase() === supName)
          supplierId = s ? s.id : ((await db.suppliers.add({ name: supName, notes: 'Added from the Medicine form' } as Supplier)) as number)
        }
        let categoryId: number | undefined
        if (groupName) {
          const c = (await db.categories.toArray()).find((x) => x.name.toUpperCase() === groupName)
          categoryId = c ? c.id : ((await db.categories.add({ name: groupName, color: '#607d8b' })) as number)
        }
        const before = pid !== undefined ? await db.products.get(pid) : undefined
        if (!before) {
          code = await nextDocNo('PRD00')
          if (await db.products.where('sku').equals(code).first()) code = `${code}-${Date.now().toString(36).toUpperCase()}`
        }
        const patch = {
          name,
          barcode: barcode || before?.barcode || code,
          categoryId,
          supplierId,
          cost: v.cost,
          price: v.price,
          minPrice: v.minPrice,
          reorderLevel: v.reorderLevel,
          maxStock: v.maxStock,
          taxable: /^Y/i.test(f.vat.trim()),
          trackStock: !/^N/i.test(f.type.trim()),
          active: f.active,
          updatedAt: Date.now(),
        }
        if (before) await db.products.update(before.id!, patch)
        else pid = (await db.products.add({ ...patch, sku: code, fitment: [], stock: 0, serialized: false, createdAt: Date.now() } as Product)) as number
        const values: Record<string, string> = {
          docNo: before?.sku ?? code,
          name,
          group: groupName,
          uom: f.uom.trim().toUpperCase(),
          packSize: (n(f.packSize) || 1).toFixed(2),
          type: /^N/i.test(f.type.trim()) ? 'N' : 'S',
          molecular: f.molecular.trim().toUpperCase() || 'NONE',
          productType: f.productType.trim().toUpperCase() || 'MEDICINE',
          supplier: supName,
          cost: c2(v.cost),
          markup: (n(f.markup) || 0).toFixed(2),
          retail: c2(v.price),
          whole: c2(v.whole),
          vat: /^Y/i.test(f.vat.trim()) ? 'YES' : f.vat.trim() ? 'NO' : '',
          date: f.date.replace(/\//g, '-'),
          user: user.name.toUpperCase(),
          minPrice: v.minPrice !== undefined ? c2(v.minPrice) : '',
          reorder: String(v.reorderLevel),
          maxStock: v.maxStock !== undefined ? String(v.maxStock) : '',
        }
        const after = (await db.products.get(pid!))!
        const doc = medicineDocFor(after, await db.docs.where('slug').equals(SLUG).toArray())
        // Keep what other screens recorded (e.g. Sell By from a supplier invoice).
        await saveDoc(SLUG, { ...(doc?.values ?? {}), ...values }, doc?.id, user.id)
      })
      toast(`${name} ${current !== undefined ? 'updated' : `saved as ${code}`}`)
      if (jasper)
        printSheet(
          `${d.companyName} — Medicine ${code}`,
          [
            ['Product Name', name],
            ['Product Group', groupName],
            ['Preffered Supplier', supName],
          ],
          ['Cost Rate', 'Retail', 'Whole sale', 'Min Price', 'Re-order', 'Max'],
          [[c2(v.cost), c2(v.price), c2(v.whole), v.minPrice !== undefined ? c2(v.minPrice) : '-', String(v.reorderLevel), v.maxStock !== undefined ? String(v.maxStock) : '-']],
          [],
        )
      if (sms) openSms(undefined, `${d.companyName}: ${name} now sells at KES ${c2(v.price)}.`)
      if (current === undefined) onClose()
      else setLoadedFor(undefined)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  useEntryKeys({ save: () => void save(), back: onClose })

  const editing = current !== undefined
  return (
    <div className="ma-panel-inner" style={{ paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px 18px', height: 32 }}>
        {editing ? (
          <>
            <span style={{ color: '#1a73c9', fontSize: 18 }}>➜</span>
            <span className="ma-title" style={{ color: '#1a73c9', fontSize: 13, minWidth: 90 }}>
              MEDICINE
            </span>
            <span className="ma-label" style={{ color: '#1a73c9', fontWeight: 'bold', marginLeft: 20 }}>
              Status :
            </span>
            <span className="ma-label" style={{ color: product?.active === false ? '#c00' : '#1a73c9', fontWeight: 'bold', minWidth: 60 }}>
              {product ? (product.active ? 'Active' : 'Inactive') : ''}
            </span>
            <IBtn bare title="Previous medicine" onClick={() => go(-1)}>
              <span style={{ color: '#1a73c9', fontSize: 16 }}>⬅</span>
            </IBtn>
            <IBtn bare title="Next medicine" onClick={() => go(1)}>
              <span style={{ color: '#1a73c9', fontSize: 16 }}>➡</span>
            </IBtn>
            <span className="ma-label" style={{ fontSize: 10 }}>
              {pos >= 0 ? `${pos + 1} of ${products.length}` : ''}
            </span>
            <span style={{ marginLeft: 24 }}>
              <Btn onClick={() => setPick('find')} title="Search for another medicine to edit">
                Search Medicine
              </Btn>
            </span>
          </>
        ) : (
          <>
            <span className="ma-title" style={{ minWidth: 140 }}>
              Medicine
            </span>
            <IBtn lg title="View the list" onClick={onClose}>
              <EyeIcon />
            </IBtn>
            <IBtn lg title="Clear the form" onClick={() => setF((x) => ({ ...blank(), code: x.code }))}>
              <RefreshGlyph />
            </IBtn>
            <span style={{ marginLeft: 24 }}>
              <Btn onClick={() => setPick('find')} title="Edit a medicine that is already in the list">
                Search Medicine
              </Btn>
            </span>
          </>
        )}
      </div>
      <SubTabs
        tabs={[
          { id: 'product', label: 'PRODUCT' },
          { id: 'detail', label: 'DETAIL' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'product' ? (
        <div style={{ ...panel, paddingTop: 40, display: 'flex', gap: 60 }}>
          <div className="ma-form" style={{ gridTemplateColumns: '130px 200px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
            <Field label="Product Code">
              <Input value={f.code || '(auto)'} readOnly width={100} />
            </Field>
            <Field label="Product Name">
              <input className="ma-input" style={{ width: 150 }} value={f.name} aria-label="Product Name" placeholder="Full name as it should print" onChange={(e) => set({ name: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Product Group">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 140 }} value={f.group} list="ma-med-groups" aria-label="Product Group" placeholder="e.g. SYRUPS" onChange={(e) => set({ group: e.target.value.toUpperCase() })} />
                <LookupBtn title="Pick a product group" onClick={() => setPick('group')} />
              </span>
            </Field>
            <Field label="UOM">
              <Input value={f.uom} onChange={(x) => set({ uom: x.toUpperCase() })} width={75} placeholder="ML, MG, TABS" />
            </Field>
            <Field label="Pack Size">
              <Input value={f.packSize} onChange={(x) => set({ packSize: x })} width={75} placeholder="1.00" />
            </Field>
            <Field label="Stock/Non-Stock">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 140 }} value={f.type} aria-label="Stock/Non-Stock" placeholder="S or N" onChange={(e) => set({ type: e.target.value.toUpperCase().slice(0, 1) })} />
                <LookupBtn title="S = stock item, N = non-stock" onClick={() => setPick('type')} />
              </span>
            </Field>
            <Field label="MOLECULOR NAME">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 140 }} value={f.molecular} list="ma-med-mol" aria-label="MOLECULOR NAME" placeholder="e.g. PARACETAMOL" onChange={(e) => set({ molecular: e.target.value.toUpperCase() })} />
                <LookupBtn title="Pick a molecular name" onClick={() => setPick('molecular')} />
              </span>
            </Field>
            <Field label="Product Type">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 140 }} value={f.productType} list="ma-med-ptype" aria-label="Product Type" placeholder="MEDICINE" onChange={(e) => set({ productType: e.target.value.toUpperCase() })} />
                <LookupBtn title="Pick a product type" onClick={() => setPick('productType')} />
              </span>
            </Field>
          </div>
          <div className="ma-form" style={{ gridTemplateColumns: '120px 200px', rowGap: 8, alignSelf: 'flex-start', alignContent: 'start' }}>
            <Field label="Preffered Supplier">
              <span style={{ display: 'inline-flex' }}>
                <input className="ma-input" style={{ width: 140 }} value={f.supplier} list="ma-med-sup" aria-label="Preffered Supplier" placeholder="Type or look up" onChange={(e) => set({ supplier: e.target.value.toUpperCase() })} />
                <LookupBtn title="Pick the supplier" onClick={() => setPick('supplier')} />
              </span>
            </Field>
            <Field label="Cost Rate">
              <input className="ma-input" style={{ width: 75, textAlign: 'right' }} value={f.cost} aria-label="Cost Rate" onChange={(e) => set({ cost: e.target.value, ...withMarkup(e.target.value, f.markup) })} />
            </Field>
            <Field label="Markup%">
              <input className="ma-input" style={{ width: 75, textAlign: 'right' }} value={f.markup} aria-label="Markup%" title="Retail = Cost Rate + Markup%" onChange={(e) => set({ markup: e.target.value, ...withMarkup(f.cost, e.target.value) })} />
            </Field>
            <Field label="Retail Sale Price">
              <input className="ma-input" style={{ width: 75, textAlign: 'right' }} value={f.retail} aria-label="Retail Sale Price" onChange={(e) => set({ retail: e.target.value, whole: f.whole === f.retail || n(f.whole) === 0 ? e.target.value : f.whole })} />
            </Field>
            <Field label="Best Price">
              <input
                className="ma-input"
                style={{ width: 75, textAlign: 'right' }}
                value={f.minPrice}
                aria-label="Best Price"
                placeholder="lowest"
                title="The lowest price it may be sold for (an amount, not %). Offer the Retail Sale Price first; if the customer complains, sell down to this — never below."
                onChange={(e) => set({ minPrice: e.target.value })}
              />
            </Field>
            <Field label="Whole sale price">
              <input className="ma-input" style={{ width: 75, textAlign: 'right' }} value={f.whole} aria-label="Whole sale price" onChange={(e) => set({ whole: e.target.value })} />
            </Field>
            <Field label="VAT ?">
              <input className="ma-input" style={{ width: 90 }} value={f.vat} aria-label="VAT ?" placeholder="YES / NO" onChange={(e) => set({ vat: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Date">
              <DateField value={f.date} onChange={(x) => set({ date: x })} />
            </Field>
            <Field label="User Name">
              <Input value={editing ? f.user || user?.name.toUpperCase() || '' : user?.name.toUpperCase() ?? ''} readOnly width={140} />
            </Field>
          </div>
          <datalist id="ma-med-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          <datalist id="ma-med-mol">{moleculars.map((g) => <option key={g} value={g} />)}</datalist>
          <datalist id="ma-med-ptype">{productTypes.map((g) => <option key={g} value={g} />)}</datalist>
          <datalist id="ma-med-sup">{suppliers.map((s) => <option key={s.id} value={s.name.toUpperCase()} />)}</datalist>
        </div>
      ) : (
        <div style={{ ...panel, paddingTop: 40 }}>
          <div className="ma-form" style={{ gridTemplateColumns: '150px 260px', rowGap: 8 }}>
            <Field label="Barcode">
              <Input value={f.barcode} onChange={(x) => set({ barcode: x.trim() })} width={150} placeholder="Scan or type (blank = code)" />
            </Field>
            <Field label="Re-order Level">
              <input className="ma-input" style={{ width: 90, textAlign: 'right' }} value={f.reorder} aria-label="Re-order Level" placeholder="e.g. 10" onChange={(e) => set({ reorder: e.target.value })} />
            </Field>
            <Field label="Max Level">
              <input className="ma-input" style={{ width: 90, textAlign: 'right' }} value={f.maxStock} aria-label="Max Level" placeholder="no limit" onChange={(e) => set({ maxStock: e.target.value })} />
            </Field>
            <Field label="Qty In Stock">
              <Input value={product ? String(product.stock) : '0'} readOnly width={90} />
            </Field>
            <Field label="Active">
              <Check checked={f.active} onChange={(x) => set({ active: x })} dark title="Untick to stop it being sold or ordered">
                can be sold
              </Check>
            </Field>
          </div>
          <div className="ma-label" style={{ marginTop: 18, marginLeft: 10, fontSize: 10, maxWidth: 620 }}>
            Best Price (PRODUCT tab): the lowest it may be sold for — nothing is sold below it, not by a lower price or any discount. Re-order Level: it shows on the To-Do list when stock falls to this. Max Level: the most to hold; re-orders top up to it.
            Stock is changed by GRNs, sales and Stock Adjust −/+, never typed here.
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingLeft: 200 }}>
        <Btn onClick={onClose}>Back (F3)</Btn>
        <Btn onClick={() => void save()} disabled={saving}>
          Save (F2)
        </Btn>
        <span style={{ width: 380 }} />
        <Check checked={jasper} onChange={setJasper} dark title="Print after saving">
          Jasper Print?
        </Check>
        <Check checked={sms} onChange={setSms} dark title="Open an SMS after saving">
          Send Sms
        </Check>
      </div>

      {pick === 'find' && (
        <ProductLookup
          products={products}
          title="Search Medicine"
          onClose={() => setPick(null)}
          onPick={(p) => {
            setPick(null)
            setTab('product')
            setCurrent(p.id)
          }}
        />
      )}
      {pick === 'group' && (
        <PickList
          title="Product Group"
          options={groups}
          addLabel="product group"
          onAdd={async (name) => {
            // A new group is saved straight away (shared by every chemist), then picked.
            if (!(await db.categories.toArray()).some((c) => c.name.toUpperCase() === name)) await db.categories.add({ name, color: '#607d8b' })
            set({ group: name })
            setPick(null)
            toast(`Product group ${name} added`)
          }}
          onClose={() => setPick(null)}
          onPick={(x) => (set({ group: x }), setPick(null))}
        />
      )}
      {pick === 'type' && <PickList title="Stock/Non-Stock" options={['S', 'N']} onClose={() => setPick(null)} onPick={(x) => (set({ type: x }), setPick(null))} />}
      {pick === 'molecular' && (
        <PickList title="MOLECULOR NAME" options={moleculars} addLabel="molecular name" onAdd={(x) => (set({ molecular: x }), setPick(null))} onClose={() => setPick(null)} onPick={(x) => (set({ molecular: x }), setPick(null))} />
      )}
      {pick === 'productType' && (
        <PickList title="Product Type" options={productTypes} addLabel="product type" onAdd={(x) => (set({ productType: x }), setPick(null))} onClose={() => setPick(null)} onPick={(x) => (set({ productType: x }), setPick(null))} />
      )}
      {pick === 'supplier' && (
        <PickList
          title="Preffered Supplier"
          options={suppliers.map((s) => s.name.toUpperCase())}
          addLabel="supplier"
          onAdd={async (name) => {
            if (!(await db.suppliers.toArray()).some((x) => x.name.toUpperCase() === name)) await db.suppliers.add({ name, notes: 'Added from the Medicine form' } as Supplier)
            set({ supplier: name })
            setPick(null)
            toast(`Supplier ${name} added to Party Master`)
          }}
          onClose={() => setPick(null)}
          onPick={(x) => (set({ supplier: x }), setPick(null))}
        />
      )}
    </div>
  )
}
