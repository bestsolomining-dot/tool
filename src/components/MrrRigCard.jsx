import { useEffect, useState } from 'react';
import { CountdownTimer } from './MiningRigRental';
import {
  getClientBadgeStyle,
  getRawHashrate,
  getPriceDataLocal,
  parsePriceValueLocal,
  formatRentalStartTime, // Keep this, it's used
  getStatusClass,
  getRoiColor,
  getNiceHashPriceValue
} from '../core/mrrUtils.js';
import { getBtcPriceData as getBtcPriceDataUtils } from '../core/priceUtils.js';
import { getAlgoDisplayName, normalizeAlgoForNiceHash, calculatePriceComparison, getAlgorithmUnit } from '../core/mapping.js';

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

  const rawNhData = algoMarketPrices[algoName.toUpperCase()] || info?.nicehashPrice;
  const nhBase = Array.isArray(rawNhData) ? rawNhData[0] : rawNhData;
  const adsVal = info?.rawAds || getRawHashrate(rig.hashrate?.advertised || rig.advertised) || 0;
  const avgVal = info?.rawAvg || getRawHashrate(rig.hashrate?.average || rig.average || rig.hash) || 0;
  const rentalStartTime = info?.startTime || rig.start;
  const rentalEndTime = info?.endTime || rig.end || (typeof rig.status === 'object' ? rig.status.end : null);
  const startT = new Date(rentalStartTime + (String(rentalStartTime || '').endsWith('UTC') ? '' : ' UTC')).getTime();
  const endT = new Date(rentalEndTime + (String(rentalEndTime || '').endsWith('UTC') ? '' : ' UTC')).getTime();
  const totalMs = (isNaN(startT) || isNaN(endT)) ? 0 : endT - startT;
  const durationHoursFromDates = totalMs > 0 ? totalMs / 3600000 : 0;
  const durationHoursExplicit = parseFloat(info?.duration ?? info?.hours ?? rig.duration ?? rig.hours ?? rig.length ?? 0);
  const durationHours = durationHoursExplicit > 0 ? durationHoursExplicit : durationHoursFromDates;

  // 1. Efficiency and Styling initialization (Fixed ReferenceErrors)
  const rawEffValue = info?.percent ?? rig.hashrate?.average?.percent ?? rig.percent ?? (adsVal > 0 ? (avgVal / adsVal * 100) : 0);
  const effNum = parseFloat(rawEffValue);
  const eff = effNum.toFixed(2);

  // Initialize styling variables immediately to prevent ReferenceErrors
  let effectBg = isMine ? 'rgba(59, 130, 246, 0.1)' : 'rgba(30, 41, 59, 0.4)';
  let effectBorder = isMine ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.1)';
  let effectTextColor = '#fbbf24';

  if (effNum > 0) {
    if (effNum < 50) { effectBg = `linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, ${effectBg} 100%)`; effectBorder = '1px solid rgba(239, 68, 68, 0.4)'; effectTextColor = '#ef4444'; }
    else if (effNum < 70) { effectBg = `linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, ${effectBg} 100%)`; effectBorder = '1px solid rgba(245, 158, 11, 0.4)'; effectTextColor = '#f59e0b'; }
    else if (effNum >= 100) { effectBg = `linear-gradient(135deg, rgba(255, 22, 255, 0.39) 0%, ${effectBg} 100%)`; effectBorder = '1px solid rgba(36, 208, 251, 0.4)'; effectTextColor = '#00eeff'; }
    else if (effNum > 90) { effectBg = `linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, ${effectBg} 100%)`; effectBorder = '1px solid rgba(16, 185, 129, 0.4)'; effectTextColor = '#10b981'; }
  }

  // 2. Financial and ROI Logic
  const BASE_UNIT_FACTOR = 1000;
  const isEquihash = algoName.toLowerCase() === 'equihash';
  const displayPriceData = getPriceDataLocal(rig.price || info?.price || rig.min_price);
  const displayPrice = isEquihash ? displayPriceData.value : displayPriceData.value * BASE_UNIT_FACTOR;
  const displayPriceCurrency = displayPriceData.currency || 'BTC';

  // Prioritize the daily rate from the original 'rig' object over the 'info' object.
  // When a rig is rented, info.price usually contains the total paid amount for the duration,
  // which breaks the daily-rate comparison logic for ROI.
  const listPriceSource = rig.price_converted || rig?.price?.BTC || rig.price || info?.price_converted || info?.price?.BTC || info?.price || rig.min_price; // Keep this
  const listBtcData = getBtcPriceDataUtils(listPriceSource); // Keep this
  const paidAmount = parsePriceValueLocal(info?.price?.paid ?? rig.price?.paid ?? info?.price?.amount ?? rig.price?.amount);
  const paidCurrency = info?.price?.currency || info?.price?.price_unit || rig.price?.currency || rig.price?.price_unit || rig.currency || info?.currency || ''; // Keep this
  const paidLabel = paidAmount > 0 && paidCurrency ? `${paidAmount.toFixed(8)} ${paidCurrency}` : null;
  const canDeriveFromPaid = !paidCurrency || String(paidCurrency).toUpperCase() === 'BTC';
  const derivedDailyRate = canDeriveFromPaid && paidAmount > 0 && adsVal > 0 && durationHours > 0
    ? paidAmount / (durationHours / 24) / adsVal
    : 0;
  const baseListRate = listBtcData.isTotalCost ? 0 : listBtcData.value;
  const effectiveListRate = baseListRate > 0 ? baseListRate : derivedDailyRate;
  // MRR rental is sold revenue. Adjust by delivery efficiency so under-delivery lowers effective revenue.
  const soldMrrPriceNum = (() => {
    const listRate = effectiveListRate;
    if (isRented && effNum > 0 && Number.isFinite(listRate) && listRate > 0) {
      return listRate * (effNum / 100);
    }
    return listRate;
  })();

  const soldMrrPriceValue = soldMrrPriceNum;
  const isMrrBtc = listBtcData.currency === 'BTC' && listBtcData.value > 0;

  const mrrUnit = getAlgorithmUnit(algoName); // Use the centralized mapping for MRR unit

  const nhOrder = nhOrders?.find(o => normalizeAlgoForNiceHash(o.algo || o.algorithm || o.type || o.market) === normalizeAlgoForNiceHash(algoName));

  // Fallback to market price (nhData) if no active user order is found
  const marketNhPrice = getNiceHashPriceValue(nhBase);
  const orderNhPrice = getNiceHashPriceValue(nhOrder);
  const buyNhPrice = nhOrder && orderNhPrice > 0 ? orderNhPrice : marketNhPrice;
  const nhFeeOverride = parseFloat(nhOrder?.add_fee ?? nhOrder?.priceWithFee ?? 0);
  const buyNhPriceWithFee = buyNhPrice > 0 ? (nhFeeOverride > 0 ? nhFeeOverride : (buyNhPrice * 1.04)) : 0;

  const myNhUnit = getAlgorithmUnit(normalizeAlgoForNiceHash(algoName)); // Use the centralized mapping for NiceHash unit
  const mrrRateUnit = listBtcData.unit || mrrUnit;

  // Profit ROI: sold MRR revenue vs bought NiceHash cost.
  const profitDiffRaw = (buyNhPriceWithFee > 0 && soldMrrPriceValue > 0) ? calculatePriceComparison(
    soldMrrPriceValue,
    mrrRateUnit,
    buyNhPriceWithFee,
    myNhUnit
  ) : null;
  const profitDiff = profitDiffRaw;
  const roiStatusText = profitDiff !== null
    ? `${profitDiff > 0 ? '+' : ''}${profitDiff.toFixed(2)}%`
    : (buyNhPrice <= 0 ? 'Waiting for NiceHash buy price' : 'Waiting for MRR sold rate');

  // 3. Time and Consumption tracking
  const elapsedMs = nowMs > 0 ? Math.max(0, Math.min(nowMs - startT, totalMs)) : 0;
  const timeProgress = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
  const timeProgressFactor = Math.max(0, Math.min(1, timeProgress / 100));
  const currentPayValue = paidAmount > 0 ? (paidAmount * timeProgressFactor) : 0;
  const realizedPayValue = currentPayValue * (effNum / 100);

  const targetHashrate = (totalMs - elapsedMs) > 0 ? ((adsVal * (totalMs / 1000) - avgVal * (elapsedMs / 1000)) / ((totalMs - elapsedMs) / 1000)) : 0;
  const isBehind = targetHashrate > adsVal;
  const hSuffix = rig.hashrate?.suffix || rig.hashrate?.advertised?.type || '';

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
        <strong
          style={{
            fontSize: '13px',
            lineHeight: '1.3',
            color: '#f8fafc',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'block'
          }}
          title={rig.name}
        >
          {rig.name}
        </strong>
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
            {displayPriceCurrency !== 'BTC' && isMrrBtc && <div style={{ fontSize: '9px', color: '#fbbf24', opacity: 0.8 }}>≈ {listBtcData.value.toFixed(8)} <small>BTC</small></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', opacity: 0.8, marginTop: '4px' }}>
              <span title={rentalStartTime}><span style={{ opacity: 0.8 }}>Started: </span>{formatRentalStartTime(rentalStartTime)}</span>
              <span><span style={{ opacity: 0.8 }}>Remain: </span><CountdownTimer endTime={info?.endTime || rig.end} /></span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {isRented && (
            <div style={{
              fontSize: '10px',
              color: '#dbeafe',
              marginTop: '5px',
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.14), rgba(16, 185, 129, 0.08))',
              padding: '8px',
              borderRadius: '10px',
              border: '1px solid rgba(125, 211, 252, 0.16)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span style={{ opacity: 0.75 }}>Sold</span>
                <strong style={{ color: paidLabel ? '#34d399' : '#94a3b8' }}>{paidLabel || 'N/A'}</strong>
              </div>

              <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ opacity: 0.65 }}>{nhOrder ? 'Buy NH order' : 'Buy NH market'}</span>
                  <strong style={{ color: buyNhPriceWithFee > 0 ? '#fbbf24' : '#94a3b8' }}>
                    {buyNhPriceWithFee > 0 ? `${buyNhPriceWithFee.toFixed(8)} BTC/${myNhUnit}/Day` : 'N/A'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ opacity: 0.65 }}>{baseListRate > 0 ? 'Sold MRR rate' : 'Sold MRR derived'}</span>
                  <strong style={{ color: soldMrrPriceValue > 0 ? '#93c5fd' : '#94a3b8' }}>
                    {soldMrrPriceValue > 0 ? `${soldMrrPriceValue.toFixed(8)} BTC/${mrrRateUnit}/Day` : 'N/A'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ opacity: 0.65 }}>{profitDiff !== null ? 'Profit diff' : 'ROI status'}</span>
                  <strong style={{ color: profitDiff !== null ? getRoiColor(profitDiff) : '#cbd5e1' }}>{roiStatusText}</strong>
                </div>
              </div>

              {currentPayValue > 0 && (
                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '9px', opacity: 0.82, display: 'flex', justifyContent: 'space-between' }}>
                    <span>Spent by time</span>
                    <strong>{currentPayValue.toFixed(8)} <small>{paidCurrency}</small></strong>
                  </div>
                  <div style={{ fontSize: '9px', color: effNum < 100 ? '#f87171' : '#34d399', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Value by effect</span>
                    <strong>{realizedPayValue.toFixed(8)} <small>{paidCurrency}</small></strong>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isRented && (
        <div style={{ background: 'rgba(0,0,0,0.1)', padding: '8px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ opacity: 0.5, fontSize: '8px' }}>Efficiency</div><div style={{ fontSize: '11px', color: effectTextColor, fontWeight: 'bold' }}>{eff}%</div></div>
            <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, effNum)}%`, height: '100%', background: effectTextColor }} /></div>
          </div>
          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${timeProgress}%`, height: '100%', background: timeProgress > 90 ? '#f87171' : 'linear-gradient(90deg, #3b82f6, #8b5cf6)' }} />
          </div>
          <div style={{ background: 'rgba(0,0,0,0.15)', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px' }}>Target:
                <span style={{ color: isBehind ? '#f87171' : '#34d399', fontWeight: 'bold', marginLeft: 'auto', fontSize: '11px' }}>{Math.max(0, targetHashrate).toFixed(2)} <small style={{ opacity: 0.5 }}>{hSuffix.toUpperCase()}</small></span></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px' }}>
              <span style={{ opacity: 0.8 }}>Hashrate:</span>
            </div>
            {info?.isRental ? (
              <div style={{ background: 'rgba(0,0,0,0.15)', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontWeight: 'bold', fontSize: '10px', color: '#f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{info.average || '0 N/A'} <small style={{ fontSize: '8px', opacity: 0.5 }}>(AVG)</small></span>
                  <span style={{ opacity: 0.8 }}>Adv: <span style={{ color: isBehind ? '#f87171' : '#34d399', fontWeight: 'bold', fontSize: '11px' }}>{info.advertised}</span></span>
                </div>
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
      )}

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
            {expandedPools.has(rig.id) ? 'Hide Pools' : 'Pools'}
          </button>
        )}
        {isMine && !isRented && (
          <>
            <button
              className="btn-pro secondary"
              style={{ flex: 1, fontSize: '10px', color: statusStr === 'disabled' ? '#10b981' : '#f87171' }}
              onClick={() => handleRigStatus(rig, statusStr === 'disabled' ? 'available' : 'disabled')}>
              {statusStr === 'disabled' ? 'Enable' : 'Disable'}
            </button>
            <button
              className="btn-pro secondary"
              style={{ flex: 1, fontSize: '10px' }}
              onClick={() => handlePriceChange(rig)}>
              Price
            </button>
          </>
        )}
        {isRented && info && onOpenCompletionCalculator && (
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
        </div>
        <button
          className="btn-pro secondary"
          style={{ width: '32px', fontSize: '12px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
    </div>
  );
};

export default MrrRigCard;
