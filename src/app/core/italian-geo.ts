export function normalizeGeoText(value: string): string {
  return `${value || ''}`
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

const PROVINCE_NAME_TO_CODE: Record<string, string> = {
  'agrigento': 'AG', 'alessandria': 'AL', 'ancona': 'AN', 'aosta': 'AO', 'valle d aosta': 'AO',
  'arezzo': 'AR', 'ascoli piceno': 'AP', 'asti': 'AT', 'avellino': 'AV', 'bari': 'BA',
  'barletta andria trani': 'BT', 'belluno': 'BL', 'benevento': 'BN', 'bergamo': 'BG', 'biella': 'BI',
  'bologna': 'BO', 'bolzano': 'BZ', 'bozen': 'BZ', 'brescia': 'BS', 'brindisi': 'BR',
  'cagliari': 'CA', 'caltanissetta': 'CL', 'campobasso': 'CB', 'caserta': 'CE', 'catania': 'CT',
  'catanzaro': 'CZ', 'chieti': 'CH', 'como': 'CO', 'cosenza': 'CS', 'cremona': 'CR',
  'crotone': 'KR', 'cuneo': 'CN', 'enna': 'EN', 'fermo': 'FM', 'ferrara': 'FE',
  'firenze': 'FI', 'florence': 'FI', 'foggia': 'FG', 'forli cesena': 'FC', 'forli-cesena': 'FC',
  'frosinone': 'FR', 'genova': 'GE', 'gorizia': 'GO', 'grosseto': 'GR', 'imperia': 'IM',
  'isernia': 'IS', 'la spezia': 'SP', 'l aquila': 'AQ', 'laquila': 'AQ', 'latina': 'LT',
  'lecce': 'LE', 'lecco': 'LC', 'livorno': 'LI', 'lodi': 'LO', 'lucca': 'LU',
  'macerata': 'MC', 'mantova': 'MN', 'massa carrara': 'MS', 'matera': 'MT', 'messina': 'ME',
  'milano': 'MI', 'modena': 'MO', 'monza brianza': 'MB', 'monza e brianza': 'MB', 'napoli': 'NA',
  'novara': 'NO', 'nuoro': 'NU', 'oristano': 'OR', 'padova': 'PD', 'palermo': 'PA',
  'parma': 'PR', 'pavia': 'PV', 'perugia': 'PG', 'pesaro urbino': 'PU', 'pescara': 'PE',
  'piacenza': 'PC', 'pisa': 'PI', 'pistoia': 'PT', 'pordenone': 'PN', 'potenza': 'PZ',
  'prato': 'PO', 'ragusa': 'RG', 'ravenna': 'RA', 'reggio calabria': 'RC', 'reggio emilia': 'RE',
  'rieti': 'RI', 'rimini': 'RN', 'roma': 'RM', 'rome': 'RM', 'rovigo': 'RO',
  'salerno': 'SA', 'sassari': 'SS', 'savona': 'SV', 'siena': 'SI', 'siracusa': 'SR',
  'sondrio': 'SO', 'sud sardegna': 'SU', 'taranto': 'TA', 'teramo': 'TE', 'terni': 'TR',
  'torino': 'TO', 'turin': 'TO', 'trapani': 'TP', 'trento': 'TN', 'treviso': 'TV',
  'trieste': 'TS', 'udine': 'UD', 'varese': 'VA', 'venezia': 'VE', 'venice': 'VE',
  'verbano cusio ossola': 'VB', 'vercelli': 'VC', 'verona': 'VR', 'vibo valentia': 'VV',
  'vicenza': 'VI', 'viterbo': 'VT',
  'citta metropolitana di bari': 'BA', 'citta metropolitana di bologna': 'BO', 'citta metropolitana di cagliari': 'CA',
  'citta metropolitana di catania': 'CT', 'citta metropolitana di firenze': 'FI', 'citta metropolitana di genova': 'GE',
  'citta metropolitana di messina': 'ME', 'citta metropolitana di milano': 'MI', 'citta metropolitana di napoli': 'NA',
  'citta metropolitana di palermo': 'PA', 'citta metropolitana di reggio calabria': 'RC',
  'citta metropolitana di roma capitale': 'RM', 'citta metropolitana di torino': 'TO',
  'citta metropolitana di venezia': 'VE'
};

const REGION_BY_PROVINCE_CODE: Record<string, string> = {
  AO: 'Valle d’Aosta', TO: 'Piemonte', VC: 'Piemonte', NO: 'Piemonte', CN: 'Piemonte', AT: 'Piemonte', AL: 'Piemonte', BI: 'Piemonte', VB: 'Piemonte',
  VA: 'Lombardia', CO: 'Lombardia', SO: 'Lombardia', MI: 'Lombardia', BG: 'Lombardia', BS: 'Lombardia', PV: 'Lombardia', CR: 'Lombardia', MN: 'Lombardia', LC: 'Lombardia', LO: 'Lombardia', MB: 'Lombardia',
  BZ: 'Trentino-Alto Adige', TN: 'Trentino-Alto Adige', VE: 'Veneto', VR: 'Veneto', VI: 'Veneto', BL: 'Veneto', TV: 'Veneto', PD: 'Veneto', RO: 'Veneto',
  UD: 'Friuli-Venezia Giulia', GO: 'Friuli-Venezia Giulia', TS: 'Friuli-Venezia Giulia', PN: 'Friuli-Venezia Giulia',
  IM: 'Liguria', SV: 'Liguria', GE: 'Liguria', SP: 'Liguria',
  PC: 'Emilia-Romagna', PR: 'Emilia-Romagna', RE: 'Emilia-Romagna', MO: 'Emilia-Romagna', BO: 'Emilia-Romagna', FE: 'Emilia-Romagna', RA: 'Emilia-Romagna', FC: 'Emilia-Romagna', RN: 'Emilia-Romagna',
  MS: 'Toscana', LU: 'Toscana', PT: 'Toscana', FI: 'Toscana', LI: 'Toscana', PI: 'Toscana', AR: 'Toscana', SI: 'Toscana', GR: 'Toscana', PO: 'Toscana',
  PG: 'Umbria', TR: 'Umbria', PU: 'Marche', AN: 'Marche', MC: 'Marche', AP: 'Marche', FM: 'Marche',
  VT: 'Lazio', RI: 'Lazio', RM: 'Lazio', LT: 'Lazio', FR: 'Lazio',
  AQ: 'Abruzzo', TE: 'Abruzzo', PE: 'Abruzzo', CH: 'Abruzzo',
  CB: 'Molise', IS: 'Molise', CE: 'Campania', BN: 'Campania', NA: 'Campania', AV: 'Campania', SA: 'Campania',
  FG: 'Puglia', BA: 'Puglia', TA: 'Puglia', BR: 'Puglia', LE: 'Puglia', BT: 'Puglia',
  PZ: 'Basilicata', MT: 'Basilicata', CS: 'Calabria', CZ: 'Calabria', KR: 'Calabria', VV: 'Calabria', RC: 'Calabria',
  TP: 'Sicilia', PA: 'Sicilia', ME: 'Sicilia', AG: 'Sicilia', CL: 'Sicilia', EN: 'Sicilia', CT: 'Sicilia', RG: 'Sicilia', SR: 'Sicilia',
  SS: 'Sardegna', NU: 'Sardegna', CA: 'Sardegna', OR: 'Sardegna', SU: 'Sardegna'
};

export function provinceCodeFromText(value: string): string {
  const raw = `${value || ''}`.trim();
  if (!raw) return '';
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const norm = normalizeGeoText(raw)
    .replace(/^provincia di\s+/, '')
    .replace(/^citta metropolitana di\s+/, '')
    .replace(/^free municipal consortium of\s+/, '')
    .trim();
  return PROVINCE_NAME_TO_CODE[norm] || '';
}

export function provinceCodeFromAddressParts(address: any): string {
  if (!address || typeof address !== 'object') return '';
  const keys = Object.keys(address);
  for (const key of keys) {
    if (!key.toLowerCase().includes('iso3166-2')) continue;
    const value = `${(address as any)[key] || ''}`.trim();
    const m = value.match(/IT-([A-Z]{2})/i);
    if (m) return `${m[1]}`.toUpperCase();
  }
  const candidates = [
    `${address.province || ''}`,
    `${address.county || ''}`,
    `${address.state_district || ''}`,
    `${address.city_district || ''}`
  ];
  for (const c of candidates) {
    const code = provinceCodeFromText(c);
    if (code) return code;
  }
  return '';
}

export function regionNameFromProvinceCode(code: string): string {
  return REGION_BY_PROVINCE_CODE[`${code || ''}`.toUpperCase()] || '';
}

export function provinceCodeFromAddressLabel(label: string): string {
  const text = `${label || ''}`.trim();
  if (!text) return '';
  const direct = text.match(/\b([A-Z]{2})\b/);
  if (direct && REGION_BY_PROVINCE_CODE[direct[1]]) return direct[1];
  const parts = text.split(',').map(x => `${x || ''}`.trim()).filter(Boolean).reverse();
  for (const p of parts) {
    const code = provinceCodeFromText(p);
    if (code) return code;
  }
  return '';
}

export function italianAddressTypeScore(addresstype: string): number {
  const t = `${addresstype || ''}`.toLowerCase();
  if (['road', 'house', 'residential', 'street', 'pedestrian', 'path', 'service', 'unclassified', 'track'].includes(t)) return 75;
  if (['city', 'town', 'village', 'municipality', 'hamlet', 'locality'].includes(t)) return 60;
  if (['county', 'province', 'state_district', 'state'].includes(t)) return 45;
  if (['suburb', 'neighbourhood', 'quarter'].includes(t)) return 35;
  return 20;
}

export function formatItalianAddressLabel(row: any, normalizeFn: (value: string) => string): string {
  const address = row?.address || {};
  const place = `${address.city || address.town || address.village || address.municipality || address.hamlet || row?.name || ''}`.trim();
  const hamlet = `${address.hamlet || address.suburb || address.neighbourhood || address.quarter || ''}`.trim();
  const postcode = `${address.postcode || ''}`.trim();
  const provinceCode = provinceCodeFromAddressParts(address);
  const road = `${address.road || ''}`.trim();
  const number = `${address.house_number || ''}`.trim();
  const addresstype = `${row?.addresstype || row?.type || ''}`.toLowerCase();
  const roadLike = ['road', 'house', 'residential', 'street', 'pedestrian', 'path', 'service', 'unclassified', 'track'].includes(addresstype);
  const roadLabel = `${road}${number ? ` ${number}` : ''}`.trim();
  const frazione = hamlet && normalizeFn(hamlet) !== normalizeFn(place) ? hamlet : '';
  if ((roadLike || roadLabel) && roadLabel) {
    return [roadLabel, frazione, place, provinceCode, postcode].filter(Boolean).join(', ');
  }
  const compact = [frazione, place, provinceCode, postcode].filter(Boolean).join(', ');
  return compact || `${row?.display_name || ''}`.trim();
}
