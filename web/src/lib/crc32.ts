/**
 * CRC32 over the bytes of a file, used to prove a transfer arrived intact.
 *
 * Not a cryptographic hash and not meant to be: the peer could always send
 * different bytes and hash them honestly, so there is nothing to defend
 * against. What this catches is accidental damage — a chunk written at the
 * wrong offset, a file closed early, a disk write that silently failed — and
 * for that a CRC is both sufficient and fast enough to run over a large file on
 * a phone. SubtleCrypto would be slower and, more importantly, has no streaming
 * interface, so it would mean holding the whole file in memory.
 */

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

/** Feed bytes in order; pass the previous result back in to continue. */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0
  for (let i = 0; i < bytes.length; i++) c = (TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

/** CRC of a whole Blob, read in slices so nothing large is held in memory. */
export async function crc32Blob(blob: Blob, sliceSize = 4 * 1024 * 1024): Promise<number> {
  let sum = 0
  for (let off = 0; off < blob.size; off += sliceSize) {
    const part = await blob.slice(off, off + sliceSize).arrayBuffer()
    sum = crc32(new Uint8Array(part), sum)
    // let the UI breathe between slices on a slow device
    await new Promise((r) => setTimeout(r, 0))
  }
  return sum
}
