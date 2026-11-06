import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
import { parseInvoiceText, type ParsedInvoice, type TextItem } from './invoiceParse'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

/** The positioned text of every page of a PDF. */
export async function pdfText(file: File): Promise<TextItem[][]> {
  const pdf = (await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise) as PDFDocumentProxy
  const pages: TextItem[][] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent()
    pages.push(
      (content.items as Array<{ str?: string; transform?: number[] }>)
        .filter((it) => typeof it.str === 'string' && it.transform)
        .map((it) => ({ x: it.transform![4], y: it.transform![5], str: it.str! })),
    )
  }
  return pages
}

/** Read a supplier invoice / proforma / sales order PDF. */
export async function readInvoicePdf(file: File): Promise<ParsedInvoice & { textChars: number }> {
  const pages = await pdfText(file)
  // How much text the PDF holds: none at all means a scanned picture.
  const textChars = pages.reduce((n, p) => n + p.reduce((m, t) => m + t.str.trim().length, 0), 0)
  return { ...parseInvoiceText(pages), textChars }
}

export interface ParsedMedicine {
  name: string
  sku?: string
  barcode?: string
  brand?: string
  category?: string
  /** Unit cost on the invoice, KES. */
  cost?: number
  price?: number
  /** Quantity on the invoice (received). */
  stock?: number
  reorderLevel?: number
  location?: string
  taxable?: boolean
  serialized?: boolean
  trackStock?: boolean
}

/** Item lines of a supplier PDF as medicines (Inventory → Import PDF). */
export async function parsePdf(file: File): Promise<ParsedMedicine[]> {
  const inv = await readInvoicePdf(file)
  return inv.lines.map((l) => ({ name: l.name.toUpperCase(), sku: l.code, cost: l.unitPrice, stock: l.qty, trackStock: true, serialized: false }))
}

export function medicineToCsvRow(m: ParsedMedicine): (string | number | undefined)[] {
  return [
    m.sku ?? '',
    m.name,
    m.barcode ?? '',
    '',
    m.category ?? '',
    m.brand ?? '',
    m.cost ?? 0,
    m.price ?? 0,
    m.stock ?? 0,
    m.reorderLevel ?? 0,
    m.location ?? '',
    m.taxable ?? true ? 1 : 0,
    m.serialized ?? false ? 1 : 0,
    m.trackStock ?? true ? 1 : 0,
  ]
}
