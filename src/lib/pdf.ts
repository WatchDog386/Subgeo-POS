import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

export interface ParsedMedicine {
  name: string
  sku?: string
  barcode?: string
  brand?: string
  category?: string
  cost?: number
  price?: number
  stock?: number
  reorderLevel?: number
  location?: string
  taxable?: boolean
  serialized?: boolean
  trackStock?: boolean
}

export async function parsePdf(file: File): Promise<ParsedMedicine[]> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = (await pdfjsLib.getDocument({ data: arrayBuffer }).promise) as PDFDocumentProxy
  const medicines: ParsedMedicine[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const items = content.items as Array<{ str: string; dir?: string; transform?: number[] }>
    const text = items.map((it) => it.str).join(' ')
    const lines = normalizeText(text).split(/\n+/)

    for (const line of lines) {
      const m = line.match(/^(.+?)\s+([A-Z0-9][A-Z0-9\-]{3,})\s+([\d,.]+)\s+([\d,.]+)\s*(\d+)?\s*$/)
      if (!m) continue
      medicines.push({
        name: m[1].trim(),
        sku: m[2],
        price: parseFloat(m[4].replace(/,/g, '')),
        cost: parseFloat(m[3].replace(/,/g, '')),
        stock: m[5] ? parseInt(m[5], 10) : 0,
        reorderLevel: 2,
        taxable: true,
        serialized: false,
        trackStock: true,
      })
    }
  }

  return medicines
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
