/**
 * Run a theme change inside a View Transition: the browser crossfades the
 * whole page as a snapshot, so text, gradients, and icons all fade in perfect
 * sync (per-element CSS transitions can't do this reliably). Falls back to an
 * instant swap where the API isn't supported.
 */
export function withThemeFade(change: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (doc.startViewTransition) doc.startViewTransition(change)
  else change()
}
