import React, { useState, useEffect, useMemo } from 'react';
import { poolApi } from '../core/poolUtils';
import { CountdownTimer } from './MiningRigRental';
import { normalizeAlgoForNiceHash } from '../core/algoMapping';
import { getPriceData as getPriceDataUtils, getBtcPriceData as getBtcPriceDataUtils, parsePriceValue as parsePriceValueUtils } from '../core/priceUtils';
import { useRentedRigs } from './RentedRigContext';

/** Power factor mapping for normalization (EH/s base) */
const UNIT_TO_POWER = {
  'EH': 0, 'PH': -3, 'TH': -6, 'GH': -9, 'MH': -12,
  'E': 0, 'P': -3, 'T': -6, 'G': -9, 'M': -12,
  'EHS': 0, 'PHS': -3, 'THS': -6, 'GHS': -9, 'MHS': -12
};
const NICEHASH_BASE_UNIT = 'PH';
const MRR_BASE_UNIT = 'TH';
const NICEHASH_BASE_POWER = UNIT_TO_POWER[NICEHASH_BASE_UNIT];
const MRR_BASE_POWER = UNIT_TO_POWER[MRR_BASE_UNIT];

/** Robustly extract base unit (e.g., 'GH/s' or 'BTC/TH/Day' -> 'GH' or 'TH') */
const clean = (u) => {
  const m = String(u || '').toUpperCase().trim().match(/(EH|PH|TH|GH|MH|KH|H|E|P|T|G|M|K)/);
  if (!m) return 'TH';
  let unit = m[0];
  const singleMap = { 'E': 'EH', 'P': 'PH', 'T': 'TH', 'G': 'GH', 'M': 'MH', 'K': 'KH', 'EHS': 'EH', 'PHS': 'PH', 'THS': 'TH', 'GHS': 'GH', 'MHS': 'MH' };
  return singleMap[unit] || unit;
};

const convertPriceToBaseUnit = (price, priceUnit) => {
  const unit = clean(priceUnit);
  const power = UNIT_TO_POWER[unit] ?? -6;
  return price / Math.pow(10, power);
};

const convertPriceBetweenUnits = (price, fromUnit, toUnit) => {
  const fromPower = UNIT_TO_POWER[clean(fromUnit) || ''] ?? -6;
  const toPower = UNIT_TO_POWER[clean(toUnit) || ''] ?? -6;
  return price * Math.pow(10, fromPower - toPower);
};

const normalizePriceForComparison = (price, priceUnit) => {
  return convertPriceToBaseUnit(convertPriceBetweenUnits(price, priceUnit, MRR_BASE_UNIT), priceUnit);
};

const normalizeNiceHashPriceForComparison = (price, priceUnit) => {
  return convertPriceToBaseUnit(convertPriceBetweenUnits(price, priceUnit, NICEHASH_BASE_UNIT), priceUnit);
};

const normalizeMrrPriceForComparison = (price, priceUnit) => {
  return convertPriceToBaseUnit(convertPriceBetweenUnits(price, priceUnit, MRR_BASE_UNIT), priceUnit);
};

const calculatePriceDifferencePercentage = (mrrPrice, mrrUnit, nhPrice, nhUnit) => {
  const mrrPriceNorm = normalizeMrrPriceForComparison(mrrPrice, mrrUnit);
  const nhPriceNorm = normalizeNiceHashPriceForComparison(nhPrice, nhUnit);

  if (nhPriceNorm <= 0 || mrrPriceNorm <= 0) return null;

  return ((mrrPriceNorm - nhPriceNorm) / nhPriceNorm * 100).toFixed(8);
};

const nicehashPriceToMrrUnit = (price, priceUnit) => {
  return convertPriceBetweenUnits(price, NICEHASH_BASE_UNIT, MRR_BASE_UNIT);
};

// NiceHash prices are typically in BTC/TH/day
/**
 * Reusable logic to calculate the price difference percentage between MRR and NiceHash.
 */
export function calculatePriceComparison(mrrPrice, mrrUnit, nhPrice, nhUnit) {
  const nhPriceNum = Number.parseFloat(nhPrice || 0);
  const mrrPriceNum = Number.parseFloat(mrrPrice || 0);

  if (nhPriceNum <= 0 || mrrPriceNum <= 0) return null;
  const mrrUnitClean = clean(mrrUnit) || 'TH';
  const nhUnitClean = clean(nhUnit) || 'TH';

  // Get power factors (10^n), defaulting to TeraHash (-6 relative to EH)
  const mrrP = UNIT_TO_POWER[mrrUnitClean] ?? -6;
  const nhP = UNIT_TO_POWER[nhUnitClean] ?? -6;

  // Normalize to base unit (H/s equivalent) for fair comparison
  const mrrPriceNorm = mrrPriceNum / Math.pow(10, mrrP);
  const nhPriceNorm = nhPriceNum / Math.pow(10, nhP);

  return ((mrrPriceNorm - nhPriceNorm) / nhPriceNorm * 100).toFixed(1);
}

/** Deeply searches for a rig array in the MRR response */
function findRigArray(obj) {
  if (!obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.rigs)) return obj.rigs;
  if (Array.isArray(obj.data)) return obj.data;

  for (const key in obj) {
    const result = findRigArray(obj[key]);
    if (result && result.length > 0) return result;
  }
  return [];
}

/** Helper to style client badges */
const getClientBadgeStyle = (client) => {
  const c = String(client || '').toUpperCase();
  const styles = {
    'BT': { background: '#2563eb', color: '#fff' }, // Blue
    'SL': { background: '#d97706', color: '#fff' }, // Orange
    'LN': { background: '#0891b2', color: '#fff' }, // Cyan
    'VN': { background: '#10b981', color: '#fff' }, // Green
  };
  return styles[c] || { background: 'rgba(255,255,255,0.1)', color: '#94a3b8' };
};

function formatHashrateValue(rate) {
  if (!rate) return '0 N/A';
  if (typeof rate === 'string' || typeof rate === 'number') return String(rate);
  if (rate.nice) return rate.nice;
  const hash = rate.hash ?? rate.advertised ?? 0;
  const parsed = Number.parseFloat(hash);
  const displayHash = Number.isFinite(parsed) ? parsed.toFixed(2) : String(hash);
  return `${displayHash} ${String(rate.type || '').toUpperCase()}`.trim();
}

function getRawHashrate(rate) {
  if (!rate) return 0;
  if (typeof rate === 'number') return rate;
  if (typeof rate === 'string') return parseFloat(rate) || 0;
  return parseFloat(rate.hash ?? rate.hashrate ?? rate.advertised ?? 0);
}

function parsePriceValueLocal(price) {
  if (price === undefined || price === null) return 0;
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const cleaned = price.replace(/,/g, '').replace(/[^\d.-]/g, '');
    return parseFloat(cleaned) || 0;
  }
  if (typeof price === 'object') {
    const candidate = price.price ?? price.paid ?? price.advertised ?? price.amount ?? price.total;
    if (candidate !== undefined) return parsePriceValueLocal(candidate);
    const nested = Object.values(price).find(val => typeof val === 'object' && (val.price !== undefined || val.paid !== undefined));
    if (nested) return parsePriceValueLocal(nested.price ?? nested.paid);
  }
  return 0;
}

function getPriceDataLocal(source) {
  if (source === undefined || source === null) return { value: 0, currency: 'BTC' };
  if (typeof source === 'number') return { value: source, currency: 'BTC' };
  if (typeof source === 'string') return { value: parsePriceValueLocal(source), currency: 'BTC' };

  const obj = source;
  if (typeof obj === 'object') {
    const getObjValue = (key) => {
      const normalized = obj[key];
      if (normalized === undefined) return undefined;
      if (typeof normalized === 'object') {
        const nested = normalized.paid ?? normalized.price ?? normalized.amount ?? normalized.total ?? normalized.value ?? normalized;
        return parsePriceValueLocal(nested);
      }
      return parsePriceValueLocal(normalized);
    };

    const currency = String(obj.currency || obj.price_unit || 'BTC').toUpperCase();

    const preferredKeys = ['BTC', 'USD', 'LTC'];
    for (const key of preferredKeys) {
      const value = getObjValue(key);
      if (value !== undefined) return { value, currency: key.toUpperCase() };
    }

    const directValue = obj.paid ?? obj.price ?? obj.advertised ?? obj.amount ?? obj.total;
    if (directValue !== undefined) return { value: parsePriceValueLocal(directValue), currency };

    // fallback to first numeric child field, but ignore paid-only values
    for (const key of Object.keys(obj)) {
      if (key === 'paid' || key === 'currency' || key === 'price_unit') continue;
      const v = getObjValue(key);
      if (v !== undefined) return { value: v, currency: key.toUpperCase() };
    }
  }

  return { value: 0, currency: 'BTC' };
}

function getBtcPriceDataLocal(source) {
  const candidate = getPriceDataLocal(source);
  if (candidate.currency === 'BTC' && candidate.value > 0) return candidate;
  if (!source || typeof source !== 'object') return { value: 0, currency: candidate.currency };

  const nestedBtc = source.BTC || source.btc || source['BTC'] || source['btc'];
  if (nestedBtc) {
    const nestedData = getPriceDataLocal(nestedBtc);
    if (nestedData.currency === 'BTC' && nestedData.value > 0) return nestedData;
  }

  // Some MRR payloads include an explicit converted BTC object or field
  const explicitBtcSource = source.price ?? source.advertised ?? source.amount ?? source.total;
  if (explicitBtcSource && candidate.currency !== 'BTC') {
    const fallback = getPriceDataLocal(explicitBtcSource);
    if (fallback.currency === 'BTC' && fallback.value > 0) return fallback;
  }

  return { value: 0, currency: candidate.currency };
}

function getNiceHashPriceValue(rawNhData) {
  const nhData = rawNhData?.price || rawNhData;
  if (nhData === undefined || nhData === null) return 0;
  if (typeof nhData === 'number') return nhData;
  if (typeof nhData === 'string') return parsePriceValueUtils(nhData);

  const candidate = nhData.fixedPrice ?? nhData.standardPrice?.fast ?? nhData.standardPrice ?? nhData.price ?? nhData.amount ?? nhData.total ?? 0;
  return parsePriceValueUtils(candidate);
}

function getRentalStartTime(rental) {
  return rental?.start || rental?.normalized?.startTime || null;
}

function formatRentalStartTime(startTime) {
  if (!startTime) return 'N/A';
  const normalized = /\bUTC\b/i.test(String(startTime)) ? String(startTime) : `${startTime} UTC`;
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return startTime;

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return `Starts at ${date.toLocaleTimeString()}`;

  const diffSec = Math.floor(diffMs / 1000);
  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);

  let elapsed = '';
  if (d > 0) elapsed += `${d}d `;
  if (h > 0 || d > 0) elapsed += `${h}h `;
  elapsed += `${m}m`;

  return `${elapsed}`;
}

function getRentalEndTime(rental) {
  return rental?.end || rental?.normalized?.endTime || null;
}

function getRentalAlgorithm(rental) {
  return rental?.rig?.type || rental?.algorithm || rental?.algorithm || rental?.normalized?.algorithm || 'N/A';
}

function getRental5mHashrate(rental) {
  const rate = rental?.hashrate?.last_5min || rental?.rig?.hashrate?.last_5min;
  return formatHashrateValue(rate) || rental?.normalized?.nice5mHashrate || '0 N/A';
}

function getRental15mHashrate(rental) {
  const rate = rental?.hashrate?.last_15min || rental?.rig?.hashrate?.last_15min;
  return formatHashrateValue(rate) || rental?.normalized?.nice15mHashrate || '0 N/A';
}

function getRentalCurrentHashrate(rental) {
  const rate = rental?.hashrate?.current || rental?.rig?.hashrate?.last_15min || rental?.hashrate?.last_15min || rental?.rig?.hashrate?.current;
  return formatHashrateValue(rate) || rental?.normalized?.niceHashrate || '0 N/A';
}

function getRentalAdvertisedHashrate(rental) {
  const rate = rental?.hashrate?.advertised || rental?.rig?.hashrate?.advertised;
  return formatHashrateValue(rate) || rental?.normalized?.niceAdvertisedHashrate || '0 N/A';
}

function getRentalAverageHashrate(rental) {
  const rate = rental?.hashrate?.average || rental?.rig?.hashrate?.average;
  return formatHashrateValue(rate) || rental?.normalized?.niceAverageHashrate || '0 N/A';
}

function getRentalEfficiency(rental) {
  return String(rental?.hashrate?.average?.percent || rental?.normalized?.percent || '0');
}

export default function MrrRigs({ onCall, mrrClient, onOpenPool, onOpenCompletionCalculator, onInfo, endpoint = '/rig/mine', algo, initialStatus = 'available' }) {
  const { rentedRigs: nhOrders } = useRentedRigs();
  const [rigs, setRigs] = useState([]);
  const [userRigIds, setUserRigIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [enrichedInfo, setEnrichedInfo] = useState({}); // rigId -> details object
  const [loadingInfoIds, setLoadingInfoIds] = useState(new Set());
  const [algoMarketPrices, setAlgoMarketPrices] = useState({}); // algoName -> priceData

  const [expandedPools, setExpandedPools] = useState(new Set());
  const togglePoolInfo = (rigId) => {
    setExpandedPools(prev => {
      const next = new Set(prev);
      if (next.has(rigId)) next.delete(rigId);
      else next.add(rigId);
      return next;
    });
  };

  const [expandedAlgos, setExpandedAlgos] = useState({}); // algoKey -> boolean
  // More granular status filtering: 'available', 'rented', or 'all'
  const [statusFilter, setStatusFilter] = useState(endpoint === '/rig' ? initialStatus : 'rented');

  const stats = useMemo(() => {
    return {
      total: rigs.length,
      available: rigs.filter(r => String(typeof r.status === 'object' ? r.status.status : r.status || '').toLowerCase().includes('available')).length,
      rented: rigs.filter(r => String(typeof r.status === 'object' ? r.status.status : r.status || '').toLowerCase().includes('rented')).length,
    };
  }, [rigs]);

  // Debug count to see if items are being filtered out
  const totalFetchedCount = rigs.length;

  const filteredRigs = useMemo(() => {
    return rigs.filter(rig => {
      if (statusFilter === 'all') return true;
      const statusValue = typeof rig.status === 'object' ? rig.status.status : rig.status;
      return String(statusValue || '').toLowerCase().includes(statusFilter);
    });
  }, [rigs, statusFilter]);

  const groupedRigs = useMemo(() => {
    const groups = {};
    filteredRigs.forEach(rig => {
      const info = enrichedInfo[rig.id];
      const algoKey = (info?.algo || rig.algo || rig.algorithm || rig.type || 'N/A').toUpperCase();
      if (!groups[algoKey]) groups[algoKey] = [];
      groups[algoKey].push(rig);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRigs, enrichedInfo]);

  // Automatically fetch NiceHash market prices for displayed algorithms
  useEffect(() => {
    const uniqueAlgos = [...new Set(filteredRigs.map(r => (r.algo || r.algorithm || r.type || 'N/A').toUpperCase()))];
    uniqueAlgos.forEach(async (algo) => {
      if (algo && algo !== 'N/A' && !algoMarketPrices[algo]) {
        try {
          const nhAlgo = normalizeAlgoForNiceHash(algo);

          const fetchPrice = async (path) => {
            const data = await onCall(path, {
              query: { algorithm: nhAlgo, market: 'USA' },
              silent: true
            });
            return data?.price || data;
          };

          let nhPriceData = await fetchPrice('/api/v2/hashpower/business/order');
          if (!nhPriceData || getNiceHashPriceValue(nhPriceData) <= 0) {
            nhPriceData = await fetchPrice('/api/v2/hashpower/order/price');
          }

          if (nhPriceData && getNiceHashPriceValue(nhPriceData) > 0) {
            setAlgoMarketPrices(prev => ({ ...prev, [algo]: nhPriceData }));
          }
        } catch (e) {
          console.warn(`[nh:price] Failed to fetch for ${algo}`, e);
        }
      }
    });
  }, [filteredRigs, mrrClient]);

  const toggleAlgoGroup = (algo) => {
    setExpandedAlgos(prev => ({
      ...prev,
      [algo]: !prev[algo]
    }));
  };

  const fetchRigs = async () => {
    setLoading(true);
    setError('');
    setEnrichedInfo({}); // Optional: clear cached details on full refresh to avoid UI state mismatch
    try {
      // 1. Prepare parameters for Marketplace
      const params = { endpoint };

      if (endpoint === '/rig') {
        if (algo) params.algo = String(algo).trim();

        // Server-side status filtering for the Marketplace
        if (statusFilter !== 'all') {
          params.status = statusFilter;
        }
      }

      const result = await poolApi.mrrRigs(mrrClient, endpoint, params);

      if (result.ok) {
        const rigList = findRigArray(result.data);

        // 2. Identify "My Rigs" if in Marketplace view
        if (endpoint === '/rig') {
          const myRigsResult = await poolApi.mrrRigs(mrrClient, '/rig/mine');
          if (myRigsResult.ok) {
            const myRigsPayload = myRigsResult.data?.data || myRigsResult.data || [];
            const myRigsArray = Array.isArray(myRigsPayload) ? myRigsPayload : (myRigsPayload.rigs || []);
            const myIds = new Set(myRigsArray.map(r => String(r.id || r.rigid || r.rig_id || '').trim()).filter(Boolean));
            setUserRigIds(myIds);
          }
        } else {
          setUserRigIds(new Set(rigList.map(r => String(r.id))));
        }

        setRigs(rigList);
      } else {
        setError(result.data?.message || 'Failed to fetch MRR rigs');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRigDetailInfo = async (rig) => {
    const statusStr = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
    const isRented = statusStr.includes('rented') || statusStr.includes('active');

    // Extract physical Rig ID and Rental ID correctly for fetching detailed info
    const rigId = rig.rigid || rig.rig_id || rig.rig?.id || (isRented ? '' : rig.id);
    const rentalId = rig.rentalid || rig.current_rental_id || rig.rental_id || (isRented ? rig.id : '');

    if (typeof onCall !== 'function') {
      console.error("fetchRigDetailInfo: onCall is not a function. Check prop passing in parent component.");
      return;
    }

    setLoadingInfoIds(prev => new Set(prev).add(rig.id));
    try {
      const path = (isRented && rentalId)
        ? `/api/v2/mrr/rental/${encodeURIComponent(rentalId)}`
        : `/api/v2/mrr/rig/${encodeURIComponent(rigId || rig.id)}/info`;

      const data = await onCall(path, {
        query: { client: mrrClient },
        silent: true
      });

      if (data && !data.error) {
        let infoBoxData;
        if (isRented && rentalId) {
          const rental = data.data || data;
          const pools = rental.pools || [];
          const firstPool = pools[0];

          // Normalize NH data if present in rental info
          const nhPriceData = rental.nicehashPrice?.price || rental.nicehashPrice;

          infoBoxData = {
            stratumHost: firstPool?.host || firstPool?.stratumHost || firstPool?.stratumHostname || rental.rig?.stratumHost || rental.rig?.host || rental.rig?.stratumHostname || 'N/A',
            stratumPort: firstPool?.port || firstPool?.stratumPort || rental.rig?.stratumPort || rental.rig?.port || '',
            username: firstPool?.user || firstPool?.username || rental.rig?.username || rental.rig?.user || 'N/A',
            algo: getRentalAlgorithm(rental),
            percent: getRentalEfficiency(rental),
            startTime: getRentalStartTime(rental),
            endTime: getRentalEndTime(rental),
            advertised: getRentalAdvertisedHashrate(rental), // For display
            average: getRentalAverageHashrate(rental),       // For display
            current: getRentalCurrentHashrate(rental),
            last5m: getRental5mHashrate(rental),
            last15m: getRental15mHashrate(rental),
            rawAds: getRawHashrate(rental.hashrate?.advertised || rental.advertised),
            rawAvg: getRawHashrate(rental.hashrate?.average || rental.average),
            pools: pools.map(p => ({
              host: p.host || p.stratumHost || p.stratumHostname || rental.rig?.stratumHost || rental.rig?.host || 'N/A',
              port: p.port || p.stratumPort || rental.rig?.stratumPort || rental.rig?.port || 'N/A',
              username: p.user || p.username || rental.rig?.username || rental.rig?.user || 'N/A',
            })),
            isRental: true,
            nicehashPrice: nhPriceData,
            price: rental.price, // Add rental price from the API response
            currency: rental.currency || '', // Add rental currency from the API response
            duration: rental.hours || rental.length || rental.duration || 0
          };
        } else {
          // For rig info, the data is already structured correctly by the backend's extractRigInfo
          infoBoxData = data;
        }
        setEnrichedInfo(prev => ({ ...prev, [rig.id]: infoBoxData }));
      }
    } catch (err) {
      console.error("Failed to fetch rig info:", err);
    } finally {
      setLoadingInfoIds(prev => {
        const next = new Set(prev);
        next.delete(rig.id);
        return next;
      });
    }
  };

  useEffect(() => {
    if (mrrClient && endpoint) fetchRigs(); // Re-fetch if endpoint changes
  }, [mrrClient, endpoint]);

  // Auto-fetch details for rented rigs so "Started X ago" and "Eff" show up automatically
  useEffect(() => {
    if (loading || typeof onCall !== 'function') return;

    const syncRentedDetails = async () => {
      const rentedWithoutInfo = filteredRigs.filter(r => {
        const s = String(typeof r.status === 'object' ? r.status.status : r.status || '').toLowerCase();
        return (s.includes('rented') || s.includes('active')) && !enrichedInfo[r.id] && !loadingInfoIds.has(r.id);
      });

      if (rentedWithoutInfo.length > 0) {
        for (const rig of rentedWithoutInfo) {
          // Sequential await prevents nonce overlap for the same account
          await fetchRigDetailInfo(rig);
          // Add a small safety gap
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    };

    syncRentedDetails();
  }, [filteredRigs, enrichedInfo, loading, loadingInfoIds, onCall]);

  const getStatusClass = (status) => {
    const statusValue = typeof status === 'object' ? status.status : status;
    const s = String(statusValue || '').toLowerCase();
    if (s.includes('available') || s.includes('online')) return { color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)' };
    if (s.includes('rented')) return { color: '#a78bfa', background: 'rgba(167, 139, 250, 0.1)', border: '1px solid rgba(167, 139, 250, 0.2)' };
    if (s.includes('offline') || s.includes('disabled')) return { color: '#f87171', background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.2)' };
    return '';
  };

  const getRoiColor = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '#94a3b8';

    const clamped = Math.max(-100, Math.min(100, num));
    if (clamped === 0) return '#fbbf24';

    if (clamped > 0) {
      const t = Math.min(1, clamped / 100);
      const hue = 48 + (72 * t);
      return `hsl(${hue}, 95%, 58%)`;
    }

    const t = Math.min(1, Math.abs(clamped) / 100);
    const hue = 8 + (40 * (1 - t));
    return `hsl(${hue}, 92%, 58%)`;
  };

  return (
    <div className="mrr-rigs-dashboard">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '15px' }}>
        <div>
          <h2 style={{ margin: 0 }}>{endpoint === '/rig' ? 'MRR Marketplace' : 'RIGS'} ({mrrClient})</h2>
          <small style={{ opacity: 0.3 }}>
            Showing {filteredRigs.length} of {totalFetchedCount} rigs {algo && `for ${algo}`}
          </small>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button className="btn-pro secondary" onClick={fetchRigs} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error-message" style={{ margin: '15px 0', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', color: '#f87171' }}><strong>Error:</strong> {error}</div>}

      {/* Status Dashboard */}
      <div className="rigs-summary-bar" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '15px', marginBottom: '20px' }}>
        <div className="stat-card-mini" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '10px', opacity: 0.5, textTransform: 'uppercase' }}>Total Rigs</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{stats.total}</div>
        </div>
        <div className="stat-card-mini" style={{ background: 'rgba(16, 185, 129, 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
          <div style={{ fontSize: '10px', color: '#10b981', textTransform: 'uppercase' }}>Available</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981' }}>{stats.available}</div>
        </div>
        <div className="stat-card-mini" style={{ background: 'rgba(167, 139, 250, 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(167, 139, 250, 0.2)' }}>
          <div style={{ fontSize: '10px', color: '#a78bfa', textTransform: 'uppercase' }}>Rented</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#a78bfa' }}>{stats.rented}</div>
        </div>
        <div className="stat-card-mini" style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          {(() => {
            const effs = rigs.map(r => parseFloat(r.percent || r.hashrate?.average?.percent || 0)).filter(e => e > 0);
            const avg = effs.length ? (effs.reduce((a, b) => a + b, 0) / effs.length) : 100;
            const roi = avg - 100;
            const roiColor = getRoiColor(roi);
            return (
              <>
                <div style={{ fontSize: '10px', color: roiColor, textTransform: 'uppercase' }}>Global Avg ROI</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: roiColor }}>
                  {roi > 0 ? '+' : ''}{roi.toFixed(1)}%
                </div>
              </>
            );
          })()}
        </div>
      </div>

      <div className="rig-list" style={{ marginTop: '15px', position: 'relative', flexGrow: 1, display: 'flex', flexDirection: 'column', maxHeight: '800px', overflowY: 'auto', paddingRight: '2px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(143, 64, 64, 0.59) transparent', overscrollBehavior: 'contain' }}>
        {filteredRigs.length === 0 && !loading && !error && (
          <div style={{ opacity: 0.5, textAlign: 'center', padding: '20px' }}>No rigs found for this account.</div>
        )}

        <div className="rig-grid-container" style={{
          minHeight: '800px',
          maxHeight: 'auto',
          overflowY: 'auto',
          paddingRight: '8px',
          overscrollBehavior: 'contain'
        }}>
          {groupedRigs.map(([algoName, rigsInGroup]) => {
            const isExpanded = expandedAlgos[algoName];
            return (
              <div key={algoName} className="algo-group-container" style={{ marginBottom: '10px' }}>
                <div
                  className="algo-group-header"
                  onClick={() => toggleAlgoGroup(algoName)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 15px',
                    background: isExpanded ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.05)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '14px', color: isExpanded ? '#60a5fa' : '#94a3b8', fontWeight: 'bold' }}>{algoName}</span>
                    <span style={{ fontSize: '10px', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '10px', opacity: 0.7 }}>{rigsInGroup.length} Rigs</span>
                  </div>
                  <span style={{ fontSize: '12px', opacity: 0.5 }}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {isExpanded && (
                  <div className="rig-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '12px',
                    padding: '10px 5px'
                  }}>
                    {rigsInGroup.map((rig) => {
                      const rigId = rig.id || rig.rigid || rig.rig_id;
                      const isMine = rigId && userRigIds.has(String(rigId));
                      const info = enrichedInfo[rig.id];
                      const statusStr = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
                      const isRented = statusStr.includes('rented');
                      const rentalId = rig.rentalid || rig.current_rental_id || rig.rental_id;
                      const displayId = (isRented && rentalId) ? rentalId : rig.id;
                      const idLabel = (isRented && rentalId) ? 'Rental' : 'Rig';

                      const rawNhData = algoMarketPrices[algoName.toUpperCase()] || info?.nicehashPrice;
                      // Support both direct results and results wrapped in a 'price' property
                      const nhBase = Array.isArray(rawNhData) ? rawNhData[0] : rawNhData;
                      const nhData = nhBase?.price || nhBase;

                      const adsVal = info?.rawAds || getRawHashrate(rig.hashrate?.advertised || rig.advertised);

                      const displayPriceData = getPriceDataLocal(rig.price || info?.price || rig.min_price);
                      const displayPrice1000 = displayPriceData.value;
                      const BASE_UNIT_FACTOR = 1000; // API returns price per 1000 hashes for most algos
                      const isEquihash = algoName.toLowerCase() === 'equihash';
                      const displayPrice = isEquihash
                        ? displayPrice1000
                        : displayPrice1000 * BASE_UNIT_FACTOR;//
                      const displayPriceCurrency = displayPriceData.currency || 'BTC';
                      const paidAmount = parsePriceValueLocal(info?.price?.paid ?? rig.price?.paid);
                      const paidCurrency = info?.price?.currency || info?.price?.price_unit || rig.price?.currency || rig.price?.price_unit || rig.currency || info?.currency || '';
                      const paidLabel = paidAmount > 0 && paidCurrency ? `${paidAmount.toFixed(8)} ${paidCurrency}` : null;

                      const effectivePriceSource = (info?.price?.paid !== undefined || rig.price?.paid !== undefined)
                        ? { ...(rig.price || {}), ...(info?.price || {}), paid: info?.price?.paid ?? rig.price?.paid, currency: String(info?.price?.currency || rig.price?.currency || info?.price?.price_unit || rig.price?.price_unit || 'BTC').toUpperCase() }
                        : rig.price_converted || info?.price_converted || info?.price?.BTC || rig?.price?.BTC || rig.price || info?.price || rig.min_price;

                      const effectiveCostData = (info?.price?.paid !== undefined || rig.price?.paid !== undefined)
                        ? { value: parsePriceValueLocal(info?.price?.paid ?? rig.price?.paid), currency: String(info?.price?.currency || rig.price?.currency || info?.price?.price_unit || rig.price?.price_unit || 'BTC').toUpperCase() }
                        : displayPriceData;

                      const btcPriceData = getBtcPriceDataUtils(effectivePriceSource);
                      const mrrComparePriceValue = btcPriceData.value;

                      const nhPriceValue = getNiceHashPriceValue(rawNhData);
                      const hasNhPrice = nhPriceValue > 0;

                      // Check if the source price is a total paid amount or a rate
                      const isTotalCost = info?.price?.paid !== undefined || rig.price?.paid !== undefined;

                      const mrrPriceNum = (() => {
                        let val = mrrComparePriceValue;
                        if (typeof val === 'string') {
                          val = parseFloat(val.replace(/,/g, '')) || 0;
                        }
                        const hours = parseFloat(rig.hours || rig.length || info?.duration || 0);
                        if (isTotalCost && adsVal > 0 && hours > 0) {
                          // Convert total BTC cost to BTC/Unit/Day rate for comparison
                          return val / (hours / 24) / adsVal;
                        }
                        return Number.isFinite(val) ? val : 0;
                      })();

                      const diffPercent = calculatePriceComparison(
                        mrrPriceNum,
                        rig.hashrate_unit || rig.hashrate?.advertised?.type || rig.hashrate?.suffix || '',
                        nhPriceValue,
                        nhData?.speedUnit || nhData?.unit || ''
                      );

                      // Find our specific active NiceHash order for this algorithm
                      const myNhOrder = nhOrders.find(o => normalizeAlgoForNiceHash(o.algo) === normalizeAlgoForNiceHash(algoName));
                      const myNhOrderPrice = myNhOrder ? parseFloat(myNhOrder.price) : 0;

                      const nhPriceWithFee = myNhOrderPrice > 0 
                        ? (parseFloat(myNhOrder.add_fee) || (myNhOrderPrice * 1.04)) 
                        : 0;
                      const myOrderDiff = myNhOrderPrice > 0 && mrrPriceNum > 0 ? calculatePriceComparison(
                        mrrPriceNum,
                        rig.hashrate_unit || rig.hashrate?.advertised?.type || rig.hashrate?.suffix || '',
                        nhPriceWithFee,
                        myNhOrder.marketUnit || 'TH'
                      ) : null;

                      // Metrics for compact display
                      const effValue = info?.percent || rig.hashrate?.average?.percent || rig.percent || 0;
                      const eff = parseFloat(effValue).toFixed(2);
                      const rentalStartTime = info?.startTime || rig.start;
                      const rentalEndTime = info?.endTime || rig.end || (typeof rig.status === 'object' ? rig.status.end : null);
                      const startT = new Date(rentalStartTime + (String(rentalStartTime).endsWith('UTC') ? '' : ' UTC')).getTime();
                      const endT = new Date(rentalEndTime + (String(rentalEndTime).endsWith('UTC') ? '' : ' UTC')).getTime();
                      const avgVal = info?.rawAvg || getRawHashrate(rig.hashrate?.average || rig.average || rig.hash);
                      const hSuffix = rig.hashrate?.suffix || rig.hashrate?.advertised?.type || '';
                      const totalMs = endT - startT;
                      const now = Date.now();
                      const elapsedMs = Math.max(0, Math.min(now - startT, totalMs));
                      const remainingMs = Math.max(0, endT - now);
                      const timeProgress = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
                      const totalExpectedHashes = adsVal * (totalMs / 1000);
                      const actualHashesDone = avgVal * (elapsedMs / 1000);
                      const remainingHashesNeeded = totalExpectedHashes - actualHashesDone;
                      const targetHashrate = remainingMs > 0 ? (remainingHashesNeeded / (remainingMs / 1000)) : 0;
                      const isBehind = targetHashrate > adsVal;
                      const displayTarget = targetHashrate < 0 ? 0 : targetHashrate;
                      const rentalPriceDiff = diffPercent !== null ? parseFloat(diffPercent) : null;
                      const rentalMyOrderDiff = myOrderDiff !== null ? parseFloat(myOrderDiff) : null;

                      // Logic for Effect-based colors: red < 50%, orange < 70, green > 90%
                      const effNum = parseFloat(effValue);
                      let effectBg = isMine ? 'rgba(59, 130, 246, 0.1)' : 'rgba(30, 41, 59, 0.4)';
                      let effectBorder = isMine ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.1)';
                      let effectTextColor = '#fbbf24'; // Default amber/yellow for 70-90% range

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
                        <div key={rig.id} style={{ padding: '0' }}>
                          <div className="rig-card" style={{
                            background: effectBg,
                            border: effectBorder,
                            borderRadius: '12px',
                            padding: '10px',
                            position: 'relative',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                            transition: 'transform 0.15s ease'
                          }}>
                            {/* Header Section */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ background: isMine ? '#5c005f' : 'rgba(255,255,255,0.1)', color: 'white', fontSize: '9px', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                                  {idLabel}: #{displayId}
                                  {(mrrClient === 'VN' || rig.mrrClient) && (
                                    <span style={{ ...getClientBadgeStyle(rig.mrrClient || mrrClient), fontSize: '9px', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold', marginLeft: '4px' }}>
                                      {String(rig.mrrClient || mrrClient).toUpperCase()}
                                    </span>
                                  )}
                                </span>
                                <span
                                  style={{
                                    fontSize: '9px',
                                    fontWeight: 'bold',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    letterSpacing: '0.5px',
                                    whiteSpace: 'nowrap',
                                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
                                    ...getStatusClass(rig.status)
                                  }}>
                                  {(() => {
                                    const s = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toUpperCase();
                                    return s.includes('AVAILABLE') ? 'AVAILABLE' : s.includes('RENTED') ? 'RENTED' : s;
                                  })()}
                                </span>
                              </div>
                              <strong style={{ fontSize: '13px', lineHeight: '1.3', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', color: '#f8fafc' }}>
                                {rig.name}
                              </strong>
                            </div>

                            {/* Main Metrics Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '8px', fontSize: '10px' }}>
                              {/* Left Column: Algorithm & Price */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', borderRight: '1px solid rgba(255,255,255,0.05)', paddingRight: '4px' }}>
                                <div>
                                  <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase', marginBottom: '2px' }}>Algorithm</div>
                                  <div style={{ color: '#fc7324', fontWeight: 'bold' }}>{info?.algo || rig.algo || rig.algorithm || rig.type || 'N/A'}</div>
                                </div>
                                <div>
                                  <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase', marginBottom: '2px' }}>Market Price:</div>
                                  <div style={{ color: '#fbbf24', fontSize: '11px', fontWeight: 'bold' }}>
                                    {displayPrice.toFixed(8)}
                                    <small style={{ opacity: 0.5, marginLeft: '2px' }}>{displayPriceCurrency}</small>
                                  </div>
                                  {isRented && paidLabel && (
                                    <div style={{ fontSize: '10px', color: '#10b981', marginTop: '5px', marginBottom: '5px', background: 'rgba(19, 173, 122, 0.06)', padding: '1px 4px', borderRadius: '3px', display: 'inline-block' }}>
                                      Paid: <strong>{paidLabel}</strong>
                                    </div>
                                  )}

                                  {myNhOrder && myNhOrderPrice > 0 && (
                                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '6px', padding: '6px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                      <div style={{ color: '#60a5fa', marginBottom: '2px' }}>
                                        <span style={{ opacity: 0.7, fontSize: '8px', textTransform: 'uppercase' }}>Order Price: </span>
                                        <span style={{ fontWeight: 'bold', color: '#fbbf24' }}>{myNhOrderPrice.toFixed(8)}</span>
                                        <small style={{ opacity: 0.5, marginLeft: '4px' }}>BTC/{myNhOrder.marketUnit || 'TH'}</small>
                                      </div>
                                      <div>
                                        <span style={{ opacity: 0.7, fontSize: '9px', textTransform: 'uppercase' }}>ROI: </span>
                                        <span style={{ fontWeight: 'bold', color: getRoiColor(myOrderDiff) }}>
                                          {parseFloat(myOrderDiff) > 0 ? '+' : ''}{myOrderDiff}%
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Right Column: Performance & Efficiency - Symmetric Redesign */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {/* Efficiency Metric with Integrated Bar */}
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                                    <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase' }}>Efficiency</div>
                                    <div style={{ fontSize: '11px', color: effectTextColor, fontWeight: 'bold' }}>{eff}%</div>
                                  </div>
                                  <div style={{ width: '100%', height: '2px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${Math.min(100, effNum)}%`, height: '100%', background: effectTextColor }} />
                                  </div>
                                </div>

                                {/* Target Metric aligned with Pricing */}
                                <div>
                                  <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase', marginBottom: '2px' }}>Target</div>
                                  <div style={{ color: isBehind ? '#f87171' : '#34d399', fontWeight: 'bold', fontSize: '11px' }}>
                                    {displayTarget.toFixed(2)} <small style={{ opacity: 0.5, fontWeight: 'normal' }}>{hSuffix}</small>
                                  </div>
                                </div>

                                {/* Balanced Hashrate Header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1px' }}>
                                  <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase' }}>Hashrate</div>
                                  {info?.isRental && (
                                    <div style={{ fontSize: '8px', opacity: 0.8 }}>
                                      Adv: <span style={{ color: '#34d399', fontWeight: 'bold' }}>{info.advertised}</span>
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <div>
                                    {(() => {
                                      if (info?.isRental) {
                                        return (
                                          <div style={{
                                            background: 'rgba(0,0,0,0.15)',
                                            padding: '6px 8px',
                                            borderRadius: '6px',
                                            border: '1px solid rgba(255,255,255,0.05)'
                                          }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '10px', color: '#f1f5f9' }}>{info.average || '0 N/A'} <small style={{ fontSize: '8px', opacity: 0.5 }}>(AVG)</small></div>
                                            <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                              <span><span style={{ color: '#60a5fa' }}>5m:</span> {info.last5m?.split(' ')[0] || '0'}</span>
                                              <span><span style={{ color: '#a78bfa' }}>15m:</span> {info.last15m?.split(' ')[0] || '0'}</span>
                                            </div>
                                          </div>
                                        );
                                      }
                                      const hr = rig.hashrate || rig.hash;
                                      if (!hr && hr !== 0) return '0 N/A';
                                      if (typeof hr === 'object') {
                                        // Use Average for rented rigs if available in the payload
                                        if (isRented && hr.average) {
                                          if (typeof hr.average === 'object') {
                                            return hr.average.nice || `${parseFloat(hr.average.hash || 0).toFixed(2)} ${hr.average.type || ''}`.trim();
                                          }
                                          return hr.average;
                                        }
                                        // Fallback to "nice" formatted strings or advertised rate
                                        return hr.advertised?.nice || hr.nice || hr.advertised?.hash || hr.advertised || '0';
                                      }
                                      return hr;
                                    })()}

                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Progress & Time Section */}
                            {isRented && (
                              <div style={{ background: 'rgba(0,0,0,0.1)', padding: '8px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', opacity: 0.8 }}>
                                  <span title={info?.startTime || rig.start || ''}><span style={{ opacity: 0.5, textTransform: 'uppercase' }}>Started: </span>{formatRentalStartTime(info?.startTime || rig.start)}</span>
                                  <span><span style={{ opacity: 0.5, textTransform: 'uppercase' }}>Remain: </span><CountdownTimer endTime={rentalEndTime} /></span>
                                </div>
                                <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div style={{ width: `${timeProgress}%`, height: '100%', background: timeProgress > 90 ? '#f87171' : 'linear-gradient(90deg, #3b82f6, #8b5cf6)', transition: 'width 0.5s ease' }} />
                                </div>
                              </div>
                            )}

                            {expandedPools.has(rig.id) && (info || rig.host) && (
                              <div className="rig-pool-summary" style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px', marginBottom: '10px', fontSize: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <div style={{ marginBottom: '6px' }}>
                                  <div style={{ fontSize: '0.7rem', opacity: 0.5, textTransform: 'uppercase' }}>Pool</div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={rig.host || info?.stratumHost}><span style={{ opacity: 0.7 }}>Host:</span> {rig.host || info?.stratumHost || 'N/A'}</div>
                                  <div><span style={{ opacity: 0.7 }}>Port:</span> {rig.port || info?.stratumPort || 'N/A'}</div>
                                  <div style={{ gridColumn: 'span 2', overflow: 'hidden', textOverflow: 'ellipsis' }} title={rig.user || info?.username}><span style={{ opacity: 0.7 }}>User:</span> {rig.user || info?.username || 'N/A'}</div>
                                </div>
                              </div>
                            )}

                            {/* Actions Section */}
                            <div style={{ display: 'flex', gap: '6px', marginTop: 'auto', paddingTop: '4px' }}>
                              {(isMine || isRented) && (
                                <button
                                  className="btn-pro secondary"
                                  style={{
                                    flex: 1,
                                    fontSize: '9px',
                                    padding: '4px',
                                    background: isRented ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.05)',
                                    borderColor: isRented ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.1)',
                                    color: isRented ? '#a78bfa' : '#94a3b8',
                                    fontWeight: isRented ? 'bold' : 'normal',
                                    borderRadius: '6px'
                                  }}
                                  onClick={() => {
                                    togglePoolInfo(rig.id);
                                    onOpenPool?.(rig, info);
                                  }}
                                >
                                  {expandedPools.has(rig.id) ? 'Hide Pools' : 'Pools'}
                                </button>
                              )}

                              {isRented && info && onOpenCompletionCalculator && (
                                <button
                                  className="btn-pro secondary"
                                  style={{ flex: 1, fontSize: '10px', padding: '4px' }}
                                  onClick={() => onOpenCompletionCalculator(rig, info)}
                                >
                                  Calc
                                </button>
                              )}

                              {isRented && info && (
                                <button
                                  className="btn-pro secondary"
                                  style={{ width: '28px', fontSize: '12px', padding: '4px 0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                  onClick={() => fetchRigDetailInfo(rig)}
                                  disabled={loadingInfoIds.has(rig.id)}
                                  title="Refresh Stats"
                                >
                                  {loadingInfoIds.has(rig.id) ? '...' : '↻'}
                                </button>
                              )}
                              <button
                                className="btn-pro"
                                style={{ flex: 1, fontSize: '10px', padding: '4px' }}
                                onClick={() => info ? setEnrichedInfo(prev => { const n = { ...prev }; delete n[rig.id]; return n; }) : fetchRigDetailInfo(rig)}
                                disabled={loadingInfoIds.has(rig.id)}
                              >
                                {loadingInfoIds.has(rig.id) ? '...' : info ? 'Hide Info' : 'More Info'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
