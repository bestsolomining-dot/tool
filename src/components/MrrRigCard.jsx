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
import { getAlgoDisplayName, normalizeAlgoForNiceHash, getAlgorithmUnit } from '../core/mapping.js';

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

const hasTotalPriceFields = (value) => {
  if (!value || typeof value !== 'object') return false;
  return ['paid', 'amount', 'total'].some((key) => value[key] !== undefined && value[key] !== null);
};

const MrrRigCard = ({
  rig,
  algoName,
  info,
  isMine,
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
  const rentalId = rig.rentalid || rig.current_rental_id || rig.rental_id;
  const isRented = statusStr.includes('rented') || statusStr.includes('active') || Boolean(rentalId);
  const displayId = (isRented && rentalId) ? rentalId : rig.id;
  const idLabel = (isRented && rentalId) ? 'Rental' : 'Rig';
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    if (!isRented) return undefined;

    const updateNow = () => setNowMs(Date.now());
    updateNow();
    const timer = setInterval(updateNow, 30000);
    return () => clearInterval(timer);
  }, [isRented]);

  const rawNhData = algoMarketPrices?.[algoName?.toUpperCase()] || info?.nicehashPrice;
  const nhBase = Array.isArray(rawNhData) ? rawNhData[0] : rawNhData;

  const adsVal = useMemo(
    () => info?.rawAds || getRawHashrate(rig.hashrate?.advertised || rig.advertised) || 0,
    [info?.rawAds, rig.hashrate?.advertised, rig.advertised]
  );

  const avgVal = useMemo(
    () => info?.rawAvg || getRawHashrate(rig.hashrate?.average || rig.average || rig.hash) || 0,
    [info?.rawAvg, rig.hashrate?.average, rig.average, rig.hash]
  );

  const rentalStartTime = info?.startTime || rig.start;
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

  const priceSource = rig.price || info?.price || rig.min_price;
  const listPriceData = getPriceDataLocal(priceSource);
  const priceLooksTotal = hasTotalPriceFields(rig.price) || hasTotalPriceFields(info?.price);
  const paidAmount = parsePriceValueLocal(info?.price?.paid ?? rig.price?.paid ?? info?.price?.amount ?? rig.price?.amount);
  const paidCurrency = info?.price?.currency || info?.price?.price_unit || rig.price?.currency || rig.price?.price_unit || rig.currency || info?.currency || '';
  const paidLabel = paidAmount > 0 && paidCurrency ? `${paidAmount.toFixed(8)} ${String(paidCurrency).toUpperCase()}` : null;
  const mrrUnit = getAlgorithmUnit(algoName);
  const derivedRatePerUnitDay = paidAmount > 0 && adsVal > 0 && durationHours > 0
    ? paidAmount / (durationHours / 24) / adsVal
    : 0;
  const mrrDailyRate = (!priceLooksTotal && listPriceData.value > 0) ? listPriceData.value : derivedRatePerUnitDay;
  const mrrDailyRateSource = !priceLooksTotal && listPriceData.value > 0 ? 'Listed MRR rate' : 'Derived from paid total';

  const normalizedCardAlgo = normalizeAlgoForNiceHash(algoName);
  const nhOrder = [...(nhOrders || [])]
    .sort((a, b) => Number(Boolean(b?.isActive || b?.rawOrder?.status?.code === 'ACTIVE' || b?.rawOrder?.status === 'ACTIVE')) - Number(Boolean(a?.isActive || a?.rawOrder?.status?.code === 'ACTIVE' || a?.rawOrder?.status === 'ACTIVE')))
    .find((order) => normalizeOrderAlgo(order) === normalizedCardAlgo);

  const marketNhPrice = getNiceHashPriceValue(nhBase);
  const orderNhPrice = getNiceHashPriceValue(nhOrder?.price ?? nhOrder?.rawOrder?.price ?? nhOrder);
  const buyNhPrice = nhOrder && orderNhPrice > 0 ? orderNhPrice : marketNhPrice;
  const buyNhPriceWithFee = buyNhPrice > 0
    ? (Number.parseFloat(nhOrder?.add_fee ?? nhOrder?.priceWithFee ?? 0) > 0
      ? Number.parseFloat(nhOrder.add_fee ?? nhOrder.priceWithFee)
      : buyNhPrice * 1.04)
    : 0;
  const myNhUnit = getAlgorithmUnit(normalizeAlgoForNiceHash(algoName));

  const roiPercent = buyNhPriceWithFee > 0 && mrrDailyRate > 0
    ? ((mrrDailyRate - buyNhPriceWithFee) / buyNhPriceWithFee) * 100
    : null;
  const roiLabel = roiPercent !== null ? formatPercent(roiPercent) : (buyNhPriceWithFee > 0 ? 'Waiting for MRR rate' : 'Waiting for NiceHash rate');

  const mrrDisplayPrice = getPriceDataLocal(rig.price || info?.price || rig.min_price);
  const displayPrice = getAlgoDisplayName(algoName) === 'Equihash'
    ? mrrDisplayPrice.value
    : mrrDisplayPrice.value * 1000;
  const displayPriceCurrency = mrrDisplayPrice.currency || 'BTC';

  const elapsedMs = nowMs > 0 && totalMs > 0 ? Math.max(0, Math.min(nowMs - startT, totalMs)) : 0;
  const timeProgress = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
  const currentPayValue = paidAmount > 0 ? (paidAmount * Math.max(0, Math.min(1, timeProgress / 100))) : 0;

  const targetHashrate = (totalMs - elapsedMs) > 0
    ? ((adsVal * (totalMs / 1000) - avgVal * (elapsedMs / 1000)) / ((totalMs - elapsedMs) / 1000))
    : 0;
  const isBehind = targetHashrate > adsVal;
  const hSuffix = rig.hashrate?.suffix || rig.hashrate?.advertised?.type || '';

  const accent = roiPercent === null
    ? (isMine ? 'rgba(59, 130, 246, 0.30)' : 'rgba(148, 163, 184, 0.18)')
    : roiPercent >= 0
      ? 'rgba(16, 185, 129, 0.30)'
      : 'rgba(239, 68, 68, 0.30)';

  const shellStyle = {
    background: `linear-gradient(180deg, rgba(15, 23, 42, 0.96) 0%, rgba(15, 23, 42, 0.86) 100%), radial-gradient(circle at top right, ${accent} 0%, transparent 48%)`,
    border: `1px solid ${roiPercent === null ? 'rgba(255,255,255,0.08)' : roiPercent >= 0 ? 'rgba(16,185,129,0.28)' : 'rgba(239,68,68,0.28)'}`,
    borderTop: `3px solid ${accent}`,
    borderRadius: '18px',
    padding: '14px',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    boxShadow: '0 18px 40px rgba(0, 0, 0, 0.24)',
    overflow: 'hidden',
  };

  const sectionStyle = {
    background: 'rgba(255,255,255,0.035)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '12px',
  };

  return (
    <article className="rig-card" style={shellStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              background: isMine ? 'rgba(37, 99, 235, 0.18)' : 'rgba(255,255,255,0.08)',
              color: 'white',
              fontSize: '10px',
              padding: '4px 8px',
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
                fontSize: '10px',
                padding: '4px 8px',
                borderRadius: '999px',
                fontWeight: '700'
              }}>
                {rig.mrrClient.toUpperCase()}
              </span>
            )}
            <span style={{
              fontSize: '10px',
              padding: '4px 8px',
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
              fontSize: '18px',
              lineHeight: 1.15,
              color: '#f8fafc',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {rig.name}
          </strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', color: '#94a3b8', fontSize: '11px' }}>
            <span>{getAlgoDisplayName(info?.algo || rig.algo || rig.algorithm || rig.type)}</span>
            <span style={{ opacity: 0.35 }}>•</span>
            <span>{displayPrice.toFixed(8)} {displayPriceCurrency}</span>
            {paidLabel && (
              <>
                <span style={{ opacity: 0.35 }}>•</span>
                <span>Sold {paidLabel}</span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: '8px', minWidth: '180px', textAlign: 'right' }}>
          <div style={{
            padding: '10px 12px',
            borderRadius: '14px',
            background: roiPercent === null ? 'rgba(255,255,255,0.04)' : roiPercent >= 0 ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
            border: `1px solid ${roiPercent === null ? 'rgba(255,255,255,0.08)' : roiPercent >= 0 ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.22)'}`,
          }}>
            <div style={{ fontSize: '10px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>ROI</div>
            <div style={{ fontSize: '24px', lineHeight: 1, fontWeight: 800, color: getRoiColor(roiPercent ?? 0) }}>
              {roiLabel}
            </div>
            <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '4px' }}>
              vs NiceHash buy rate
            </div>
          </div>
          {isRented && (
            <div style={{ fontSize: '11px', opacity: 0.7 }}>
              {formatRentalStartTime(rentalStartTime)}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '12px' }}>
        <section style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
            <div style={{ color: '#e2e8f0', fontWeight: 700 }}>Rental Snapshot</div>
            <div style={{ fontSize: '10px', color: '#94a3b8' }}>{mrrDailyRateSource}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', fontSize: '11px' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '10px' }}>
              <div style={{ opacity: 0.6, textTransform: 'uppercase', fontSize: '9px' }}>MRR Rate</div>
              <div style={{ color: '#fbbf24', fontWeight: 800, marginTop: '4px' }}>
                {mrrDailyRate > 0 ? `${mrrDailyRate.toFixed(8)} BTC/${mrrUnit}/Day` : 'N/A'}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '10px' }}>
              <div style={{ opacity: 0.6, textTransform: 'uppercase', fontSize: '9px' }}>NiceHash Buy</div>
              <div style={{ color: '#60a5fa', fontWeight: 800, marginTop: '4px' }}>
                {buyNhPriceWithFee > 0 ? `${buyNhPriceWithFee.toFixed(8)} BTC/${myNhUnit}/Day` : 'N/A'}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '10px' }}>
              <div style={{ opacity: 0.6, textTransform: 'uppercase', fontSize: '9px' }}>Efficiency</div>
              <div style={{ color: '#34d399', fontWeight: 800, marginTop: '4px' }}>{eff}%</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '10px' }}>
              <div style={{ opacity: 0.6, textTransform: 'uppercase', fontSize: '9px' }}>Target Hashrate</div>
              <div style={{ color: isBehind ? '#f87171' : '#34d399', fontWeight: 800, marginTop: '4px' }}>
                {Math.max(0, targetHashrate).toFixed(2)} <small style={{ opacity: 0.7 }}>{String(hSuffix).toUpperCase()}</small>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8' }}>
            <span>Started: {formatRentalStartTime(rentalStartTime)}</span>
            <span>Remaining: <CountdownTimer endTime={info?.endTime || rig.end} /></span>
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={{ display: 'grid', gap: '10px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '4px' }}>
                <span style={{ opacity: 0.55, textTransform: 'uppercase' }}>Efficiency</span>
                <span style={{ color: effNum >= 100 ? '#22d3ee' : effNum > 90 ? '#10b981' : effNum > 70 ? '#fbbf24' : '#ef4444', fontWeight: 800 }}>{eff}%</span>
              </div>
              <div style={{ width: '100%', height: '7px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Math.max(0, effNum || 0))}%`, height: '100%', background: getRoiColor(effNum), borderRadius: '999px' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '4px' }}>
                <span style={{ opacity: 0.55, textTransform: 'uppercase' }}>Rental Progress</span>
                <span style={{ color: timeProgress > 90 ? '#f87171' : '#8b5cf6', fontWeight: 800 }}>{timeProgress.toFixed(1)}%</span>
              </div>
              <div style={{ width: '100%', height: '7px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Math.max(0, timeProgress || 0))}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)', borderRadius: '999px' }} />
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: '8px',
              fontSize: '10px'
            }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '10px' }}>
                <div style={{ opacity: 0.55, textTransform: 'uppercase' }}>Average</div>
                <div style={{ color: '#e2e8f0', fontWeight: 700, marginTop: '4px' }}>{info?.average || '0 N/A'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '10px' }}>
                <div style={{ opacity: 0.55, textTransform: 'uppercase' }}>Advertised</div>
                <div style={{ color: '#e2e8f0', fontWeight: 700, marginTop: '4px' }}>{info?.advertised || '0 N/A'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '10px' }}>
                <div style={{ opacity: 0.55, textTransform: 'uppercase' }}>Current Pay</div>
                <div style={{ color: '#e2e8f0', fontWeight: 700, marginTop: '4px' }}>
                  {paidAmount > 0 ? `${currentPayValue.toFixed(8)} ${String(paidCurrency).toUpperCase()}` : 'N/A'}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {expandedPools.has(rig.id) && (info || rig.host) && (
        <div className="rig-pool-summary" style={{
          background: 'rgba(255,255,255,0.04)',
          padding: '12px',
          borderRadius: '14px',
          fontSize: '11px',
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
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', flexWrap: 'wrap' }}>
        {(isMine || isRented) && (
          <button
            className="btn-pro secondary"
            style={{ flex: '1 1 120px', fontSize: '10px', background: isRented ? 'rgba(139, 92, 246, 0.16)' : 'rgba(255,255,255,0.05)', color: isRented ? '#a78bfa' : '#94a3b8' }}
            onClick={() => { togglePoolInfo(rig.id); onOpenPool?.(rig, info); }}
          >
            {expandedPools.has(rig.id) ? 'Hide Pools' : 'Pools'}
          </button>
        )}
        {isMine && !isRented && (
          <>
            <button
              className="btn-pro secondary"
              style={{ flex: '1 1 90px', fontSize: '10px', color: statusStr === 'disabled' ? '#10b981' : '#f87171' }}
              onClick={() => handleRigStatus(rig, statusStr === 'disabled' ? 'available' : 'disabled')}
            >
              {statusStr === 'disabled' ? 'Enable' : 'Disable'}
            </button>
            <button
              className="btn-pro secondary"
              style={{ flex: '1 1 90px', fontSize: '10px' }}
              onClick={() => handlePriceChange(rig)}
            >
              Price
            </button>
          </>
        )}
        {isRented && info && onOpenCompletionCalculator && (
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
      </div>
    </article>
  );
};

export default MrrRigCard;
