import React from 'react';
import { poolHelpers as ph } from './src/core/poolUtils';
import { getAlgoDisplayName } from './src/core/mapping';

export default function VerificationResults({
  verifyResults,
  verifyFromFile,
  filePoolsCount,
  poolsCount,
  lastRunSummary,
  setInspectData,
  openPoolEditor
}) {
  const getAlgoCountsSummary = (results) => {
    const counts = results.reduce((acc, item) => {
      const algorithm = ph.getVerifyAlgo(item.result)
      acc[algorithm] = (acc[algorithm] || 0) + 1
      return acc
    }, {})
    return Object.entries(counts)
      .map(([algo, count]) => `${getAlgoDisplayName(algo)}: ${count}`)
      .join(', ')
  }

  if (verifyResults.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', opacity: 0.5 }}>
        No verification results yet. Start a manual "Verify All" or "Auto Run" to begin monitoring.
      </div>
    );
  }

  const completedResults = verifyResults.filter(item => !item.result?.pending)
  const skippedResults = completedResults.filter(item => item.result?.data?.message?.includes('Skipped'))
  const successResults = completedResults.filter(item => ph.isVerifySuccess(item.result) && !item.result?.data?.message?.includes('Skipped'))
  const failResults = completedResults.filter(item => !ph.isVerifySuccess(item.result) && !item.result?.data?.message?.includes('Skipped'))

  const verifiedSummary = getAlgoCountsSummary(completedResults)
  const successSummary = getAlgoCountsSummary(successResults)
  const failSummary = getAlgoCountsSummary(failResults)
  const skippedSummary = getAlgoCountsSummary(skippedResults)

  const lastRunVerified = lastRunSummary ? ` (Last: ${lastRunSummary.verified})` : ''
  const lastRunSuccess = lastRunSummary ? ` (Last: ${lastRunSaummary.success})` : ''
  const lastRunFailed = lastRunSummary ? ` (Last: ${lastRunSummary.failed})` : ''
  const lastRunSkipped = lastRunSummary ? ` (Last: ${lastRunSummary.skipped})` : ''

  return (
    <div className="results-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', gap: '15px' }}>
      <div className="verify-summary" style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '10px', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <span style={{ fontSize: '10px', opacity: 0.6 }}>Total:</span>{' '}
          <strong>{verifyFromFile ? filePoolsCount : poolsCount}</strong>
        </div>
        <div>
          <span style={{ fontSize: '10px', opacity: 0.6 }}>Verified:</span>{' '}
          <strong>{completedResults.length}</strong>
          <span style={{ fontSize: '10px', opacity: 0.6 }}> ({verifiedSummary}){lastRunVerified}</span>
        </div>
        <div>
          <span style={{ fontSize: '10px', color: '#34d399' }}>Success:</span>{' '}
          <strong>{successResults.length}</strong>
          <span style={{ fontSize: '10px', opacity: 0.6 }}> ({successSummary}){lastRunSuccess}</span>
        </div>
        <div>
          <span style={{ fontSize: '10px', color: '#f87171' }}>Error:</span>{' '}
          <strong>{failResults.length}</strong>
          <span style={{ fontSize: '10px', opacity: 0.6 }}> ({failSummary}){lastRunFailed}</span>
        </div>
        <div>
          <span style={{ fontSize: '10px', color: '#f87171' }}>Skipped:</span>{' '}
          <strong>{skippedResults.length}</strong>
          <span style={{ fontSize: '10px', opacity: 0.6 }}> ({skippedSummary}){lastRunSkipped}</span>
        </div>
      </div>

      <div className="verify-list" style={{ flex: 1, minHeight: '240px', overflowY: 'auto', overflowX: 'hidden', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}>
        {verifyResults.map(item => {
          const pending = item.result?.pending;
          const success = !pending && ph.isVerifySuccess(item.result);
          const algorithm = ph.getVerifyAlgo(item.result);

          return (
            <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 5px', borderBottom: '2px solid rgba(102, 86, 104, 0.07)', fontSize: '10px' }}>
              <div style={{ width: '80px', textAlign: 'center', padding: '4px 0', borderRadius: '4px', fontWeight: 700, fontSize: '10px', flexShrink: 0, background: pending ? 'rgba(59,130,246,.1)' : success ? 'rgba(52,211,153,.1)' : 'rgba(248,113,113,.1)', color: pending ? '#3b82f6' : success ? '#34d399' : '#f87171', border: `1px solid ${pending ? '#3b82f644' : success ? '#34d39944' : '#f8717144'}` }}>
                {pending ? 'PENDING' : success ? 'SUCCESS' : 'ERROR'}
              </div>
              <div style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{item.label}</div>
              <div style={{ width: '120px', flexShrink: 0, opacity: 0.6, fontFamily: 'monospace' }}>{getAlgoDisplayName(algorithm)}</div>
              <div style={{ flex: 2, minWidth: 0, opacity: 0.8, fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {pending ? 'Waiting...' : ph.getVerifyMessage(item.result)}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button className="btn-pro secondary" style={{ fontSize: '11px' }} onClick={() => setInspectData(item.result)}>Inspect</button>
                <button className="btn-pro secondary" style={{ fontSize: '11px' }} onClick={() => openPoolEditor(item)}>Edit</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}