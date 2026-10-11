import { useEffect, useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { signedFileUrl, signedThumbUrl } from '@/services/lines'
import { cn } from '@/lib/utils'

/**
 * A preview of a stored picture (Dana, Oct 10: "make anything that is an image in a folder show a preview of
 * the image and I can click on it to enlarge it"). A small version when the server can make one, else the file.
 */
export function FileThumb({ path, name, onOpen, className }: { path: string; name: string; onOpen: () => void; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [plain, setPlain] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    ;(plain ? signedFileUrl(path) : signedThumbUrl(path)).then((u) => { if (live) setSrc(u) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [path, plain])
  return (
    <button type="button" onClick={onOpen} title={`Enlarge ${name}`} aria-label={`Enlarge ${name}`}
      className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-100 hover:border-brand', className)}>
      {failed ? <ImageIcon className="size-5 text-stone-400" aria-hidden="true" />
        : src ? <img src={src} alt={name} loading="lazy" className="size-full object-contain" onError={() => (plain ? setFailed(true) : setPlain(true))} />
          : <span className="size-full animate-pulse" />}
    </button>
  )
}
