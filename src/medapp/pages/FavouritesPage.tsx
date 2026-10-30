import { useEffect, useState } from 'react'
import { useToast } from '../../components/ui'
import { setKv, useFavourites, type Favourite } from '../data'
import { TRANSACTIONS } from '../nav'
import { Btn, Check, TransferArrows } from '../ui'
import { ADMIN_FAVOURITE_CATALOGUE } from '../nav-admin'

/** Modules → FAVOURITES → "Set Favorites" (screenshot 11.27.37 (1)). Admin uses its own catalogue (14.40.06 (11)). */
export default function FavouritesPage({ admin }: { admin?: boolean }) {
  const toast = useToast()
  const stored = useFavourites()
  const [favs, setFavs] = useState<Favourite[]>(stored)
  const [leftSel, setLeftSel] = useState<Set<string>>(new Set())
  const [rightSel, setRightSel] = useState<Set<string>>(new Set())
  useEffect(() => setFavs(stored), [stored])

  const labels = admin ? [...ADMIN_FAVOURITE_CATALOGUE] : [...new Set(TRANSACTIONS.map((t) => t.label))]
  const ordered = admin ? labels : [...ADMIN_FAVOURITE_CATALOGUE.filter((l) => labels.includes(l)), ...labels.filter((l) => !ADMIN_FAVOURITE_CATALOGUE.includes(l))]
  const left = ordered.filter((l) => !favs.some((f) => f.label === l))

  const toggle = (set: Set<string>, v: string, apply: (s: Set<string>) => void) => {
    const n = new Set(set)
    if (n.has(v)) n.delete(v)
    else n.add(v)
    apply(n)
  }

  return (
    <div style={{ padding: '10px 6px 6px', height: '100%', minWidth: 960 }}>
      <div className="ma-subtabs" style={{ paddingLeft: 4 }}>
        <span className="ma-subtab is-active">Set Favorites</span>
      </div>
      <div className="ma-box" style={{ borderTop: 0, height: 'calc(100% - 26px)', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 42, top: 52, display: 'flex', alignItems: 'center', gap: 42 }}>
          <div className="ma-listbox" style={{ width: 270, height: 298, background: '#f6f5ef' }}>
            {left.map((l) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 26, padding: '0 2px' }}>
                <Check checked={leftSel.has(l)} onChange={() => toggle(leftSel, l, setLeftSel)} />
                <span className="ma-label" style={{ cursor: 'pointer' }} onClick={() => toggle(leftSel, l, setLeftSel)}>
                  {l}
                </span>
              </div>
            ))}
          </div>
          <TransferArrows
            gap={6}
            onRight={() => {
              setFavs([...favs, ...[...leftSel].map((label) => ({ label, home: true, sidebar: true }))])
              setLeftSel(new Set())
            }}
            onLeft={() => {
              setFavs(favs.filter((f) => !rightSel.has(f.label)))
              setRightSel(new Set())
            }}
          />
          <div className="ma-listbox" style={{ width: 538, height: 298, background: '#f6f5ef' }}>
            {favs.map((f, i) => (
              <div key={f.label} style={{ display: 'flex', alignItems: 'center', height: 26, padding: '0 2px' }}>
                <Check checked={rightSel.has(f.label)} onChange={() => toggle(rightSel, f.label, setRightSel)} />
                <span className="ma-label" style={{ width: 164, marginLeft: 10 }}>
                  {f.label}
                </span>
                <span title="Show on Home" style={{ marginRight: 8 }}>
                  <Check checked={f.home} dark onChange={(v) => setFavs(favs.map((x, j) => (j === i ? { ...x, home: v } : x)))} />
                </span>
                <span title="Show in Favourites">
                  <Check checked={f.sidebar} dark onChange={(v) => setFavs(favs.map((x, j) => (j === i ? { ...x, sidebar: v } : x)))} />
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 694, display: 'flex', justifyContent: 'center' }}>
          <Btn
            onClick={async () => {
              await setKv('medapp:favourites', favs)
              toast('Favorites saved')
            }}
          >
            Save
          </Btn>
        </div>
      </div>
    </div>
  )
}
