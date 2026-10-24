// Help on every page (Dana, Oct 21): "a small help button … so I can be working in an area and click on the help and it
// tells me about the page I am working on." Each part of VMS names its help: articles first, then whole sections.
import type { HelpArticle } from './help'

interface PageHelp { name: string; slugs?: string[]; sections?: string[] }

// most specific first: the first path that matches wins
const PAGES: [RegExp, PageHelp][] = [
  [/^\/$/, { name: 'the Dashboard', sections: ['Dashboard'] }],
  [/^\/vendors\/import-documents/, { name: 'Import vendor folders', slugs: ['documents--bulk-import-vendor-folders'], sections: ['Documents'] }],
  [/^\/vendors\/confirmations/, { name: 'Vendor confirmations', sections: ['Vendors'] }],
  [/^\/vendors\/[^/]+\/edit/, { name: 'Editing a vendor', slugs: ['vendors--edit-a-vendor', 'vendors--set-ordering-windows', 'vendors--vendor-flags', 'vendors--shipping-and-freight-settings'], sections: ['Vendors'] }],
  [/^\/vendors\/[^/]+/, { name: 'a vendor page', slugs: ['vendors--read-a-vendor-page'], sections: ['Vendors', 'Ordering', 'Documents'] }],
  [/^\/vendors/, { name: 'Vendors', sections: ['Vendors'] }],
  [/^\/orders\/paperwork/, { name: 'Order paperwork', sections: ['Order paperwork'] }],
  [/^\/orders\/[^/]+/, { name: 'an order', sections: ['Orders', 'Order paperwork'] }],
  [/^\/(orders|purchase-orders|shipments|returns)/, { name: 'Orders', sections: ['Orders'] }],
  [/^\/ls-pos/, { name: 'LS POs', slugs: ['ordering--ls-po', 'orders--our-po-number', 'settings--ls-po-reviewers'], sections: ['Ordering'] }],
  [/^\/item-names/, { name: 'Item names', slugs: ['ordering--clean-up-item-names', 'orders--vendor-id-in-item-names'], sections: ['Ordering'] }],
  [/^\/freight/, { name: 'Freight', sections: ['Freight'] }],
  [/^\/payments/, { name: 'Payments', sections: ['Payments'] }],
  [/^\/(sales-reports|reports|inventory-counts)/, { name: 'Reports', sections: ['Reports'] }],
  [/^\/review/, { name: 'the Review queue', sections: ['Review queue'] }],
  [/^\/mail/, { name: 'Mail', sections: ['Mail'] }],
  [/^\/supplies/, { name: 'Supplies', slugs: ['tasks--supplies'], sections: ['Tasks'] }],
  [/^\/tasks/, { name: 'Tasks', sections: ['Tasks'] }],
  [/^\/team/, { name: 'the Team page', slugs: ['getting-started--team-page'], sections: ['Settings'] }],
  [/^\/upload/, { name: 'Invoice Uploads', slugs: ['getting-started--invoice-uploads'] }],
  [/^\/search/, { name: 'Search', slugs: ['getting-started--search'] }],
  [/^\/(rep-groups|lines|contacts|buying-shows)/, { name: 'Rep groups & lines', sections: ['Rep groups & lines'] }],
  [/^\/files/, { name: 'Files', sections: ['Documents'] }],
  [/^\/accounting/, { name: 'Accounting', sections: ['Accounting'] }],
  [/^\/settings/, { name: 'Settings', sections: ['Settings'] }],
]

/** The help for the page at `path`: what to call it and its articles, the named ones first. */
export function helpForPage(articles: HelpArticle[], path: string): { name: string; articles: HelpArticle[] } {
  const page = PAGES.find(([re]) => re.test(path))?.[1] ?? { name: 'this page', sections: ['Getting started'] }
  const named = (page.slugs ?? []).map((s) => articles.find((a) => a.slug === s)).filter((a): a is HelpArticle => !!a)
  const rest = articles.filter((a) => (page.sections ?? []).includes(a.section) && !named.includes(a))
    .sort((x, y) => (page.sections ?? []).indexOf(x.section) - (page.sections ?? []).indexOf(y.section) || x.title.localeCompare(y.title))
  return { name: page.name, articles: [...named, ...rest] }
}
