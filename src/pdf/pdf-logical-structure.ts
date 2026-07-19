/** Shared PDF 2.0 logical-structure namespace semantics. */

export const DEFAULT_STRUCTURE_NAMESPACE = 'http://iso.org/pdf/ssn'
export const PDF_20_STRUCTURE_NAMESPACE = 'http://iso.org/pdf2/ssn'

export const PDF_17_STRUCTURE_ROLES = new Set([
  'Document', 'Part', 'Art', 'Sect', 'Div', 'BlockQuote', 'Caption', 'TOC', 'TOCI', 'Index', 'NonStruct', 'Private',
  'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'L', 'LI', 'Lbl', 'LBody',
  'Table', 'TR', 'TH', 'TD', 'THead', 'TBody', 'TFoot',
  'Span', 'Quote', 'Note', 'Reference', 'BibEntry', 'Code', 'Link', 'Annot',
  'Ruby', 'RB', 'RT', 'RP', 'Warichu', 'WT', 'WP', 'Figure', 'Formula', 'Form',
])

export const PDF_20_STANDARD_STRUCTURE_ROLES = new Set([
  'Document', 'DocumentFragment', 'Part', 'Div', 'Aside', 'Caption',
  'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'Title', 'FENote',
  'L', 'LI', 'Lbl', 'LBody', 'Table', 'TR', 'TH', 'TD', 'THead', 'TBody', 'TFoot',
  'Span', 'Sub', 'Em', 'Strong', 'Link', 'Annot', 'Ruby', 'RB', 'RT', 'RP',
  'Warichu', 'WT', 'WP', 'Figure', 'Formula', 'Form', 'Artifact',
])

export const STANDARD_STRUCTURE_ROLES = new Set([...PDF_17_STRUCTURE_ROLES, ...PDF_20_STANDARD_STRUCTURE_ROLES])

export function isHeadingRole(role: string): boolean {
  return /^H[1-9][0-9]*$/.test(role)
}

export function isDefaultStructureRole(role: string): boolean {
  return PDF_17_STRUCTURE_ROLES.has(role)
}

export function isPdf20StructureRole(role: string): boolean {
  return PDF_20_STANDARD_STRUCTURE_ROLES.has(role) || isHeadingRole(role)
}

export function isPdf20OnlyStructureRole(role: string): boolean {
  return isPdf20StructureRole(role) && !isDefaultStructureRole(role)
}
