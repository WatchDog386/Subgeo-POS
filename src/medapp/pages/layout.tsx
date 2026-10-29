import type { CSSProperties, ReactNode } from 'react'

/**
 * Absolute placement helper. Coordinates are measured from the legacy
 * screenshots relative to the top-left corner of the white work panel.
 * `y` is the vertical centre of the element unless `top` is set.
 */
export function At({
  x,
  y,
  top,
  center,
  right,
  children,
  style,
}: {
  x: number
  y: number
  top?: boolean
  center?: boolean
  right?: boolean
  children: ReactNode
  style?: CSSProperties
}) {
  const tx = center ? '-50%' : right ? '-100%' : '0'
  const ty = top ? '0' : '-50%'
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(${tx}, ${ty})`,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** Positioned canvas for a legacy form page. */
export function Canvas({ height, children, width = 1010 }: { height: number; width?: number; children: ReactNode }) {
  return <div style={{ position: 'relative', height, minWidth: width }}>{children}</div>
}

export function Title({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <At x={x} y={y} center>
      <span className="ma-title">{children}</span>
    </At>
  )
}

export function L({ children, green, bold }: { children: ReactNode; green?: boolean; bold?: boolean }) {
  return <span className={bold ? 'ma-bold-label' : green ? 'ma-green-label' : 'ma-label'}>{children}</span>
}
