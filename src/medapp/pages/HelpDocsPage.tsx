import { useParams } from 'react-router-dom'

export interface HelpDoc {
  slug: string
  label: string
  title: string
  body: string[]
}

/** The HelpDocs of the legacy medapp, rewritten 1:1 in spirit. */
export const HELP_DOCS: HelpDoc[] = [
  {
    slug: 'about-emr-lite',
    label: 'About EMR-Lite',
    title: 'About EMR-Lite 9.5.21',
    body: [
      'EMR-Lite is the pharmacy point of sale used at every chemist of the company (CHEM1, CHEM2, …); each chemist sees its own medicines, sales and stock. It handles OTC medicine bills, medicine returns, service bills, whole-sale documents, party and services masters, and the daily store reports.',
      'The Continuous service version 9.5.21 runs entirely offline. All data lives on this computer; use Data Management to back it up.',
    ],
  },
  {
    slug: 'getting-started',
    label: 'Getting Started',
    title: 'Getting Started',
    body: [
      'Log on with your 4 digit PIN at the opening screen. The owner PIN unlocks every module; staff PINs unlock the retail pages.',
      'Start a sale from the POS page. Park a bill with SP and recall it from the parked list. Complete the payment and the receipt prints.',
      'Use Modules > OTC Medicine Issued/Bill for the classic day register, and Whole Sales for quotations, delivery notes and invoices.',
    ],
  },
  {
    slug: 'daily-sales',
    label: 'Daily Sales',
    title: 'Daily Sales',
    body: [
      'The Day register (Modules > OTC Medicine Issued/Bill) lists every bill raised at the till with its payable-by split.',
      'Returns are recorded as refund bills: the amount is stored negative and stock is given back automatically.',
      'Close the day with Shift > Close Day. Count the drawer, the excess or shortage is written on the Z report.',
    ],
  },
  {
    slug: 'reports',
    label: 'Reports',
    title: 'Reports',
    body: [
      'The Reports tab holds the Report List tree (Account Statement, OS Debtor/Creditor, ageing, cash collection, Expiary Medicinies, OTC Medicine Issue) and 19 analysis reports.',
      'Every report has a left-hand filter panel with a search and a greyed Options panel; press the magnifier or blue View button to run it, then Print, Export or Mail the result.',
      'Month-Wise, MIS Location-wise and ABC Analysis also draw a column chart; use Zoomin / Zoomout beside the chart.',
    ],
  },
  {
    slug: 'utilities',
    label: 'Utilities',
    title: 'Utilities',
    body: [
      'Utilities groups the maintenance screens: Auto Generate and Auto Indent draft purchase orders; Force To Close Transaction cancels open LPOs and service jobs; ReGenerate Link Transaction copies a quotation into a delivery note or invoice.',
      'User Management creates staff profiles with a 4 digit password; Data Management backs up or restores the whole database; Auto Number Reset sets the running numbers.',
      'OffLine/OnLine Synchronization Uploads products to the server or Downloads them back. Run a backup before any synchronisation.',
    ],
  },
  {
    slug: 'keyboard-shortcuts',
    label: 'Keyboard Shortcuts',
    title: 'Keyboard Shortcuts',
    body: [
      'F2 - focus the quick search of the current screen.       Escape - close the open dialog.',
      'Enter - accept the value you typed in a lookup field.   Double-click - open the selected record.',
      'F8 - park the current bill.      F9 - recall a parked bill in the POS.',
    ],
  },
  {
    slug: 'troubleshooting',
    label: 'Troubleshooting',
    title: 'Troubleshooting',
    body: [
      'A green tick beside a bill means stock could be given; a red cross means the item is short - check Settings > Stock.',
      'If the till shows no login users after an update, restore from your last Data Management backup; profiles live here, not only on the server.',
      'Slow printing - set paper width 80mm in Settings and try again. The print engine is local; no network is required.',
    ],
  },
]

export default function HelpDocsPage() {
  const { slug } = useParams()
  const doc = HELP_DOCS.find((d) => d.slug === slug) ?? HELP_DOCS[0]
  return (
    <div className="ma-help">
      <div className="ma-help-head">
        <span className="ma-report-name">HelpDocs</span>
        <span className="ma-title" style={{ marginLeft: 14 }}>
          {doc.title}
        </span>
      </div>
      {doc.body.map((p) => (
        <p key={p.slice(0, 24)} className="ma-help-p">
          {p}
        </p>
      ))}
    </div>
  )
}
