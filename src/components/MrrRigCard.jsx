<<<<<<< Updated upstream
import React from 'react';
import { CountdownTimer } from './MiningRigRental';
import { 
  clean, 
  getClientBadgeStyle, 
  getRawHashrate, 
  getPriceDataLocal, 
  parsePriceValueLocal,
  getNiceHashPriceValue,
  formatRentalStartTime,
  getRentalAlgorithm,
  getRentalEfficiency,
  getRentalAdvertisedHashrate,
  getRentalAverageHashrate,
  getStatusClass,
  getRoiColor
} from '../core/mrrUtils';
import { getBtcPriceData as getBtcPriceDataUtils } from '../core/priceUtils';
import { getAlgoDisplayName, normalizeAlgoForNiceHash, calculatePriceComparison } from '../core/mapping.js';

const MrrRigCard = ({ 
  rig, 
=======
import { useEffect, useMemo, useState } from 'react';
import { CountdownTimer } from './MiningRigRental';
import {
  getClientBadgeStyle,
  getRawHashrate,
  getPriceDataLocal,
  parsePriceValueLocal,
  formatRentalStartTime,
  getStatusClass,
  getRoiColor,
  getNiceHashPriceValue
} from '../core/mrrUtils.js';
import { HASHRATE_SUFFIXES, getAlgoDisplayName, normalizeAlgoForNiceHash, getAlgorithmUnit, getMrrAlgorithmUnit, calculatePriceComparison } from '../core/mapping.js';

const formatPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`;
};

const normalizeOrderAlgo = (order) => {
  const rawOrder = order?.rawOrder || order;
  const pick = (value) => {
    if (!value) return '';
    if (typeof value === 'object') return value.algorithm || value.displayName || value.name || '';
    return value;
  };

  return normalizeAlgoForNiceHash(
    order?.algo ||
    pick(order?.algorithm) ||
    rawOrder?.algo ||
    pick(rawOrder?.algorithm) ||
    rawOrder?.type
  );
};

const COINGECKO_BY_CURRENCY = {
  BTC: 'bitcoin',
  LTC: 'litecoin',
  DOGE: 'dogecoin',
  BCH: 'bitcoin-cash',
  ETH: 'ethereum',
  ETC: 'ethereum-classic'
};

const PRICE_CURRENCIES = ['BTC', 'ETH', 'LTC', 'DOGE', 'BCH'];

/** Client-side fallback BTC rates when CoinGecko API is unavailable */
const FALLBACK_BTC_RATES = {
  ETH: 0.052,
  LTC: 0.00078,
  DOGE: 0.0000018,
  BCH: 0.00042,
  ETC: 0.00042,
};

const resolvePaidPrice = (priceSource, convertedSource) => {
  const source = priceSource && typeof priceSource === 'object' ? priceSource : {};

  if (source.paid !== undefined || source.amount !== undefined) {
    return {
      amount: parsePriceValueLocal(source.paid ?? source.amount),
      currency: String(source.currency || source.price_unit || source.unit || 'BTC').toUpperCase(),
    };
  }

  for (const currency of PRICE_CURRENCIES) {
    const nested = source[currency];
    if (!nested || typeof nested !== 'object') continue;
    const amount = parsePriceValueLocal(nested.paid ?? nested.price ?? nested.amount ?? nested.hour ?? nested.minhrs ?? nested.maxhrs);
    if (amount > 0) {
      return {
        amount,
        currency,
      };
    }
  }

  if (convertedSource && typeof convertedSource === 'object') {
    const convertedAmount = parsePriceValueLocal(convertedSource.paid ?? convertedSource.price ?? convertedSource.amount ?? convertedSource.BTC ?? convertedSource.value);
    if (convertedAmount > 0) {
      return {
        amount: convertedAmount,
        currency: String(convertedSource.currency || convertedSource.price_unit || 'BTC').toUpperCase(),
      };
    }
  }

  return { amount: 0, currency: 'BTC' };
};

const convertPaidToBtc = (amount, currency, coinPrices = {}, fallbackBtc = 0) => {
  const upperCurrency = String(currency || 'BTC').toUpperCase();
  if (!amount || amount <= 0) return 0;
  if (upperCurrency === 'BTC') return amount;

  // Try CoinGecko API price first
  const coinId = COINGECKO_BY_CURRENCY[upperCurrency];
  const apiBtcRate = coinId ? Number.parseFloat(coinPrices?.[coinId]?.btc || 0) : 0;
  if (apiBtcRate > 0) return amount * apiBtcRate;

  // Fallback to hardcoded approximate rate
  const fallbackRate = FALLBACK_BTC_RATES[upperCurrency];
  if (fallbackRate !== undefined) return amount * fallbackRate;

  // Last resort: use the fallbackBtc parameter from price data
  return Number.isFinite(fallbackBtc) && fallbackBtc > 0 ? fallbackBtc : 0;
};

const cleanHashrateUnit = (unit) => {
  const match = String(unit || '').toUpperCase().match(/GSOL|MSOL|KSOL|SOL|EH|PH|TH|GH|MH|KH|H/);
  return match?.[0] || 'H';
};

const convertHashrateValue = (value, fromUnit, toUnit) => {
  const fromMultiplier = HASHRATE_SUFFIXES[cleanHashrateUnit(fromUnit)] || 1;
  const toMultiplier = HASHRATE_SUFFIXES[cleanHashrateUnit(toUnit)] || 1;
  return value * fromMultiplier / toMultiplier;
};

const MrrRigCard = ({
  rig,
>>>>>>> Stashed changes
  algoName,
  info, 
  isMine, 
  mrrClient, 
  nhOrders, 
  algoMarketPrices, 
  onOpenPool, 
  onOpenCompletionCalculator, 
  fetchRigDetailInfo, 
  loadingInfoIds, 
  handleRigStatus,
  handlePriceChange,
  expandedPools,
  togglePoolInfo,
  setEnrichedInfo
}) => {
  const statusStr = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
<<<<<<< Updated upstream
  const isRented = statusStr.includes('rented');
  const rentalId = rig.rentalid || rig.current_rental_id || rig.rental_id;
  const displayId = (isRented && rentalId) ? rentalId : rig.id;
  const idLabel = (isRented && rentalId) ? 'Rental' : 'Rig';
=======
  const rentalId = rig.rentalid || rig.current_rental_id || rig.rental_id;
  const isRented = statusStr.includes('rented') || statusStr.includes('active') || Boolean(rentalId);
  const displayId = (isRented && rentalId) ? rentalId : rig.id;
  const idLabel = (isRented && rentalId) ? 'Rental' : 'Rig';
  const [nowMs, setNowMs] = useState(0);
>>>>>>> Stashed changes

  const rawNhData = algoMarketPrices[algoName.toUpperCase()] || info?.nicehashPrice;
  const nhBase = Array.isArray(rawNhData) ? rawNhData[0] : rawNhData;
  const nhData = nhBase?.price || nhBase;
  const adsVal = info?.rawAds || getRawHashrate(rig.hashrate?.advertised || rig.advertised);
  const displayPriceData = getPriceDataLocal(rig.price || info?.price || rig.min_price);
  const displayPrice1000 = displayPriceData.value;
  const BASE_UNIT_FACTOR = 1000;
  const isEquihash = algoName.toLowerCase() === 'equihash';
  const displayPrice = isEquihash ? displayPrice1000 : displayPrice1000 * BASE_UNIT_FACTOR;
  const displayPriceCurrency = displayPriceData.currency || 'BTC';
  const paidAmount = parsePriceValueLocal(info?.price?.paid ?? rig.price?.paid);
  const paidCurrency = info?.price?.currency || info?.price?.price_unit || rig.price?.currency || rig.price?.price_unit || rig.currency || info?.currency || '';
  const paidLabel = paidAmount > 0 && paidCurrency ? `${paidAmount.toFixed(8)} ${paidCurrency}` : null;

  const effectivePriceSource = (info?.price?.paid !== undefined || rig.price?.paid !== undefined)
    ? { ...(rig.price || {}), ...(info?.price || {}), paid: info?.price?.paid ?? rig.price?.paid, currency: String(info?.price?.currency || rig.price?.currency || info?.price?.price_unit || rig.price?.price_unit || 'BTC').toUpperCase() }
    : rig.price_converted || info?.price_converted || info?.price?.BTC || rig?.price?.BTC || rig.price || info?.price || rig.min_price;

<<<<<<< Updated upstream
  const btcPriceData = getBtcPriceDataUtils(effectivePriceSource);
  const isMrrBtc = btcPriceData.currency === 'BTC' && btcPriceData.value > 0;
  const mrrComparePriceValue = btcPriceData.value;
  const nhPriceValue = getNiceHashPriceValue(rawNhData);
  const isTotalCost = info?.price?.paid !== undefined || rig.price?.paid !== undefined;

  const mrrPriceNum = (() => {
    let val = mrrComparePriceValue;
    if (typeof val === 'string') val = parseFloat(val.replace(/,/g, '')) || 0;
    const hours = parseFloat(rig.hours || rig.length || info?.duration || 0);
    if (isTotalCost && adsVal > 0 && hours > 0) return val / (hours / 24) / adsVal;
    return Number.isFinite(val) ? val : 0;
  })();
=======
  const adsVal = useMemo(
    () => info?.rawAds || getRawHashrate(rig.hashrate?.advertised || rig.advertised) || 0,
    [info?.rawAds, rig.hashrate?.advertised, rig.advertised]
  );

  const avgVal = useMemo(
    () => info?.rawAvg || getRawHashrate(rig.hashrate?.average || rig.average || rig.hash) || 0,
    [info?.rawAvg, rig.hashrate?.average, rig.average, rig.hash]
  );
>>>>>>> Stashed changes

  const mrrUnit = clean(info?.advertised || rig.hashrate_unit || rig.hashrate?.advertised?.type || rig.hashrate?.suffix || 'TH');
  const nhOrder = nhOrders.find(o => normalizeAlgoForNiceHash(o.algo) === normalizeAlgoForNiceHash(algoName));
  const myNhPrice = nhOrder ? parseFloat(nhOrder.price) : 0;
  const nhPriceWithFee = myNhPrice > 0 ? (parseFloat(nhOrder.add_fee) || (myNhPrice * 1.04)) : 0;
  const isRandomX = algoName.toLowerCase().includes('RANDOMX');
  const isSha256 = algoName.toUpperCase().includes('SHA256');
  // Corrected unit fallbacks to prevent SHA256/RandomX overlaps in NiceHash price comparison
  const myNhUnit = nhOrder?.marketUnit || (isSha256 ? 'EH' : (isRandomX ? 'MH' : 'GH'));
  const effValue = info?.percent || rig.hashrate?.average?.percent || rig.percent || 0;
  const myOrderDiffRaw = (myNhPrice > 0 && mrrPriceNum > 0 && isMrrBtc) ? calculatePriceComparison(
    mrrPriceNum,
    mrrUnit, // Pass mrrUnit directly; calculatePriceComparison should handle conversion
    nhPriceWithFee,
    myNhUnit
  ) : null;
  // ROI matches summary logic: 100% - Actual Efficiency
  const myOrderDiff = (100 - parseFloat(effValue)).toFixed(1);

  
  const eff = parseFloat(effValue).toFixed(2);
  const rentalStartTime = info?.startTime || rig.start;
<<<<<<< Updated upstream
  const startT = new Date(rentalStartTime + (String(rentalStartTime).endsWith('UTC') ? '' : ' UTC')).getTime();
  const endT = new Date((info?.endTime || rig.end || (typeof rig.status === 'object' ? rig.status.end : null)) + (String(info?.endTime || rig.end).endsWith('UTC') ? '' : ' UTC')).getTime();
  const avgVal = info?.rawAvg || getRawHashrate(rig.hashrate?.average || rig.average || rig.hash);
  const hSuffix = rig.hashrate?.suffix || rig.hashrate?.advertised?.type || '';
  const totalMs = endT - startT;
  const elapsedMs = Math.max(0, Math.min(Date.now() - startT, totalMs));
  const timeProgress = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
  const targetHashrate = (totalMs - elapsedMs) > 0 ? ((adsVal * (totalMs / 1000) - avgVal * (elapsedMs / 1000)) / ((totalMs - elapsedMs) / 1000)) : 0;
  const isBehind = targetHashrate > adsVal;

  let effectBg = isMine ? 'rgba(59, 130, 246, 0.1)' : 'rgba(30, 41, 59, 0.4)';
  let effectBorder = isMine ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.1)';
  let effectTextColor = '#fbbf24';
  const effNum = parseFloat(effValue);

  if (effNum > 0) {
    if (effNum < 50) {
      effectBg = `linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, ${effectBg} 100%)`;
      effectBorder = '1px solid rgba(239, 68, 68, 0.4)';
      effectTextColor = '#ef4444';
    } else if (effNum < 70) {
      effectBg = `linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, ${effectBg} 100%)`;
      effectBorder = '1px solid rgba(245, 158, 11, 0.4)';
      effectTextColor = '#f59e0b';
    } else if (effNum >= 100) {
      effectBg = `linear-gradient(135deg, rgba(255, 22, 255, 0.39) 0%, ${effectBg} 100%)`;
      effectBorder = '1px solid rgba(36, 208, 251, 0.4)';
      effectTextColor = '#00eeff';
    } else if (effNum > 90) {
      effectBg = `linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, ${effectBg} 100%)`;
      effectBorder = '1px solid rgba(16, 185, 129, 0.4)';
      effectTextColor = '#10b981';
    }
  }

  return (
    <div className="rig-card" style={{ background: effectBg, border: effectBorder, borderRadius: '12px', padding: '10px', position: 'relative', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', transition: 'transform 0.15s ease' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ background: isMine ? '#5c005f' : 'rgba(255,255,255,0.1)', color: 'white', fontSize: '9px', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>
            {idLabel}: #{displayId}
            {rig.mrrClient && <span style={{ ...getClientBadgeStyle(rig.mrrClient), fontSize: '9px', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold', marginLeft: '4px' }}>{rig.mrrClient.toUpperCase()}</span>}
          </span>
          <span style={{ fontSize: '9px', fontWeight: 'bold', padding: '2px 8px', borderRadius: '12px', ...getStatusClass(rig.status) }}>
            {String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toUpperCase()}
          </span>
        </div>
        <strong style={{ fontSize: '13px', lineHeight: '1.3', color: '#f8fafc' }}>{rig.name}</strong>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '8px', fontSize: '10px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', borderRight: '1px solid rgba(255,255,255,0.05)', paddingRight: '4px' }}>
          <div>
            <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase' }}>Algorithm</div>
            <div style={{ color: '#fc7324', fontWeight: 'bold' }}>{getAlgoDisplayName(info?.algo || rig.algo || rig.algorithm || rig.type)}</div>
          </div>
          <div>
            <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase' }}>Rental Price:</div>
            <div style={{ color: '#fbbf24', fontSize: '11px', fontWeight: 'bold' }}>{displayPrice.toFixed(8)} <small style={{ opacity: 0.5 }}>{displayPriceCurrency}</small></div>
            {displayPriceCurrency !== 'BTC' && isMrrBtc && <div style={{ fontSize: '9px', color: '#fbbf24', opacity: 0.8 }}>≈ {(isTotalCost ? mrrPriceNum : (isEquihash ? mrrComparePriceValue : mrrComparePriceValue * BASE_UNIT_FACTOR)).toFixed(8)} <small>BTC</small></div>}
            {isRented && paidLabel && <div style={{ fontSize: '10px', color: '#10b981', marginTop: '5px', background: 'rgba(19, 173, 122, 0.06)', padding: '1px 4px', borderRadius: '3px' }}>Paid: <strong>{paidLabel}</strong></div>}
            {nhOrder && myOrderDiff !== null && (
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '6px', padding: '6px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ opacity: 0.7, fontSize: '8px' }}>Order: </span>
                  <span style={{ fontWeight: 'bold', color: '#fbbf24' }}>{myNhPrice.toFixed(8)}</span>
                  {/* {myOrderDiff !== null && (
                    <span style={{ color: parseFloat(myOrderDiff) > 0 ? '#f87171' : '#10b981', fontSize: '0.7rem', marginLeft: '4px' }}>
                      ({parseFloat(myOrderDiff) > 0 ? '+' : ''}{myOrderDiff}%)
                    </span>
                  )} */}
                </div>
                <div><span style={{ opacity: 0.7, fontSize: '9px' }}>ROI: </span><span style={{ fontWeight: 'bold', color: getRoiColor(myOrderDiff) }}>{parseFloat(myOrderDiff) > 0 ? '+' : ''}{myOrderDiff}%</span></div>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ opacity: 0.5, fontSize: '8px' }}>Efficiency</div><div style={{ fontSize: '11px', color: effectTextColor, fontWeight: 'bold' }}>{eff}%</div></div>
            <div style={{ width: '100%', height: '2px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, effNum)}%`, height: '100%', background: effectTextColor }} /></div>
          </div>
          <div>
            <div style={{ opacity: 0.5, fontSize: '8px' }}>Target</div>
            <div style={{ color: isBehind ? '#f87171' : '#34d399', fontWeight: 'bold', fontSize: '11px' }}>{Math.max(0, targetHashrate).toFixed(2)} <small style={{ opacity: 0.5 }}>{hSuffix}</small></div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px' }}>
              <span style={{ opacity: 0.5 }}>Hashrate</span>
              {info?.isRental && <span style={{ opacity: 0.8 }}>Adv: <span style={{ color: '#34d399', fontWeight: 'bold' }}>{info.advertised}</span></span>}
=======
  const rentalEndTime = info?.endTime || rig.end || (typeof rig.status === 'object' ? rig.status.end : null);
  const startT = new Date(rentalStartTime + (String(rentalStartTime || '').endsWith('UTC') ? '' : ' UTC')).getTime();
  const endT = new Date(rentalEndTime + (String(rentalEndTime || '').endsWith('UTC') ? '' : ' UTC')).getTime();
  const totalMs = (Number.isNaN(startT) || Number.isNaN(endT)) ? 0 : Math.max(0, endT - startT);
  const durationHoursFromDates = totalMs > 0 ? totalMs / 3600000 : 0;
  const durationHoursExplicit = parseFloat(info?.duration ?? info?.hours ?? rig.duration ?? rig.hours ?? rig.length ?? 0);
  const durationHours = durationHoursExplicit > 0 ? durationHoursExplicit : durationHoursFromDates;

  const rawEffValue = info?.percent ?? rig.hashrate?.average?.percent ?? rig.percent ?? (adsVal > 0 ? (avgVal / adsVal * 100) : 0);
  const effNum = Number.parseFloat(rawEffValue);
  const eff = Number.isFinite(effNum) ? effNum.toFixed(2) : '0.00';

  const rawAlgo = info?.algo || rig.algo || rig.algorithm || rig.type || algoName;
  const normalizedAlgo = normalizeAlgoForNiceHash(rawAlgo || algoName);
  const paidPrice = resolvePaidPrice(info?.price || rig.price, info?.price_converted || rig.price_converted);
  const paidAmount = paidPrice.amount;
  const paidCurrency = paidPrice.currency || info?.currency || rig.currency || 'BTC';
  const paidLabel = paidAmount > 0 && paidCurrency ? `${paidAmount.toFixed(8)} ${String(paidCurrency).toUpperCase()}` : null;
  const fallbackBtc = parsePriceValueLocal(info?.price_converted?.price ?? rig.price_converted?.price ?? 0);
  const paidBtcAmount = convertPaidToBtc(paidAmount, paidCurrency, coinPrices, fallbackBtc);
  const mrrUnit = getMrrAlgorithmUnit(normalizedAlgo || rawAlgo);
  const advertisedUnit = rig.hashrate?.suffix || rig.hashrate?.advertised?.type || info?.hashrate?.suffix || info?.hashrate_unit || info?.unit || mrrUnit;
  const adsInMrrUnit = adsVal > 0 ? convertHashrateValue(adsVal, advertisedUnit, mrrUnit) : 0;
  const durationDays = durationHours > 0 ? durationHours / 24 : 0;
  const mrrDailyRate = paidBtcAmount > 0 && adsInMrrUnit > 0 && durationDays > 0 
    ? (paidBtcAmount / durationDays) / adsInMrrUnit
    : 0;
  const mrrDailyRateSource = paidBtcAmount > 0 ? 'Calculated from MRR sold rental' : 'Waiting for paid BTC conversion';
  const roiFormulaLabel = 'MRR Sold Rate vs NiceHash Buy Order';

  const normalizedCardAlgo = normalizeAlgoForNiceHash(algoName || rawAlgo);
  const nhOrder = [...(nhOrders || [])]
    .sort((a, b) => Number(Boolean(b?.isActive || b?.rawOrder?.status?.code === 'ACTIVE' || b?.rawOrder?.status === 'ACTIVE')) - Number(Boolean(a?.isActive || a?.rawOrder?.status?.code === 'ACTIVE' || a?.rawOrder?.status === 'ACTIVE')))
    .find((order) => normalizeOrderAlgo(order) === normalizedCardAlgo);

  const orderNhPrice = getNiceHashPriceValue(nhOrder?.price ?? nhOrder?.rawOrder?.price ?? nhOrder);
  const buyNhPrice = nhOrder && orderNhPrice > 0 ? orderNhPrice : 0;
  const buyNhPriceWithFee = buyNhPrice > 0
    ? (Number.parseFloat(nhOrder?.add_fee ?? nhOrder?.priceWithFee ?? 0) > 0
      ? Number.parseFloat(nhOrder.add_fee ?? nhOrder.priceWithFee)
      : buyNhPrice * 1.04)
    : 0;
  const myNhUnit = getAlgorithmUnit(normalizeAlgoForNiceHash(algoName || rawAlgo));

  const roiPercent = buyNhPriceWithFee > 0 && mrrDailyRate > 0
    ? calculatePriceComparison(mrrDailyRate, mrrUnit, buyNhPriceWithFee, myNhUnit)
    : null;
  const roiLabel = roiPercent !== null ? formatPercent(roiPercent) : (buyNhPriceWithFee > 0 ? 'Waiting for MRR sold rate' : 'Waiting for NiceHash buy order');
  const displayAlgo = getAlgoDisplayName(normalizedAlgo || rawAlgo);

  const elapsedMs = nowMs > 0 && totalMs > 0 ? Math.max(0, Math.min(nowMs - startT, totalMs)) : 0;
  const timeProgress = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
  const targetHashrate = (totalMs - elapsedMs) > 0
    ? ((adsVal * (totalMs / 1000) - avgVal * (elapsedMs / 1000)) / ((totalMs - elapsedMs) / 1000))
    : 0;
  const isBehind = targetHashrate > adsVal;
  const hSuffix = rig.hashrate?.suffix || rig.hashrate?.advertised?.type || '';

  const getEfficiencyAccent = (efficiency) => {
    if (!Number.isFinite(efficiency)) return 'rgba(148, 163, 184, 0.18)'; // Default grey
    if (efficiency >= 100) return 'rgba(197, 34, 238, 0.3)'; // Cyan
    if (efficiency >= 70) return 'rgba(23, 185, 131, 0.3)'; // Green
    if (efficiency >= 50) return 'rgba(251, 191, 36, 0.30)'; // Yellow
    return 'rgba(239, 68, 68, 0.30)'; // Red
  };

  const accent = getEfficiencyAccent(effNum);

  const shellStyle = {
    
    background: `radial-gradient(circle at top right, ${accent} 0%, transparent 88%)`,
    border: `1px solid ${accent}`,
    borderTop: `3px solid ${getRoiColor(effNum)}`,
    borderRadius: '12px',
    padding: '8px',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    boxShadow: '0 10px 22px rgba(0, 0, 0, 0.16)',
    overflow: 'hidden',
  };

  const sectionStyle = {
    background: 'rgba(255,255,255,0.035)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    padding: '6px',
  };

  return (
    <article className="rig-card" style={shellStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
            <span style={{
              background: isMine ? 'rgba(37, 99, 235, 0.18)' : 'rgba(255,255,255,0.08)',
              color: 'white',
              fontSize: '8px',
              padding: '2px 6px',
              borderRadius: '999px',
              fontWeight: '700',
              letterSpacing: '0.04em',
              textTransform: 'uppercase'
            }}>
              {idLabel}: #{displayId}
            </span>
            {rig.mrrClient && (
              <span style={{
                ...getClientBadgeStyle(rig.mrrClient),
                fontSize: '8px',
                padding: '2px 6px',
                borderRadius: '999px',
                fontWeight: '700'
              }}>
                {rig.mrrClient.toUpperCase()}
              </span>
            )}
            <span style={{
              fontSize: '8px',
              padding: '2px 6px',
              borderRadius: '999px',
              fontWeight: '700',
              ...getStatusClass(rig.status)
            }}>
              {String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toUpperCase()}
            </span>
          </div>
          <strong
            title={rig.name}
            style={{
              fontSize: '13px',
              lineHeight: 1.15,
              color: '#f8fafc',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {rig.name}
          </strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', color: '#94a3b8', fontSize: '9px' }}>
            <span style={{ fontSize: '14px', fontWeight: 900, color: '#38bdf8', textShadow: '0 0 18px rgba(56, 189, 248, 0.22)' }}>{displayAlgo}</span>
            |
            {/* <span>{roiFormulaLabel}</span> */}
            {paidLabel && (
              <>
                {/* <span style={{ opacity: 0.35 }}>•</span> */}
                <span style={{ color: '#fbbf24', fontWeight: 900, fontSize: '11px' }}>Paid {paidLabel}</span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '4px', minWidth: '142px', textAlign: 'right', marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{
            padding: '6px 8px',
            borderRadius: '10px',
            background: roiPercent === null ? 'rgba(255,255,255,0.04)' : roiPercent >= 0 ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
            border: `1px solid ${roiPercent === null ? 'rgba(255,255,255,0.08)' : roiPercent >= 0 ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.22)'}`,
          }}>
            <div style={{ fontSize: '8px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>ROI</div>
            <div style={{ fontSize: '18px', lineHeight: 1, fontWeight: 900, color: getRoiColor(roiPercent ?? 0) }}>
              {roiLabel}
>>>>>>> Stashed changes
            </div>
            {info?.isRental ? (
              <div style={{ background: 'rgba(0,0,0,0.15)', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontWeight: 'bold', fontSize: '10px', color: '#f1f5f9' }}>{info.average || '0 N/A'} <small style={{ fontSize: '8px', opacity: 0.5 }}>(AVG)</small></div>
                <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                  <span><span style={{ color: '#60a5fa' }}>5m:</span> {info.last5m?.split(' ')[0] || '0'}</span>
                  <span><span style={{ color: '#a78bfa' }}>15m:</span> {info.last15m?.split(' ')[0] || '0'}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontWeight: 'bold', fontSize: '10px' }}>{rig.hashrate?.advertised?.nice || rig.hashrate?.nice || '0 N/A'}</div>
            )}
          </div>
        </div>
      </div>

<<<<<<< Updated upstream
      {isRented && (
        <div style={{ background: 'rgba(0,0,0,0.1)', padding: '8px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', opacity: 0.8 }}>
            <span title={rentalStartTime}><span style={{ opacity: 0.5 }}>Started: </span>{formatRentalStartTime(rentalStartTime)}</span>
            <span><span style={{ opacity: 0.5 }}>Remain: </span><CountdownTimer endTime={info?.endTime || rig.end} /></span>
          </div>
          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${timeProgress}%`, height: '100%', background: timeProgress > 90 ? '#f87171' : 'linear-gradient(90deg, #3b82f6, #8b5cf6)' }} />
=======
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.85fr', gap: '6px' }}>
        <section style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6px', marginBottom: '4px' }}>
            {/* <div style={{ color: '#e2e8f0', fontWeight: 700 }}>Rental Snapshot</div> */}
            <div style={{ fontSize: '8px', color: '#94a3b8' }}>{mrrDailyRateSource}</div>
          </div>

          <div style={{
            marginBottom: '6px',
            padding: '7px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.16), rgba(16, 185, 129, 0.10))',
            border: '1px solid rgba(251, 191, 36, 0.20)'
          }}>
            <div style={{ opacity: 0.72, textTransform: 'uppercase', fontSize: '8px', letterSpacing: '0.08em' }}>Actual Rental Paid</div>
            <div style={{ color: '#fbbf24', fontWeight: 900, fontSize: '11px', lineHeight: 1.1, marginTop: '3px' }}>
              {paidLabel || 'N/A'}
            </div>
            {paidBtcAmount > 0 && String(paidCurrency || '').toUpperCase() !== 'BTC' && (
              <div style={{ color: '#86efac', fontWeight: 700, fontSize: '9px', marginTop: '3px' }}>
                ~= {paidBtcAmount.toFixed(8)} BTC
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '5px', fontSize: '9px' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '9px', padding: '6px' }}>
              <div style={{ opacity: 0.6, textTransform: 'uppercase', fontSize: '8px' }}>MRR Rate</div>
              <div style={{ color: '#fbbf24', fontWeight: 800, marginTop: '3px' }}>
                {mrrDailyRate > 0 ? (
                  <>
                    {mrrDailyRate.toFixed(8)}
                    <span style={{ opacity: 0.5 }}> BTC/{mrrUnit}/Day</span>
                  </>
                ) : 'N/A'}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '9px', padding: '6px' }}>
              <div style={{ opacity: 0.6, textTransform: 'uppercase', fontSize: '8px' }}>NiceHash</div>
              <div style={{ color: '#60a5fa', fontWeight: 800, marginTop: '3px' }}>
                {buyNhPriceWithFee > 0 ? (
                  <>
                    {niceHashPriceInMrrUnit.toFixed(8)}
                    <span style={{ opacity: 0.5 }}> BTC/{mrrUnit}/Day</span>
                  </>
                ) : 'N/A'}
              </div>
            </div>

          </div>

          <div style={{
            marginTop: '6px',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '9px',
            color: '#94a3b8',
            padding: '4px 0',
          }}>
            <span>🕐 {formatRentalStartTime(rentalStartTime)}</span>
            <span>⏳ <CountdownTimer endTime={info?.endTime || rig.end} /></span>
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={{ display: 'grid', gap: '6px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', marginBottom: '2px' }}>
                <span style={{ opacity: 0.55, textTransform: 'uppercase' }}>Efficiency</span>
                <span style={{ color: effNum >= 100 ? '#22d3ee' : effNum > 90 ? '#10b981' : effNum > 50 ? '#fbbf24' : '#ef4444', fontWeight: 800 }}>{eff}%</span>
              </div>
              <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Math.max(0, effNum || 0))}%`, height: '100%', background: getRoiColor(effNum), borderRadius: '999px' }} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', marginBottom: '2px' }}>
                <span style={{ opacity: 0.55, textTransform: 'uppercase' }}>Rental Progress</span>
                <span style={{ color: timeProgress > 90 ? '#f87171' : '#8b5cf6', fontWeight: 800 }}>{timeProgress.toFixed(1)}%</span>
              </div>
              <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Math.max(0, timeProgress || 0))}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)', borderRadius: '999px' }} />
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '5px',
              fontSize: '8px'
            }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '9px', padding: '6px' }}>
                <div style={{ opacity: 0.55, textTransform: 'uppercase' }}>Average</div>
                <div style={{ color: '#e2e8f0', fontWeight: 700, marginTop: '3px' }}>{info?.average || '0 N/A'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '9px', padding: '6px' }}>
                <div style={{ opacity: 0.55, textTransform: 'uppercase' }}>Advertised</div>
                <div style={{ color: '#e2e8f0', fontWeight: 700, marginTop: '3px' }}>{info?.advertised || '0 N/A'}</div>
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '9px', padding: '6px' }}>
              <div style={{ opacity: 0.6, textTransform: 'uppercase', fontSize: '8px' }}>Efficiency</div>
              <div style={{ color: '#34d399', fontWeight: 800, marginTop: '3px' }}>{eff}%</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '9px', padding: '6px' }}>
              <div style={{ opacity: 0.6, textTransform: 'uppercase', fontSize: '8px' }}>Target</div>
              <div style={{ color: isBehind ? '#f87171' : '#34d399', fontWeight: 800, marginTop: '3px' }}>
                {Math.max(0, targetHashrate).toFixed(2)} <small style={{ opacity: 0.5 }}>{String(hSuffix).toUpperCase()}</small>
              </div>
            </div>
          </div>
        </section>
      </div>

      {expandedPools.has(rig.id) && (info || rig.host) && (
        <div className="rig-pool-summary" style={{
          background: 'rgba(255,255,255,0.04)',
          padding: '10px',
          borderRadius: '12px',
          fontSize: '10px',
          border: '1px solid rgba(255,255,255,0.06)'
        }}>
          <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Pool</div>
            <button className="text-button" style={{ fontSize: '10px', color: '#60a5fa', padding: 0 }} onClick={() => onOpenPool?.(rig, info)}>Edit</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ opacity: 0.65 }}>Host:</span> {rig.host || info?.stratumHost || 'N/A'}</div>
            <div><span style={{ opacity: 0.65 }}>Port:</span> {rig.port || info?.stratumPort || 'N/A'}</div>
            <div style={{ gridColumn: 'span 2', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ opacity: 0.65 }}>User:</span> {rig.user || info?.username || 'N/A'}</div>
>>>>>>> Stashed changes
          </div>
        </div>
      )}

<<<<<<< Updated upstream
      {expandedPools.has(rig.id) && (info || rig.host) && (
        <div className="rig-pool-summary" style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px', fontSize: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ opacity: 0.5, textTransform: 'uppercase' }}>Current Pool</div>
            <button className="text-button" style={{ fontSize: '10px', color: '#60a5fa', padding: 0 }} onClick={() => onOpenPool?.(rig, info)}>Edit</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ opacity: 0.7 }}>Host:</span> {rig.host || info?.stratumHost || 'N/A'}</div>
            <div><span style={{ opacity: 0.7 }}>Port:</span> {rig.port || info?.stratumPort || 'N/A'}</div>
            <div style={{ gridColumn: 'span 2', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ opacity: 0.7 }}>User:</span> {rig.user || info?.username || 'N/A'}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
        {(isMine || isRented) && (
          <button
            className="btn-pro secondary"
            style={{ flex: 1, fontSize: '9px', background: isRented ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.05)', color: isRented ? '#a78bfa' : '#94a3b8' }}
            onClick={() => { togglePoolInfo(rig.id); onOpenPool?.(rig, info); }}>
=======
      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', flexWrap: 'wrap' }}>
        {(isMine || isRented) && (
          <button
            className="btn-pro secondary"
            style={{ flex: '1 1 120px', fontSize: '10px', background: isRented ? 'rgba(139, 92, 246, 0.16)' : 'rgba(255,255,255,0.05)', color: isRented ? '#a78bfa' : '#94a3b8' }}
            onClick={() => { togglePoolInfo(rig.id); onOpenPool?.(rig, info); }}
          >
>>>>>>> Stashed changes
            {expandedPools.has(rig.id) ? 'Hide Pools' : 'Pools'}
          </button>
        )}
        {isMine && !isRented && (
          <>
            <button
              className="btn-pro secondary"
<<<<<<< Updated upstream
              style={{ flex: 1, fontSize: '10px', color: statusStr === 'disabled' ? '#10b981' : '#f87171' }}
              onClick={() => handleRigStatus(rig, statusStr === 'disabled' ? 'available' : 'disabled')}>
=======
              style={{ flex: '1 1 90px', fontSize: '10px', color: statusStr === 'disabled' ? '#10b981' : '#f87171' }}
              onClick={() => handleRigStatus(rig, statusStr === 'disabled' ? 'available' : 'disabled')}
            >
>>>>>>> Stashed changes
              {statusStr === 'disabled' ? 'Enable' : 'Disable'}
            </button>
            <button
              className="btn-pro secondary"
<<<<<<< Updated upstream
              style={{ flex: 1, fontSize: '10px' }}
              onClick={() => handlePriceChange(rig)}>
=======
              style={{ flex: '1 1 90px', fontSize: '10px' }}
              onClick={() => handlePriceChange(rig)}
            >
>>>>>>> Stashed changes
              Price
            </button>
          </>
        )}
        {isRented && info && onOpenCompletionCalculator && (
<<<<<<< Updated upstream
          <button className="btn-pro secondary" style={{ flex: 1, fontSize: '10px' }} onClick={() => onOpenCompletionCalculator(rig, info)}>Calc</button>
        )}
        <div style={{ display: 'flex', flex: 1, gap: '4px' }}>
          <button
            className="btn-pro"
            style={{ flex: 1, fontSize: '10px' }}
            onClick={() => fetchRigDetailInfo(rig)}
            disabled={loadingInfoIds.has(rig.id)}>
            {loadingInfoIds.has(rig.id) ? '...' : 'More'}
          </button>
          <button
            className="btn-pro secondary"
            style={{ width: '32px', fontSize: '10px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => {
              setEnrichedInfo(prev => {
                const next = { ...prev };
                delete next[rig.id];
                return next;
              });
              fetchRigDetailInfo(rig);
            }}
            disabled={loadingInfoIds.has(rig.id)}
            title="Reload Rig Details">
            {loadingInfoIds.has(rig.id) ? '...' : '♻️'}
          </button>
        </div>
=======
          <button className="btn-pro secondary" style={{ flex: '1 1 90px', fontSize: '10px' }} onClick={() => onOpenCompletionCalculator(rig, info)}>Calc</button>
        )}
        <button
          className="btn-pro"
          style={{ flex: '1 1 90px', fontSize: '10px' }}
          onClick={() => fetchRigDetailInfo(rig)}
          disabled={loadingInfoIds.has(rig.id)}
        >
          {loadingInfoIds.has(rig.id) ? '...' : 'More'}
        </button>
        <button
          className="btn-pro secondary"
          style={{ width: '36px', fontSize: '12px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => {
            setEnrichedInfo((prev) => {
              const next = { ...prev };
              delete next[rig.id];
              return next;
            });
            fetchRigDetailInfo(rig);
          }}
          disabled={loadingInfoIds.has(rig.id)}
          title="Reload Rig Details"
        >
          {loadingInfoIds.has(rig.id) ? '...' : '↻'}
        </button>
>>>>>>> Stashed changes
      </div>
    </div>
  );
};

export default MrrRigCard;