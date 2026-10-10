import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reloadOnNewVersion } from './reloadOnNewVersion'

function fakeWindow() {
  const target = new EventTarget()
  const reload = vi.fn()
  const win = Object.assign(target, { sessionStorage: window.sessionStorage, location: { reload } }) as unknown as Window
  return { win, reload }
}

const fire = (win: Window) => {
  const event = new Event('vite:preloadError', { cancelable: true })
  win.dispatchEvent(event)
  return event
}

describe('reloadOnNewVersion', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('reloads once when a page piece is missing after an update', () => {
    const { win, reload } = fakeWindow()
    reloadOnNewVersion(win, () => 100_000)
    expect(fire(win).defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not loop when the reload just happened', () => {
    const { win, reload } = fakeWindow()
    let t = 100_000
    reloadOnNewVersion(win, () => t)
    fire(win)
    t += 2_000
    expect(fire(win).defaultPrevented).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads again for a later update', () => {
    const { win, reload } = fakeWindow()
    let t = 100_000
    reloadOnNewVersion(win, () => t)
    fire(win)
    t += 60_000
    fire(win)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
