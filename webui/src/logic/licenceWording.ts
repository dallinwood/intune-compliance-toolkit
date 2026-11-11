// "licensed CC0 1.0 (public domain)" reads oddly for a work that is not
// licensed in the usual sense, so a public-domain dedication is credited
// "under" it. Every other licence keeps "licensed".
export function licenceLeadIn(licenceName: string): 'under' | 'licensed' {
  return licenceName.toLowerCase().includes('public domain') ? 'under' : 'licensed'
}
