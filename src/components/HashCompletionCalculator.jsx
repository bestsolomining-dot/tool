import React, { useState, useMemo } from 'react';

export default function HashCompletionCalculator() {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [adsHashrate, setAdsHashrate] = useState('');
  const [avgHashrate, setAvgHashrate] = useState('');
  const [unit, setUnit] = useState(1e12); // Default TH/s

  const units = [
    { label: 'PH/s', value: 1e15 },
    { label: 'TH/s', value: 1e12 },
    { label: 'GH/s', value: 1e9 },
    { label: 'MH/s', value: 1e6 },
  ];

  const results = useMemo(() => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const now = new Date();

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || !adsHashrate) {
      return null;
    }

    const totalDurationMs = end - start;
    if (totalDurationMs <= 0) return { error: "End time must be after start time." };

    const elapsedMs = Math.max(0, Math.min(now - start, totalDurationMs));
    const remainingMs = Math.max(0, totalDurationMs - elapsedMs);

    const ads = parseFloat(adsHashrate) * unit;
    const avg = (parseFloat(avgHashrate) || 0) * unit;

    // Work is Hashrate * Seconds
    const totalExpectedHashes = ads * (totalDurationMs / 1000);
    const actualHashesDone = avg * (elapsedMs / 1000);
    const remainingHashesNeeded = Math.max(0, totalExpectedHashes - actualHashesDone);

    const currentOverallCompletion = (actualHashesDone / totalExpectedHashes) * 100;
    const timeProgress = (elapsedMs / totalDurationMs) * 100;
    
    // Target average for the remaining time to hit 100% of Advertised Total
    const requiredHashrateRaw = remainingMs > 0 ? (remainingHashesNeeded / (remainingMs / 1000)) : 0;
    const requiredHashrateFormatted = (requiredHashrateRaw / unit).toFixed(2);

    return {
      durationHrs: (totalDurationMs / 3600000).toFixed(2),
      elapsedHrs: (elapsedMs / 3600000).toFixed(2),
      remainingHrs: (remainingMs / 3600000).toFixed(2),
      totalExpectedHashes,
      actualHashesDone,
      remainingHashesNeeded,
      currentOverallCompletion: currentOverallCompletion.toFixed(2),
      timeProgress: timeProgress.toFixed(2),
      requiredHashrateFormatted,
      isBehind: avg < ads && elapsedMs > 0
    };
  }, [startTime, endTime, adsHashrate, avgHashrate, unit]);

  return (
    <div className="hash-completion-calculator nh-theme" style={{ padding: '15px' }}>
      <h2 className="section-title" style={{ marginBottom: '20px' }}>Rental Completion Calculator</h2>
      
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