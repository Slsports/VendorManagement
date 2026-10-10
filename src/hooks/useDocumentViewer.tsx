import { useState } from 'react'
import { DocumentViewer, type ViewerDoc } from '@/components/shared/DocumentViewer'

/** One viewer per screen: `view(doc)` opens it, `viewer` is the element to render. */
export function useDocumentViewer() {
  const [doc, setDoc] = useState<ViewerDoc | null>(null)
  return { view: setDoc, viewer: doc ? <DocumentViewer doc={doc} onClose={() => setDoc(null)} /> : null }
}
