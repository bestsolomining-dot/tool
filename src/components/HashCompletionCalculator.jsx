import React, { useState, useMemo, useEffect } from 'react';
import { getPriceData as getPriceDataUtils, getBtcPriceData as getBtcPriceDataUtils } from '../core/priceUtils';

function resolveUnit(value) {
  const map = { EH: 1e18, PH: 1e15, LN: 1e15, TH: 1e12, GH: 1e9, MH: 1e6, KH: 1e3, H: 1 };
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value) return 1e12;
  const normalized = String(value).toUpperCase().replace(/\s+/g, '').replace(/\/S$/, '');
  const match = normalized.match(/(EH|PH|LN|TH|GH|MH|KH|H)(?:\/S)?$/) || normalized.match(/(EH|PH|LN|TH|GH|MH|KH|H)/);
  return match && map[match[1]] ? map[match[1]] : 1e12;
}

function normalizeToDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function parsePriceValue(price) {
  if (price === undefined || price === null) return 0;
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const cleaned = price.replace(/,/g, '').replace(/[^\d.-]/g, '');
    return parseFloat(cleaned) || 0;
  }
  if (typeof price === 'object') {
    const candidate = price.price ?? price.paid ?? price.advertised ?? price.amount ?? price.total;
    if (candidate !== undefined) return parsePriceValue(candidate);
    const nested = Object.values(price).find(val => typeof val === 'object' && (val.price !== undefined || val.paid !== undefined));
    if (nested) return parsePriceValue(nested.price ?? nested.paid);
  }
  return 0;
}

function getPriceData(source) {
  if (source === undefined || source === null) return { value: 0, currency: 'BTC' };
  if (typeof source === 'number') return { value: source, currency: 'BTC' };
  if (typeof source === 'string') return { value: parsePriceValue(source), currency: 'BTC' };

  const obj = source;
  if (typeof obj === 'object') {
    const currency = String(obj.currency || obj.price_unit || 'BTC').toUpperCase();
    if (obj.paid !== undefined) {
      return { value: parsePriceValue(obj.paid), currency };
    }
    const directValue = obj.price ?? obj.advertised ?? obj.amount ?? obj.total;
    if (directValue !== undefined) return { value: parsePriceValue(directValue), currency };

    for (const key of Object.keys(obj)) {
      if (key === 'currency' || key === 'price_unit') continue;
      const value = parsePriceValue(obj[key]);
      if (value > 0) return { value, currency: key.toUpperCase() };
    }
  }
  return { value: 0, currency: 'BTC' };
}

function getBtcPriceData(source) {
  const candidate = getPriceData(source);
  if (candidate.currency === 'BTC' && candidate.value > 0) return candidate;
  if (!source || typeof source !== 'object') return { value: candidate.value, currency: candidate.currency };

  const nestedBtc = source.BTC || source.btc || source['BTC'] || source['btc'];
  if (nestedBtc) {
    const nestedData = getPriceData(nestedBtc);
    if (nestedData.currency === 'BTC' && nestedData.value > 0) return nestedData;
  }

  const explicitSource = source.price ?? source.advertised ?? source.amount ?? source.total;
  if (explicitSource) {
    const fallback = getPriceData(explicitSource);
    if (fallback.currency === 'BTC' && fallback.value > 0) return fallback;
  }

  return { value: candidate.value, currency: candidate.currency };
}

function parseHashrateValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? String(parsed) : '';
  }
  if (typeof value === 'object') {
    return parseHashrateValue(value.hash || value.advertised || value.nice || value.value || Object.values(value)[0]);
  }
  return '';
}

export default function HashCompletionCalculator({
  initialAlgo = '',
  initialUnit = 1e12,
  initialAdsHashrate = '',
  initialAvgHashrate = '',
  initialStartTime = '',
  initialEndTime = '',
  initialPriceSource = null,
  initialBtcPriceSource = null,
  initialPriceUnit = 'TH',
}) {
  const [algo, setAlgo] = useState(initialAlgo);
  const [startTime, setStartTime] = useState(normalizeToDateTimeLocal(initialStartTime));
  const [endTime, setEndTime] = useState(normalizeToDateTimeLocal(initialEndTime));
  const [adsHashrate, setAdsHashrate] = useState(initialAdsHashrate);
  const [avgHashrate, setAvgHashrate] = useState(initialAvgHashrate);
  const [unit, setUnit] = useState(resolveUnit(initialUnit));

  const units = [
    { label: 'EH/s', value: 1e18 },
    { label: 'PH/s', value: 1e15 },
    { label: 'TH/s', value: 1e12 },
    { label: 'GH/s', value: 1e9 },
    { label: 'MH/s', value: 1e6 },
  ];

  useEffect(() => {
    setAlgo(initialAlgo || '');
  }, [initialAlgo]);

  useEffect(() => {
    setUnit(resolveUnit(initialUnit));
  }, [initialUnit]);

  useEffect(() => {
    setStartTime(normalizeToDateTimeLocal(initialStartTime));
  }, [initialStartTime]);

  useEffect(() => {
    setEndTime(normalizeToDateTimeLocal(initialEndTime));
  }, [initialEndTime]);

  useEffect(() => {
    setAdsHashrate(initialAdsHashrate || '');
  }, [initialAdsHashrate]);

  useEffect(() => {
    setAvgHashrate(initialAvgHashrate || '');
  }, [initialAvgHashrate]);

  const results = useMemo(() => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const now = new Date();
    const adsValue = parseFloat(adsHashrate);
    const avgValue = parseFloat(avgHashrate);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || isNaN(adsValue) || adsValue <= 0) {
      return null;
    }

    const totalDurationMs = end - start;
    if (totalDurationMs <= 0) return { error: "End time must be after start time." };

    const elapsedMs = Math.max(0, Math.min(now - start, totalDurationMs));
    const remainingMs = Math.max(0, totalDurationMs - elapsedMs);

    const ads = adsValue * unit;
    const avg = (isNaN(avgValue) ? 0 : avgValue) * unit;

    const totalExpectedHashes = ads * (totalDurationMs / 1000);
    const actualHashesDone = avg * (elapsedMs / 1000);
    const remainingHashesNeeded = Math.max(0, totalExpectedHashes - actualHashesDone);

    const priceData = getPriceDataUtils(initialPriceSource);
    const btcPriceData = getBtcPriceDataUtils(initialBtcPriceSource || initialPriceSource);
    const adsValueTh = adsValue * (unit / 1e12);
    const durationDays = totalDurationMs / 86400000;
    const totalBtcCost = btcPriceData.isTotalCost
      ? btcPriceData.value
      : (btcPriceData.isPerHashRate && adsValueTh > 0 && durationDays > 0)
        ? btcPriceData.value * adsValueTh * durationDays
        : 0;
    const rentalBtcPerThPerDay = btcPriceData.isPerHashRate
      ? btcPriceData.value
      : (adsValueTh > 0 && durationDays > 0)
        ? totalBtcCost / (adsValueTh * durationDays)
        : 0;
    const rentalBtcPerHash = totalExpectedHashes > 0 ? totalBtcCost / totalExpectedHashes : 0;

    const currentOverallCompletion = totalExpectedHashes > 0 ? (actualHashesDone / totalExpectedHashes) * 100 : 0;
    const timeProgress = (elapsedMs / totalDurationMs) * 100;

    const remainingSeconds = remainingMs / 1000;
    const requiredHashrateRaw = remainingSeconds > 0 ? remainingHashesNeeded / remainingSeconds : 0;
    const requiredHashrateFormatted = (requiredHashrateRaw > 0 ? requiredHashrateRaw : 0) / unit;

    return {
      durationHrs: (totalDurationMs / 3600000).toFixed(2),
      elapsedHrs: (elapsedMs / 3600000).toFixed(2),
      remainingHrs: (remainingMs / 3600000).toFixed(2),
      totalExpectedHashes,
      actualHashesDone,
      remainingHashesNeeded,
      currentOverallCompletion: currentOverallCompletion.toFixed(2),
      timeProgress: timeProgress.toFixed(2),
      requiredHashrateFormatted: requiredHashrateFormatted.toFixed(2),
      rentalPriceData: priceData,
      rentalBtcCost: totalBtcCost,
      rentalBtcPerThPerDay,
      rentalBtcPerHash,
      priceUnit: initialPriceUnit || 'TH',
      isBehind: currentOverallCompletion < 100 && elapsedMs > 0
    };
  }, [startTime, endTime, adsHashrate, avgHashrate, unit]);

  return (
    <div className="hash-completion-calculator nh-theme" style={{ padding: '15px' }}>
      <h2 className="section-title" style={{ marginBottom: '10px' }}>Rental Completion Calculator</h2>
      {algo && (
        <div style={{ marginBottom: '16px', color: '#94a3b8', fontSize: '13px' }}>
          Rented algorithm: <strong>{algo}</strong>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
        <div className="field">
          <label className="label" style={{ fontSize: '10px' }}>START TIME (LOCAL)</label>
          <input type="datetime-local" className="input-pro" value={startTime} onChange={e => setStartTime(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" style={{ fontSize: '10px' }}>END TIME (LOCAL)</label>
          <input type="datetime-local" className="input-pro" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" style={{ fontSize: '10px' }}>ADS HASHRATE</label>
          <input type="number" className="input-pro" placeholder="e.g. 500" value={adsHashrate} onChange={e => setAdsHashrate(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" style={{ fontSize: '10px' }}>AVG HASHRATE</label>
          <input type="number" className="input-pro" placeholder="e.g. 450" value={avgHashrate} onChange={e => setAvgHashrate(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <label className="label" style={{ fontSize: '10px' }}>HASHRATE UNIT</label>
          <select className="select-pro" value={unit} onChange={e => setUnit(Number(e.target.value))}>
            {units.map(u => <option key={u.label} value={u.value}>{u.label}</option>)}
          </select>
        </div>
      </div>

      {results && !results.error && (
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '20px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '15px' }}>
            <div className="stat-box">
              <div style={{ fontSize: '9px', opacity: 0.5, textTransform: 'uppercase' }}>Total Duration</div>
              <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{results.durationHrs} Hours</div>
            </div>
            <div className="stat-box">
              <div style={{ fontSize: '9px', opacity: 0.5, textTransform: 'uppercase' }}>Time Elapsed</div>
              <div style={{ fontWeight: 'bold', color: '#60a5fa', fontSize: '14px' }}>{results.elapsedHrs}h ({results.timeProgress}%)</div>
            </div>
            <div className="stat-box">
              <div style={{ fontSize: '9px', opacity: 0.5, textTransform: 'uppercase' }}>Total Hash Delivered</div>
              <div style={{ fontWeight: 'bold', color: results.isBehind ? '#f87171' : '#34d399', fontSize: '14px' }}>
                {results.currentOverallCompletion}%
              </div>
            </div>
            <div className="stat-box" style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
              <div style={{ fontSize: '10px', color: '#60a5fa', fontWeight: 'bold', textTransform: 'uppercase' }}>Required Hashrate</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#fff' }}>
                {results.requiredHashrateFormatted} <span style={{ fontSize: '0.8rem' }}>{units.find(u => u.value === unit).label}</span>
              </div>
              <div style={{ fontSize: '9px', opacity: 0.7 }}>Needed for remaining {results.remainingHrs}h to reach 100% total</div>
            </div>
          </div>

          <div style={{ marginTop: '20px', fontSize: '11px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ opacity: 0.6 }}>Hashes Delivered:</span>
              <span style={{ fontFamily: 'monospace' }}>{(results.actualHashesDone / 1e12).toFixed(6)} T-Hashes</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ opacity: 0.6 }}>Total Expected Hashes:</span>
              <span style={{ fontFamily: 'monospace' }}>{(results.totalExpectedHashes / 1e12).toFixed(6)} T-Hashes</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ opacity: 0.6 }}>Rental Price</span>
              <span style={{ fontFamily: 'monospace' }}>{results.rentalPriceData.value.toFixed(8)} {results.rentalPriceData.currency}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ opacity: 0.6 }}>BTC Equivalent</span>
              <span style={{ fontFamily: 'monospace' }}>{results.rentalBtcCost.toFixed(8)} BTC</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ opacity: 0.6 }}>Rental Rate</span>
              <span style={{ fontFamily: 'monospace' }}>{results.rentalBtcPerThPerDay.toFixed(8)} BTC/{results.priceUnit}/day</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.6 }}>Work Deficit:</span>
              <span style={{ color: '#f87171', fontFamily: 'monospace' }}>{(results.remainingHashesNeeded / 1e12).toFixed(6)} T-Hashes</span>
            </div>
          </div>
        </div>
      )}

      {results?.error && (
        <div className="error-message" style={{ color: '#f87171', textAlign: 'center', marginTop: '10px' }}>
          {results.error}
        </div>
      )}

      <div style={{ marginTop: '20px', fontSize: '10px', opacity: 0.4, fontStyle: 'italic', textAlign: 'center' }}>
        Formula: Required = ( (Ads * TotalTime) - (Avg * Elapsed) ) / RemainingTime
      </div>
    </div>
  );
}