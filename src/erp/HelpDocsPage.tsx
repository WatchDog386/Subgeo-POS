import { ErpPanel } from './piLists'
import { APP_VERSION } from './config'

// HelpDocs: the Document Center — a typed list of documents exactly like the
// old medapp (User / Type / Description / Attachment columns).

interface Doc {
  user: string
  type: string
  description: string
  attachment: string
}

const DOCS: Doc[] = [
  { user: 'admin', type: 'Product Summary', description: 'Medicines and services master — codes, prices, bins, reorder levels.', attachment: 'products-summary-v9.5.21' },
  { user: 'admin', type: 'Transaction Summary', description: 'All module documents — OTC bills, wholesales, credit notes, GRN.', attachment: 'transactions-summary-v9.5.21' },
  { user: 'admin', type: 'User Guide', description: 'Daily operations: till shifts, refunds, reports, utilities.', attachment: 'user-guide-v9.5.21' },
  { user: 'admin', type: 'Hardware Setup', description: 'Receipt printer 80mm, barcode printer, cash drawer, M-Pesa STK.', attachment: 'hardware-setup-v9.5.21' },
  { user: 'admin', type: 'Keyboard Shortcuts', description: 'F-keys and shortcuts used on sale screens and report pickers.', attachment: 'shortcuts-v9.5.21' },
  { user: 'admin', type: 'Report Guide', description: 'Report List, Month-Wise, Stock, ABC, Ageing, Audit Trail templates.', attachment: 'reports-guide-v9.5.21' },
]

export default function ErpHelpDocsPage() {
  return (
    <ErpPanel title="HelpDocs - Document Center">
      <div className="overflow-x-auto rounded-sm border border-slate-300 bg-white shadow-sm">
        <table className="w-full border-collapse text-[13px] text-slate-700">
          <thead>
            <tr className="bg-[#dcdcd2] text-left text-[12px] font-semibold text-[#2c2a27]">
              <th className="w-10 border-b border-slate-300 px-2 py-2 text-center">
                <input type="checkbox" className="h-4 w-4 accent-[#3b74b8]" />
              </th>
              <th className="border-b border-slate-300 px-2 py-1.5">User</th>
              <th className="border-b border-slate-300 px-2 py-1.5">Type</th>
              <th className="border-b border-slate-300 px-2 py-1.5">Description</th>
              <th className="border-b border-slate-300 px-2 py-1.5">Attachment</th>
            </tr>
          </thead>
          <tbody>
            {DOCS.map((d, i) => (
              <tr key={d.type} className={`border-b border-[#d6d2c8] ${i % 2 ? 'bg-white' : 'bg-[#f0ede2]'}`}>
                <td className="px-2 py-1.5 text-center">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-[#3b74b8]" />
                </td>
                <td className="px-2 py-1.5">{d.user}</td>
                <td className="px-2 py-1.5 font-semibold">{d.type}</td>
                <td className="px-2 py-1.5 text-slate-500">{d.description}</td>
                <td className="px-2 py-1.5 font-mono text-[12px] text-[#3b74b8]">{d.attachment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-1 py-1.5 text-slate-600">
        {['View', 'New Doc', 'Add Attachment', 'Delete', 'Checkin', 'Checkout', 'Save'].map((a) => (
          <button key={a} type="button" className="rounded-sm bg-gradient-to-b from-[#f6b352] to-[#e08c1a] px-2.5 py-1 text-[11px] font-bold text-slate-900 shadow-sm transition hover:brightness-105 active:scale-95">
            {a}
          </button>
        ))}
        <span className="ml-auto text-[11px] font-semibold">| {DOCS.length} rows retrieved |</span>
      </div>
      <p className="px-1 text-[12px] text-slate-500">
        Documents travel with the app build ({APP_VERSION}); new attachments added here are stored
        with the shop database.
      </p>
    </ErpPanel>
  )
}
