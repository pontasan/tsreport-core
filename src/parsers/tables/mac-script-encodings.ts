/**
 * Published classic Macintosh script-code mappings which are not part of the
 * Unicode Consortium's Apple mapping set. The Georgian and Armenian tables
 * are the mappings registered for Script Manager codes 23 and 24 by their
 * original author, Michael Everson.
 */
const MAC_SCRIPT_HIGH_BYTES: Readonly<Record<number, string>> = {
  23: 'ႠႡႢႣႤႥႦႧႨႩႪႫႬႭႮႯႰႱႲႳႴႵႶႷႸႹႺႻႼႽႾႿ†°¢£§•¶̣®©™́̈≠ჁჂ∞±≤≥¥µ∂∑Ⴥჵ∫ჶჸჷჱჲ̆̄¬√ƒ≈∆«»… Ⴠჰ჻Ⴣჳ–—“”‘’÷„Ⴤჴ⁄€‹›№ჯაბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხ։',
  24: 'ԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐ†°¢£§•¶և®©™՛՝≠՚Ւ∞±≤≥¥µ∂∑ՕօՖֆ❀Ωπւ՞՜¬√ƒ≈∆«»… Ցց՟Փփ–—“”‘’÷„Քք★€‹›№րաբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտ։',
}

export function hasMacScriptEncoding(encodingId: number): boolean {
  return MAC_SCRIPT_HIGH_BYTES[encodingId] !== undefined
}

export function decodeMacScriptName(bytes: Uint8Array, encodingId: number): string {
  const highBytes = MAC_SCRIPT_HIGH_BYTES[encodingId]
  if (highBytes === undefined) throw new Error(`No Mac script table for encoding ${encodingId}`)
  let value = ''
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!
    value += byte < 0x80 ? String.fromCharCode(byte) : highBytes.charAt(byte - 0x80)
  }
  return value
}
