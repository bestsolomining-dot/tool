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
} from '../core/mrrUtils.js';
import { getBtcPriceData as getBtcPriceDataUtils } from '../core/priceUtils.js';
import { getAlgoDisplayName, normalizeAlgoForNiceHash, calculatePriceComparison } from '../core/mapping.js';

const MrrRigCard = ({ 
  rig, 
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
  const isRented = statusStr.includes('rented');
  const rentalId = rig.rentalid || rig.current_rental_id || rig.rental_id;
  const displayId = (isRented && rentalId) ? rentalId : rig.id;
  const idLabel = (isRented && rentalId) ? 'Rental' : 'Rig';

  const rawNhData = algoMarketPrices[algoName.toUpperCase()] || info?.nicehashPrice;
  const nhBase = Array.isArray(rawNhData) ? rawNhData[0] : rawNhData;
  const nhData = nhBase?.price || nhBase;
  const adsVal = info?.rawAds || getRawHashrate(rig.hashrate?.advertised || rig.advertised) || 0;
  const avgVal = info?.rawAvg || getRawHashrate(rig.hashrate?.average || rig.average || rig.hash) || 0;
  
  // 1. Efficiency and Styling initialization (Fixed ReferenceErrors)
  const rawEffValue = info?.percent ?? rig.hashrate?.average?.percent ?? rig.percent ?? (adsVal > 0 ? (avgVal / adsVal * 100) : 0);
  const effNum = parseFloat(rawEffValue);
  const eff = effNum.toFixed(2);

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

  // Daily rate for ROI comparison, adjusted by performance (AVG hashrate)
  const listPriceSource = rig.price_converted || info?.price_converted || info?.price?.BTC || rig?.price?.BTC || rig.price || info?.price || rig.min_price;
  const listBtcData = getBtcPriceDataUtils(listPriceSource);

  const mrrPriceNum = (() => {
    const hours = parseFloat(rig.hours || rig.length || info?.duration || 0);
    const days = hours / 24;
    const effectivePriceSource = { 
      ...(rig.price || {}), ...(info?.price || {}), 
      paid: info?.price?.paid ?? rig.price?.paid,
      BTC: rig.price_converted || info?.price_converted || info?.price?.BTC || rig?.price?.BTC 
    };
    const btcData = getBtcPriceDataUtils(effectivePriceSource);
    
    if (btcData.value > 0 && btcData.currency === 'BTC') {
      if (btcData.isTotalCost && days > 0) {
        // Use avgVal for "dependence of effect" to get the TRUE cost per delivered hash
        const effectiveHashrate = (isRented && avgVal > 0) ? avgVal : adsVal;
        if (effectiveHashrate > 0) {
          const rate = btcData.value / days / effectiveHashrate;
          return isEquihash ? rate : rate * BASE_UNIT_FACTOR;
        }
      }
      return btcData.value;
    }
    return listBtcData.value;
  })();

  const mrrComparePriceValue = listBtcData.value;
  const isMrrBtc = listBtcData.currency === 'BTC' && listBtcData.value > 0;
  const paidAmount = parsePriceValueLocal(info?.price?.paid ?? rig.price?.paid);
  const paidCurrency = info?.price?.currency || info?.price?.price_unit || rig.price?.currency || rig.price?.price_unit || rig.currency || info?.currency || '';
  const paidLabel = paidAmount > 0 && paidCurrency ? `${paidAmount.toFixed(8)} ${paidCurrency}` : null;

  const mrrUnit = clean(info?.advertised || rig.hashrate_unit || rig.hashrate?.advertised?.type || rig.hashrate?.suffix || 'TH');
  const nhOrder = nhOrders?.find(o => normalizeAlgoForNiceHash(o.algo) === normalizeAlgoForNiceHash(algoName));
  
  // Fallback to market price (nhData) if no active user order is found
  const myNhPrice = nhOrder ? parseFloat(nhOrder.price) : parseFloat(nhData || 0);
  const nhPriceWithFee = myNhPrice > 0 ? (nhOrder?.add_fee ? parseFloat(nhOrder.add_fee) : (myNhPrice * 1.04)) : 0;
  const isRandomX = algoName.toLowerCase().includes('RANDOMX');
  const isSha256 = algoName.toUpperCase().includes('SHA256');
  // Corrected unit fallbacks to prevent SHA256/RandomX overlaps in NiceHash price comparison
  const myNhUnit = nhOrder?.marketUnit || (isSha256 ? 'EH' : (isRandomX ? 'MH' : 'GH'));

  // ROI Logic: Only show price-based ROI if we have valid price data from NiceHash
  const myOrderDiffRaw = (myNhPrice > 0 && mrrPriceNum > 0) ? calculatePriceComparison(
    mrrPriceNum,
    mrrUnit, // Pass mrrUnit directly; calculatePriceComparison should handle conversion
    nhPriceWithFee,
    myNhUnit
  ) : null;
  const myOrderDiff = myOrderDiffRaw !== null ? (parseFloat(myOrderDiffRaw) * -1).toFixed(1) : null;

  // 3. Time and Consumption tracking
  const rentalStartTime = info?.startTime || rig.start;
  const startT = new Date(rentalStartTime + (String(rentalStartTime).endsWith('UTC') ? '' : ' UTC')).getTime();
  const endT = new Date((info?.endTime || rig.end || (typeof rig.status === 'object' ? rig.status.end : null)) + (String(info?.endTime || rig.end).endsWith('UTC') ? '' : ' UTC')).getTime();
  const totalMs = endT - startT;
  const elapsedMs = Math.max(0, Math.min(Date.now() - startT, totalMs));
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
            {isRented && paidLabel && (
              <div style={{ fontSize: '10px', color: '#10b981', marginTop: '5px', background: 'rgba(19, 173, 122, 0.06)', padding: '4px', borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Paid: <strong>{paidLabel}</strong></span>
                </div>
                {currentPayValue > 0 && (
                  <div style={{ marginTop: '3px', paddingTop: '3px', borderTop: '1px solid rgba(16, 185, 129, 0.1)' }}>
                    <div style={{ fontSize: '9px', opacity: 0.8, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Spent (Time):</span>
                      <strong>{currentPayValue.toFixed(8)} <small>{paidCurrency}</small></strong>
                    </div>
                    <div style={{ fontSize: '9px', color: effNum < 100 ? '#f87171' : '#34d399', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Value (Effect):</span>
                      <strong>{realizedPayValue.toFixed(8)} <small>{paidCurrency}</small></strong>
                    </div>
                  </div>
                )}
              </div>
            )}
            {myNhPrice > 0 && myOrderDiff !== null && (
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '6px', padding: '6px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ opacity: 0.7, fontSize: '8px' }}>{nhOrder ? 'Order' : 'Market'}: </span>
                  <span style={{ fontWeight: 'bold', color: '#fbbf24' }}>{myNhPrice.toFixed(8)}</span>
                  {/* {myOrderDiff !== null && (
                    <span style={{ color: parseFloat(myOrderDiff) > 0 ? '#f87171' : '#10b981', fontSize: '0.7rem', marginLeft: '4px' }}>
                      ({parseFloat(myOrderDiff) > 0 ? '+' : ''}{myOrderDiff}%)
                    </span>
                  )} */}
                </div>
                <div><span style={{ opacity: 0.7, fontSize: '9px' }}>{nhOrder ? 'ROI' : 'VS Market'}: </span><span style={{ fontWeight: 'bold', color: getRoiColor(myOrderDiff) }}>{parseFloat(myOrderDiff) > 0 ? '+' : ''}{myOrderDiff}%</span></div>
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

      {isRented && (
        <div style={{ background: 'rgba(0,0,0,0.1)', padding: '8px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', opacity: 0.8 }}>
            <span title={rentalStartTime}><span style={{ opacity: 0.5 }}>Started: </span>{formatRentalStartTime(rentalStartTime)}</span>
            <span><span style={{ opacity: 0.5 }}>Remain: </span><CountdownTimer endTime={info?.endTime || rig.end} /></span>
          </div>
          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${timeProgress}%`, height: '100%', background: timeProgress > 90 ? '#f87171' : 'linear-gradient(90deg, #3b82f6, #8b5cf6)' }} />
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
      </div>
    </div>
  );
};

export default MrrRigCard;