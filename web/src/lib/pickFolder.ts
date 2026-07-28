/**
 * Choosing a folder to *send*.
 *
 * `<input webkitdirectory>` makes the browser read the entire tree up front and
 * then asks "upload N files to this site?" — and Chrome flatly refuses for
 * anything it considers sensitive. The File System Access picker instead hands
 * back a directory handle we enumerate ourselves, with no upload confirmation.
 *
 * Neither can get past Chrome's protection of genuinely sensitive locations
 * (your home directory, system folders) — that's a permission decision made
 * before any file is readable, so no amount of repackaging avoids it. Dropping
 * the folder onto the page is the way through: a drag is its own grant and goes
 * through a different path entirely.
 */

import { makeFolderItem, type FolderEntry } from './files'

interface FsFileHandleRead {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}

interface FsDirHandleRead {
  kind: 'directory'
  name: string
  values(): AsyncIterableIterator<FsFileHandleRead | FsDirHandleRead>
}

type Picker = {
  showDirectoryPicker?: (opts?: {
    mode?: 'read' | 'readwrite'
    id?: string
    startIn?: string
  }) => Promise<FsDirHandleRead>
}

const picker = window as unknown as Picker

export const canPickFolderHandle = typeof picker.showDirectoryPicker === 'function'

/** Depth guard — a symlink loop would otherwise recurse forever. */
const MAX_DEPTH = 24

async function walk(
  dir: FsDirHandleRead,
  prefix: string,
  depth: number,
  out: FolderEntry[]
): Promise<void> {
  if (depth > MAX_DEPTH) return
  let sinceYield = 0
  for await (const child of dir.values()) {
    if (child.kind === 'file') {
      out.push({ file: await child.getFile(), path: prefix + child.name })
    } else {
      await walk(child, `${prefix}${child.name}/`, depth + 1, out)
    }
    // keep the page responsive while a big tree is enumerated
    if (++sinceYield >= 200) {
      sinceYield = 0
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}

/**
 * Shown when the browser blocklists the chosen folder. Callers can compare
 * against this to switch the UI over to the drag & drop route.
 */
export const BLOCKED_MESSAGE =
  "Chrome won't open that folder — it blocks a fixed list of locations, which on a Mac includes anything inside Library (where iCloud keeps a synced Desktop and Documents)."

export class FolderPickError extends Error {
  /** true when the user simply closed the picker — not worth reporting */
  readonly cancelled: boolean
  constructor(message: string, cancelled: boolean) {
    super(message)
    this.cancelled = cancelled
  }
}

/**
 * Ask for a folder and read it into a single staged item. Must be called from a
 * click handler (the picker needs the user activation).
 *
 * Throws FolderPickError — `cancelled` distinguishes "changed their mind" from
 * "the browser wouldn't allow it", which the caller surfaces differently.
 */
export async function pickFolderToSend(): Promise<File> {
  if (!picker.showDirectoryPicker) {
    throw new FolderPickError('This browser has no folder picker.', false)
  }
  let dir: FsDirHandleRead
  try {
    dir = await picker.showDirectoryPicker({ mode: 'read', id: 'webshare-send' })
  } catch (err) {
    const name = (err as DOMException)?.name
    if (name === 'AbortError') throw new FolderPickError('Cancelled.', true)
    // Chrome refuses a fixed list of locations ("contains system files") rather
    // than actually inspecting the folder. Notably that list includes
    // ~/Library, which is where macOS puts Desktop and Documents once iCloud
    // Drive syncs them — so ordinary folders get caught by it. Drag & drop uses
    // a different API that isn't blocklisted, so send people there.
    throw new FolderPickError(BLOCKED_MESSAGE, false)
  }

  const entries: FolderEntry[] = []
  try {
    await walk(dir, '', 0, entries)
  } catch {
    throw new FolderPickError(
      "Couldn't read that folder. Try dragging it onto the page instead.",
      false
    )
  }
  if (entries.length === 0) {
    throw new FolderPickError('That folder is empty — there\'s nothing to send.', false)
  }
  return makeFolderItem(dir.name, entries)
}
