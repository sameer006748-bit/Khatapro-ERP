export type PageHelp = {
  title: string
  body: string
}

export const PAGE_HELP: Readonly<Record<string, PageHelp>> = {
  home: {
    title: 'Home',
    body: 'Home summarizes the business information available to your role. Use the period selector where shown to review a different date range.',
  },
  'counter-sale': {
    title: 'Counter Sale',
    body: 'Use Counter Sale for walk-in transactions. Add products, enter sold or returned quantities, select payment, and review the bill before posting.',
  },
  'online-sale': {
    title: 'Online Sale',
    body: 'Use Online Sale for customer orders that may include delivery, cash on delivery, advance payment and rider assignment.',
  },
  'ofc-sale': {
    title: 'Out-of-City Sale',
    body: 'Use this page for orders being sent outside the local delivery workflow, while keeping customer, payment and dispatch details together.',
  },
  'sales-list': {
    title: 'Sales List',
    body: 'Review posted sales, open invoice details and start supported follow-up actions from the original transaction.',
  },
  delivery: {
    title: 'Deliveries & Riders',
    body: 'Assign eligible orders, record delivery or return outcomes, and review rider cash still awaiting settlement.',
  },
  purchases: {
    title: 'Purchases',
    body: 'Record stock received from a vendor, enter payment details and review purchase or return activity.',
  },
  accounts: {
    title: 'Accounts & Balances',
    body: 'Review the balances and recent activity of the business accounts available to your role.',
  },
  'petty-cash': {
    title: 'Petty Cash',
    body: 'Review small day-to-day cash activity and record supported petty-cash movements.',
  },
  'contra-entry': {
    title: 'Contra',
    body: 'Use Contra to move money between business accounts or record Owner Drawings through the supported workflow.',
  },
  inventory: {
    title: 'Products & Stock',
    body: 'Manage products, categories, current quantities and supported stock adjustments from one inventory workspace.',
  },
  'day-book': {
    title: 'Day Book',
    body: 'Review dated business entries in one list and open a voucher when you need its full details.',
  },
  'ledger-drilldown': {
    title: 'Ledger',
    body: 'Ledger shows the transaction history and running balance of the selected account.',
  },
  'trial-balance': {
    title: 'Trial Balance',
    body: 'Trial Balance shows account debit and credit balances so you can review whether the books remain balanced.',
  },
  coa: {
    title: 'Chart of Accounts',
    body: 'Review how business assets, liabilities, equity, income and expenses are organized for accounting.',
  },
  reports: {
    title: 'Financial Reports',
    body: 'Use these reports to review business performance and financial position for the selected period.',
  },
  users: {
    title: 'Users & Roles',
    body: 'Invite team members and assign the role that matches each person’s responsibilities.',
  },
  permissions: {
    title: 'Roles & Permissions',
    body: 'Review what each role can view or manage. Owner access remains protected.',
  },
}

export function getPageHelp(pageKey: string): PageHelp | null {
  return PAGE_HELP[pageKey] ?? null
}
