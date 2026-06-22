const HASHRATE_UNIT_REGEX = /(EH|PH|TH|GH|MH|KH|H)(?:\/S)?/i;
const DEFAULT_CURRENCY = 'BTC';
const PREFERRED_CURRENCY_KEYS = ['BTC', 'USD', 'LTC', 'DOGE', 'ETH'];

<<<<<<< Updated upstream
export function parsePriceValue(price) {
  if (price === undefined || price === null) return 0;
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const cleaned = price.replace(/,/g, '').replace(/[^0-9eE+\-\.]/g, '');
=======
export function getPriceData(source) {
  if (!source) return { value: 0, currency: 'BTC' };
  
  if (typeof source === 'object') {
    // If source has 'paid', it's a total amount, not a rate.
    if (source.paid !== undefined) {
      return { 
        value: parsePriceValue(source.paid), 
        currency: (source.currency ?? source.price_unit ?? source.unit ?? 'BTC').toUpperCase(),
        isTotalCost: true
      };
    }
    // Otherwise, assume it's a rate or a single value
    const val = parsePriceValue(source.BTC ?? source.value ?? source.amount ?? source.price);
    const curr = (source.currency ?? source.price_unit ?? source.unit ?? 'BTC').toUpperCase();
    return { value: val, currency: curr, isTotalCost: false };
  }
  
  return { value: parsePriceValue(source), currency: 'BTC' };
}

export function getBtcPriceData(source) {
  if (!source) return { value: 0, currency: 'BTC', isTotalCost: false, isPerHashRate: true };
  
  const data = getPriceData(source);
  
  // Detect if it's a rental total cost or a listing rate
  const isTotalCost = !!(typeof source === 'object' && (source.paid !== undefined || source.amount !== undefined));
  const isPerHashRate = !isTotalCost;
  
  // Handle MRR-style nested price objects specifically for rates
  if (typeof source === 'object' && !source.paid && source.BTC) {
    return {
      value: parsePriceValue(source.BTC),
      currency: 'BTC',
      isTotalCost: false,
      isPerHashRate: true,
      unit: (source.price_unit || source.unit || 'TH').toUpperCase()
    };
  }

  return {
    ...data,
    isTotalCost,
    isPerHashRate,
    unit: (source?.unit || source?.price_unit || 'TH').toUpperCase()
  };
}

export function parsePriceValue(val) {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/,/g, '');
>>>>>>> Stashed changes
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof price === 'object') {
    const candidate = price.price ?? price.paid ?? price.advertised ?? price.amount ?? price.total ?? price.value ?? price.hour;
    if (candidate !== undefined) return parsePriceValue(candidate);
    const nested = Object.values(price).find(val => typeof val === 'object' && (val.price !== undefined || val.paid !== undefined || val.advertised !== undefined || val.amount !== undefined || val.total !== undefined));
    if (nested) return parsePriceValue(nested);
  }
  return 0;
<<<<<<< Updated upstream
}

export function getPriceUnit(source) {
  if (!source || typeof source !== 'object') return '';
  const candidates = [
    source.type,
    source.price_unit,
    source.unit,
    source.speedUnit,
    source.hashrate_unit,
    source.suffix,
    source?.BTC?.type,
    source?.BTC?.price_unit,
    source?.BTC?.unit,
    source?.btc?.type,
    source?.btc?.price_unit,
    source?.btc?.unit,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = String(candidate).toUpperCase();
    const match = normalized.match(HASHRATE_UNIT_REGEX);
    if (match) return match[1].toUpperCase();
  }
  return '';
}

function getPreferredValue(obj) {
  if (obj === undefined || obj === null) return undefined;
  if (typeof obj !== 'object') return parsePriceValue(obj);

  for (const key of ['paid', 'total', 'amount', 'advertised', 'price', 'value', 'hour']) {
    if (obj[key] !== undefined) {
      return parsePriceValue(obj[key]);
    }
  }

  const nested = Object.values(obj).find(val => typeof val === 'object' && (val.price !== undefined || val.paid !== undefined || val.advertised !== undefined || val.amount !== undefined || val.total !== undefined));
  if (nested) return getPreferredValue(nested);

  return undefined;
}

export function getPriceData(source) {
  if (source === undefined || source === null) return { value: 0, currency: DEFAULT_CURRENCY, unit: '' };
  if (typeof source === 'number') return { value: source, currency: DEFAULT_CURRENCY, unit: '' };
  if (typeof source === 'string') return { value: parsePriceValue(source), currency: DEFAULT_CURRENCY, unit: '' };
  if (typeof source !== 'object') return { value: 0, currency: DEFAULT_CURRENCY, unit: '' };

  const currency = String(source.currency || source.price_unit || '').toUpperCase() || DEFAULT_CURRENCY;
  const unit = getPriceUnit(source);
  const value = getPreferredValue(source);
  if (value !== undefined) return { value, currency, unit };

  for (const key of PREFERRED_CURRENCY_KEYS) {
    const nested = source[key];
    if (nested && typeof nested === 'object') {
      const nestedData = getPriceData(nested);
      if (nestedData.value > 0) return { ...nestedData, unit: nestedData.unit || unit };
    }
  }

  for (const key of Object.keys(source)) {
    if (['currency', 'price_unit', 'type', 'unit', 'speedUnit', 'hashrate_unit', 'suffix'].includes(key)) continue;
    const parsed = parsePriceValue(source[key]);
    if (parsed > 0) return { value: parsed, currency, unit };
  }

  return { value: 0, currency, unit };
}

export function isHashratePriceSource(source) {
  if (!source || typeof source !== 'object') return false;
  if (getPriceUnit(source)) return true;
  const nestedBtc = source.BTC || source.btc;
  if (nestedBtc && typeof nestedBtc === 'object') return Boolean(getPriceUnit(nestedBtc));
  return false;
}

export function getBtcPriceData(source) {
  if (!source || typeof source !== 'object') {
    const data = getPriceData(source);
    return { ...data, isPerHashRate: false, isTotalCost: false };
  }

  const explicitSource = source.price_converted || source.price || source.advertised || source.amount || source.total;
  if (explicitSource && explicitSource !== source && typeof explicitSource === 'object') {
    return getBtcPriceData(explicitSource);
  }

  const data = getPriceData(source);
  const sourceIsHashrate = isHashratePriceSource(source);
  if (data.currency === 'BTC' && data.value > 0) {
    const isTotalCost = !sourceIsHashrate && (source?.paid !== undefined || source?.total !== undefined || source?.amount !== undefined);
    return { ...data, isPerHashRate: sourceIsHashrate, isTotalCost, unit: data.unit };
  }

  const nestedBtc = source.BTC || source.btc;
  if (nestedBtc && typeof nestedBtc === 'object') {
    const nestedData = getPriceData(nestedBtc);
    if (nestedData.currency === 'BTC' && nestedData.value > 0) {
      const nestedIsHashrate = isHashratePriceSource(nestedBtc);
      const isTotalCost = !nestedIsHashrate && (nestedBtc?.paid !== undefined || nestedBtc?.total !== undefined || nestedBtc?.amount !== undefined);
      return { ...nestedData, isPerHashRate: nestedIsHashrate, isTotalCost, unit: nestedData.unit };
    }
  }

  return { ...data, isPerHashRate: false, isTotalCost: false };
}
=======
}
>>>>>>> Stashed changes
