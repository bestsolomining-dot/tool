import { useEffect, useRef, useState } from 'react'
import PoolEditorPopup from './PoolEditorPopup' // Use the new wrapper
import Modal from './Modal' // Import the new Modal component
import { poolHelpers as ph, poolApi } from '../core/poolUtils'

export default function Pools({ niceHashData, mrrClient, setMrrClient }) {
  const [pools, setPools] = useState([])
  const [selected, setSelected] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [response, setResponse] = useState(null)
  const [verifyResults, setVerifyResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [running, setRunning] = useState(false)
  const [verificationDelay, setVerificationDelay] = useState(3000) // Delay between individual pool verifications in bulk run
  const [automationInterval, setAutomationInterval] = useState(30) // 30 seconds
  const [lastRunTime, setLastRunTime] = useState(null)
  const [rateLimitStatus, setRateLimitStatus] = useState(null)
  const [nextRunCountdown, setNextRunCountdown] = useState(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [runCount, setRunCount] = useState(0)
  const [currentRunStartTime, setCurrentRunStartTime] = useState(null)
  const [currentRunElapsed, setCurrentRunElapsed] = useState(0)
  const [mrrRigs, setMrrRigs] = useState(null)
  const [inspectData, setInspectData] = useState(null)
  const [filePools, setFilePools] = useState([])
  const [verifyFromFile, setVerifyFromFile] = useState(false)

  const [activeEditors, setActiveEditors] = useState([]) // Support multiple popups
  const [selectorOpen, setSelectorOpen] = useState(false) // State for Pool Selection Modal
  const runTimerRef = useRef(null)
  const countdownTimerRef = useRef(null)
  const stopRef = useRef(false)
  const activeRequestRef = useRef(null)
  const dropdownRef = useRef(null) // Kept for legacy or cleanup
  const fileInputRef = useRef(null)

  const handleImportXlsx = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await ph.parseXlsx(file);
      const mapped = data.map(row => ({
        name: row['Pool Name'] || row.name || 'Imported Pool',
        miningAlgorithm: row['Algorithm'] || row.algorithm || row.miningAlgorithm || '',
        stratumHost: row['Stratum Host'] || row.stratumHost || row.stratumHostname || row.host || '',
        stratumPort: Number(row['Port'] || row.stratumPort || row.port || 0),
        username: row['Username'] || row.username || '',
        password: row['Password'] || row.password || 'x',
        poolVerificationServiceLocation: row['Market'] || row.location || 'ANY'
      }));
      const normalized = ph.normalizeList(mapped);
      setFilePools(normalized);
      setVerifyFromFile(true);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  const openNewPoolEditor = () => {
    const editor = {
      key: 'new',
      label: 'New Pool',
      id: null,
      initialData: {
        name: "My New Pool",
        algorithm: "SHA256",
        stratumHostname: "stratum.example.com",
        stratumPort: 3333,
        username: "worker",
        password: "x"
      },
      isNew: true,
      usePopout: false
    };
    setActiveEditors(prev => [...prev.filter(e => e.key !== 'new'), editor]);
  };

  async function loadPools() {
    try {
      const result = await poolApi.list();
      const normalized = ph.normalizeList(result.data);
      setPools(normalized);
      return normalized;
    } catch (err) {
      setError(err.message || String(err));
      setPools([]);
      return [];
    }
  }

  // Initialize pools on mount
  useEffect(() => {
    loadPools();
  }, []);

  // Update the elapsed time counter every second while automation is running
  useEffect(() => {
    let interval;
    if (running && currentRunStartTime) {
      interval = setInterval(() => {
        setCurrentRunElapsed(Math.floor((Date.now() - currentRunStartTime) / 1000));
      }, 1000);
    } else {
      setCurrentRunElapsed(0);
    }
    return () => clearInterval(interval);
  }, [running, currentRunStartTime]);

  // Automatically clear MRR results when client changes to prevent data mixing
  useEffect(() => {
    setMrrRigs(null);
  }, [mrrClient]);

  async function fetchMrrRigs(clientName = mrrClient) {
    setLoading(true);
    setMrrRigs(null);
    setError('');
    try {
      const result = await poolApi.mrrRigs(clientName);
      if (result.ok) {
        setMrrRigs(result.data);
      } else {
        // Specifically handle Unauthorized errors for better user guidance
        if (result.status === 401) {
          throw new Error('Unauthorized: MRR API Key/Secret is invalid or missing for this client.');
        }
        const message = result.data?.error || result.data?.message || `Request failed with status ${result.status}`;
        throw new Error(message);
      }
    } catch (err) {
      setError(err.message.includes('MRR Error') ? err.message : `MRR Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function onPointerDown(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setSelectorOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => {
    return () => {
      stopRef.current = true; // Signal any running loops to stop immediately
      if (runTimerRef.current) clearInterval(runTimerRef.current)
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
      if (activeRequestRef.current) activeRequestRef.current.abort()
    }
  }, [])

  async function onSelect(id) {
    const key = String(id)
    const pool = pools.find((item, index) => ph.getKey(item, index) === key) || null
    const poolId = ph.getId(pool)

    setSelectedId(key)
    setSelected(pool)
    setResponse(null)
    setVerifyResults([])
    setError('')
    setSelectorOpen(false) // Close selector on pick

    if (!pool) return
    if (!poolId) {
      setError('Selected pool does not include an id for pool details.')
      return
    }

    setDetailsLoading(true)
    try {
      const result = await poolApi.get(poolId);

      if (!result.ok) {
        const message = typeof result.data === 'string'
          ? `${result.status}: ${result.data.slice(0, 140)}`
          : result.data?.error || result.data?.message || result.status
        throw new Error(message)
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setDetailsLoading(false)
    }
  }

  const handleEditorSaveSuccess = async (savedPoolId) => {
    await loadPools(); // Reload pools after a successful save
    // Optionally, update the selected pool if the saved one is relevant
  };
  async function verify() {
    if (!selected) {
      setError('Select a pool first.')
      return
    }

    if (selected.name?.toLowerCase() === 'active') {
      return
    }

    setLoading(true)
    setResponse(null)
    setVerifyResults([])
    setError('')

    const payload = ph.buildVerifyBody(selected)
    const missingFields = ph.getMissingVerifyFields(payload)
    if (missingFields.length > 0) {
      const poolId = ph.getId(selected);
      if (poolId) {
        try {
          const details = (await poolApi.get(poolId)).data;
          const fullPayload = ph.buildVerifyBody(details)
          return await performVerification(fullPayload, details)
        } catch (e) {
          setError(`Details Error: ${e.message}`);
          setLoading(false);
          return;
        }
      }
      setError(`Missing required verify fields: ${missingFields.join(', ')}`)
      setLoading(false)
      return
    }
    await performVerification(payload, selected)
  }

  async function performVerification(payload, poolDetails) {
    try {
      let result = await poolApi.verify(payload);

      if (result.status === 429) {
        const retryAfter = result.headers?.get('Retry-After') || result.data?.headers?.['retry-after'];
        const seconds = parseInt(retryAfter, 10) || 30;
        setRateLimitStatus(`Rate limit hit. Retrying in ${seconds}s...`);
        try {
          await new Promise(r => setTimeout(r, seconds * 1000));
          result = await poolApi.verify(payload);
        } finally {
          setRateLimitStatus(null);
        }
      }

      const enrichedResult = { ...result, poolDetails, requestBody: payload };
      setResponse(enrichedResult)
      setVerifyResults([{
        key: selectedId,
        label: selected ? ph.getLabel(selected) : selectedId,
        result: enrichedResult,
      }])
      if (!result.ok) {
        setError(result.data?.error || result.data?.message || result.status);
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  async function verifyPoolBody(poolDetails, signal) {
    const payload = ph.buildVerifyBody(poolDetails)
    const missingFields = ph.getMissingVerifyFields(payload)

    if (missingFields.length > 0) {
      return { ok: false, data: { error: `Missing required verify fields: ${missingFields.join(', ')}`, requestBody: payload } }
    }

    try {
      const result = await poolApi.verify(payload, signal);
      return { ...result, poolDetails, requestBody: payload };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { ok: false, requestBody: payload, data: { stopped: true, message: 'Stopped by user' } }
      }
      return { ok: false, requestBody: payload, data: { error: err.message || String(err) } }
    }
  }

  async function verifyAllOnce({ resetStop = true, keepRunning = false, targetPools = null } = {}) {
    const source = targetPools || (verifyFromFile ? filePools : pools);
    if (!Array.isArray(source) || source.length === 0 || playing) return
    setPlaying(true)
    setError('')
    setResponse(null)
    setVerifyResults([])
    setProgress({ current: 0, total: source.length })
    if (resetStop) stopRef.current = false

    try {
      for (let i = 0; i < source.length; i++) {
        if (stopRef.current) break

        const pool = source[i]
        if (pool.name?.toLowerCase() === 'active') {
          const skipKey = ph.getKey(pool, i)
          setVerifyResults(prev => [
            ...prev.filter(item => item.key !== skipKey),
            { key: skipKey, label: ph.getLabel(pool, i), result: { ok: true, data: { message: 'Skipped: Active Pool' } } },
          ])
          setProgress({ current: i + 1, total: source.length })
          continue
        }

        const poolId = ph.getId(pool)
        const key = ph.getKey(pool, i)
        const controller = new AbortController()
        activeRequestRef.current = controller

        setResponse(prev => ({ ...(prev || {}), [key]: 'verifying' }))
        setVerifyResults(prev => [
          ...prev.filter(item => item.key !== key),
          { key, label: ph.getLabel(pool, i), result: { pending: true } },
        ])

        let result
        try {
          let details = pool
          if (poolId) {
            // Assuming poolApi.get accepts a signal or you use onCall directly
            let resDetails = await poolApi.get(poolId, controller.signal);
            if (resDetails.status === 429) {
              const seconds = parseInt(resDetails.headers?.get('Retry-After') || resDetails.data?.headers?.['retry-after'], 10) || 30;
              setRateLimitStatus(`Rate limit hit on details. Waiting ${seconds}s...`);
              try {
                await new Promise(r => setTimeout(r, seconds * 1000));
                resDetails = await poolApi.get(poolId);
              } finally {
                setRateLimitStatus(null);
              }
            }
            details = resDetails.data;
          }

          const bodyToSend = typeof details === 'string' ? JSON.parse(details) : details
          result = await verifyPoolBody(bodyToSend, controller.signal)

          if (result.status === 429) {
            const retryAfter = result.headers?.get('Retry-After') || result.data?.headers?.['retry-after'];
            const seconds = parseInt(retryAfter, 10) || 30;
            setRateLimitStatus(`Rate limit hit on verify. Waiting ${seconds}s...`);
            try {
              await new Promise(r => setTimeout(r, seconds * 1000));
              // Retry once for this pool
              result = await verifyPoolBody(bodyToSend, controller.signal);
            } finally {
              setRateLimitStatus(null);
            }
          }
        } catch (err) {
          result = err.name === 'AbortError'
            ? { ok: false, data: { stopped: true, message: 'Stopped by user' } }
            : { ok: false, data: { error: err.message || String(err) } }
        } finally {
          activeRequestRef.current = null
        }

        setResponse(prev => ({ ...(prev || {}), [key]: result }))
        setVerifyResults(prev => [
          ...prev.filter(item => item.key !== key),
          { key, label: ph.getLabel(pool, i), result },
        ])
        setProgress({ current: i + 1, total: source.length })

        if (stopRef.current || i >= source.length - 1) break
        await new Promise(resolve => {
          const startedAt = Date.now()
          const timer = setInterval(() => {
            if (stopRef.current || (Date.now() - startedAt >= verificationDelay)) {
              clearInterval(timer)
              resolve()
            }
          }, 100)
        })
      }
    } finally {
      setPlaying(false)
      if (!keepRunning && stopRef.current) setRunning(false)
    }
  }

  async function startRun() {
    if (running || playing) return
    setRunning(true)
    setRunCount(0)
    setCurrentRunStartTime(Date.now())
    stopRef.current = false

    const intervalMs = automationInterval * 1000; // Convert seconds to milliseconds

    const scheduleNextCycle = async () => {
      if (stopRef.current) {
        setRunning(false);
        return;
      }

      // Check if a verification cycle is still active before starting a new one
      if (playing) {
        runTimerRef.current = setTimeout(scheduleNextCycle, 1000);
        return;
      }

      setRunCount(prev => prev + 1);
      setNextRunCountdown(null); // Clear previous countdown display
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

      await verifyAllOnce({ resetStop: false, keepRunning: true });

      const finishedAt = new Date();
      setLastRunTime(finishedAt.toLocaleTimeString());

      if (stopRef.current) { // Check stopRef again after verifyAllOnce completes
        setRunning(false);
        return;
      }

      let remaining = intervalMs / 1000; // Total seconds for the next countdown
      setNextRunCountdown(remaining);

      countdownTimerRef.current = setInterval(() => {
        remaining -= 1;
        setNextRunCountdown(remaining > 0 ? remaining : 0);
        if (remaining <= 0) {
          clearInterval(countdownTimerRef.current);
          scheduleNextCycle(); // Start the next cycle immediately after the countdown finishes
        }
      }, 1000);
    };

    // Start the first cycle immediately
    scheduleNextCycle();
  }

  function verifyAlgorithm(algorithm) {
    const base = verifyFromFile ? filePools : pools;
    const targetPools = base.filter(pool => ph.getAlgo(pool) === algorithm)
    verifyAllOnce({ targetPools })
  }

  function stopAutomation() {
    stopRef.current = true
    setRunning(false) // Set running to false immediately when stop is requested
    if (runTimerRef.current) {
      clearInterval(runTimerRef.current)
      runTimerRef.current = null
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
      setNextRunCountdown(null)
    }
    if (activeRequestRef.current) {
      activeRequestRef.current.abort() // Abort any ongoing fetch requests
      activeRequestRef.current = null
    }
    setCurrentRunStartTime(null)
    setRunCount(0)
    setLastRunTime(null) // Clear the last run time when automation is stopped
  }

  const openPoolEditor = (item) => {
    const poolRecord = pools.find((pool, index) => ph.getKey(pool, index) === item.key) || null
    const poolDetails = item.result?.poolDetails || item.result?.requestBody || poolRecord || null
    const editor = {
      key: item.key,
      label: item.label,
      id: ph.getId(poolDetails) || item.id || ph.getId(poolRecord),
      initialData: poolDetails,
      isNew: item.key === 'new',
      usePopout: false
    };
    setActiveEditors(prev => {
      if (prev.find(e => e.key === editor.key)) return prev;
      return [...prev, editor];
    });
  };

  const closePoolEditor = (key) => {
    setActiveEditors(prev => prev.filter(e => e.key !== key));
  };

  const handleEditorVerifySuccess = (verificationResult) => {
    // Update the verification results in the main Pools component
    setVerifyResults(prev => [
      ...prev.filter(item => item.key !== verificationResult.key),
      verificationResult,
    ]);
  }

  const handleExportResults = () => {
    const resultsToExport = verifyResults.filter(item => !item.result?.pending);

    // 1. Export Pool Verification Results
    const poolData = resultsToExport.map(item => {
      const p = item.result?.poolDetails || item.result?.requestBody || {};
      const success = ph.isVerifySuccess(item.result);
      return {
        'Pool Name': item.label,
        'Algorithm': ph.getVerifyAlgo(item.result),
        'Status': success ? 'VERIFIED' : 'FAILED',
        'Stratum Host': p.stratumHost || p.stratumHostname || p.host || '',
        'Port': p.stratumPort || p.port || '',
        'Username': p.username || '',
        'Message': ph.getVerifyMessage(item.result),
        'Verified At': new Date().toLocaleString()
      };
    });
    if (poolData.length > 0) {
      ph.exportToXlsx(poolData, `pool_verification_${Date.now()}.xlsx`);
    }

    // 2. Export MRR Rigs (from local state)
    if (mrrRigs) {
      const rigs = mrrRigs.rigs || mrrRigs.data || (Array.isArray(mrrRigs) ? mrrRigs : []);
      const rigData = (Array.isArray(rigs) ? rigs : []).map(r => ({
        'ID': r.id,
        'Name': r.name,
        'Status': r.status,
        'Algorithm': r.algo,
        'Hashrate': r.hashrate,
        'Price': r.price
      }));
      if (rigData.length > 0) ph.exportToXlsx(rigData, `mrr_rigs_${Date.now()}.xlsx`);
    }

    // 3. Export NiceHash Orders (from props)
    const rawOrders = niceHashData?.list || niceHashData?.myOrders || (Array.isArray(niceHashData) ? niceHashData : []);
    const orderData = (Array.isArray(rawOrders) ? rawOrders : []).map(o => ({
      'Order ID': o.id || o.orderId,
      'Algorithm': typeof o.algorithm === 'object' ? o.algorithm.algorithm : o.algorithm,
      'Market': typeof o.market === 'object' ? o.market.id : o.market,
      'Price': o.price,
      'Limit': o.limit,
      'Status': typeof o.status === 'object' ? o.status.code : o.status
    }));
    if (orderData.length > 0) ph.exportToXlsx(orderData, 'orders.xlsx');
  };

  const selectedLabel = selected ? ph.getLabel(selected) : 'Select a pool'
  const completedResults = verifyResults.filter(item => !item.result?.pending)
  const skippedCount = completedResults.filter(item => item.result?.data?.message?.includes('Skipped')).length
  const successCount = completedResults.filter(item => ph.isVerifySuccess(item.result) && !item.result?.data?.message?.includes('Skipped')).length
  const failCount = completedResults.length - successCount - skippedCount
  const algorithmCounts = completedResults.reduce((counts, item) => {
    const algorithm = ph.getVerifyAlgo(item.result)
    counts[algorithm] = (counts[algorithm] || 0) + 1
    return counts
  }, {})
  const algorithmSummary = Object.entries(algorithmCounts)
    .map(([algorithm, count]) => `${algorithm}: ${count}`)
    .join(', ')
  const activePoolSource = verifyFromFile ? filePools : pools
  const poolAlgorithmGroups = Object.entries(
    activePoolSource.reduce((groups, pool) => {
      const algorithm = ph.getAlgo(pool)
      groups[algorithm] = (groups[algorithm] || 0) + 1
      return groups
    }, {}),
  ).sort(([left], [right]) => left.localeCompare(right))

  return (
    <div className="card pools-manager" >
      <div className="pool-actions-container" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '1.5rem' }}>
        <button className="btn-pro primary" style={{ width: '100%' }} onClick={verify} disabled={loading || detailsLoading || playing || !selected || running}>
          {loading ? 'Verifying...' : 'Verify Pool'}
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '10px', fontWeight: 'bold', opacity: 0.7 }}>DELAY (ms)</label>
            <input
              type="number"
              className="input-pro"
              style={{ width: '100%', padding: '6px' }}
              value={verificationDelay}
              onChange={e => setVerificationDelay(Number(e.target.value))}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '10px', fontWeight: 'bold', opacity: 0.7 }}>AUTO INTERVAL (s)</label>
            <input
              type="number"
              className="input-pro"
              style={{ width: '100%', padding: '6px' }}
              value={automationInterval}
              onChange={e => setAutomationInterval(Number(e.target.value))}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <button
            className="btn-pro secondary"
            style={{ width: '100%' }}
            onClick={handleExportResults}
            disabled={completedResults.length === 0}
          >
            Export (verified: {completedResults.length})
          </button>
          <button className="btn-pro" style={{ width: '100%' }} onClick={() => verifyAllOnce()} disabled={playing || running}>
            Verify All
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <button className="btn-pro secondary" onClick={() => fileInputRef.current?.click()} style={{ fontSize: '10px', padding: '4px 12px' }}>
            Import XLSX
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="verifySourceToggle"
              checked={verifyFromFile}
              onChange={(e) => setVerifyFromFile(e.target.checked)}
              style={{ width: '16px', height: '16px' }}
            />
            <label htmlFor="verifySourceToggle" style={{ fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}>
              VERIFY FROM FILE ({filePools.length})
            </label>
          </div>

          <input type="file" ref={fileInputRef} onChange={handleImportXlsx} accept=".xlsx,.xls" style={{ display: 'none' }} />
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn-pro" style={{ flex: 2 }} onClick={startRun} disabled={playing || running}>
              {running ? 'Automation Active' : 'Start Auto Run'}
            </button>
            {(playing || running) && (
              <button className="btn-pro" onClick={stopAutomation} style={{ flex: 1, background: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}>Stop</button>
            )}
          </div>
        </div>

        {running && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
            <div style={{ color: '#f59e0b', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
              <span>Cycle Status:</span>
              <span>Running #{runCount}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.8 }}>
              <span>Total Time Run:</span>
              <span>{Math.floor(currentRunElapsed / 60)}m {currentRunElapsed % 60}s</span>
              {lastRunTime && !playing && (
                <div style={{ color: '#059669', fontSize: '11px', textAlign: 'right' }}>
                  Last cycle finished: {lastRunTime}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.8 }}>
              <span>Skipped Pools:</span>
              <span>{skippedCount}</span>
            </div>
            {nextRunCountdown !== null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#3b82f6' }}>
                <span>Next run in:</span>
                <span>{Math.floor(nextRunCountdown / 60)}m {Math.floor(nextRunCountdown % 60)}s</span>
              </div>
            )}
          </div>
        )}

        <div className="pool-main-content" style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '650px', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
          {progress.total > 0 && (
            <div className="verify-progress-bar-container" style={{ width: '100%', height: '18px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden', position: 'relative', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div
                className="verify-progress-bar-fill"
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                  height: '100%',
                  background: '#3b82f6',
                  transition: 'width 0.3s ease'
                }}
              />
              <small style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', fontSize: '10px', lineHeight: '18px', fontWeight: 'bold', textShadow: '0 0 3px black' }}>
                {Math.round((progress.current / progress.total) * 100)}% ({progress.current}/{progress.total})
              </small>
            </div>
          )}
          {verifyResults.length > 0 ? (
            <div className="results-wrapper">
              <div className="verify-summary">
                <div>
                  <span>Target pools</span>
                  <strong>{verifyFromFile ? filePools.length : pools.length}</strong>
                </div>
                <div>
                  <span>Verified</span>
                  <strong>{completedResults.length}</strong>
                </div>
                <div>
                  <span>Success</span>
                  <strong>{successCount}</strong>
                </div>
                <div>
                  <span>Fail</span>
                  <strong>{failCount}</strong>
                </div>
                <div className="wide">
                  <span>Algorithm</span>
                  <strong>{algorithmSummary || 'No completed checks'}</strong>
                </div>
              </div>
              <div className="verify-list" >
                {verifyResults.map(item => {
                  const pending = item.result?.pending
                  const success = !pending && ph.isVerifySuccess(item.result)
                  const logs = ph.getVerifyLogs(item.result)
                  const algorithm = ph.getVerifyAlgo(item.result)
                  return (
                    <details className="verify-item" key={item.key}>
                      <summary>
                        <span
                          className={`verify-status ${pending ? 'pending' : success ? 'success' : 'fail'}`}
                          onClick={event => {
                            if (pending) return
                            event.preventDefault()
                            event.stopPropagation()
                            openPoolEditor(item)
                          }}
                          style={{ cursor: pending ? 'wait' : 'pointer' }}
                          title={pending ? "Verifying..." : "Click to open Pool Editor"}
                        >
                          {pending ? 'Checking' : success ? 'Success' : 'Fail'}
                        </span>
                        <button
                          type="button"
                          className="pool-editor-link"
                          onClick={event => {
                            event.preventDefault()
                            event.stopPropagation()
                            openPoolEditor(item)
                          }}
                          disabled={pending}
                        >
                          {item.label} <span style={{ fontSize: '0.9em', opacity: 0.7 }}>✎</span>
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          style={{ fontSize: '10px', marginLeft: 'auto', marginRight: '10px' }}
                          onClick={event => {
                            event.preventDefault()
                            event.stopPropagation()
                            setInspectData(item.result)
                          }}
                        >
                          Inspect
                        </button>
                        <span className="verify-algorithm">{algorithm}</span>
                        <small>{pending ? 'Waiting for response' : ph.getVerifyMessage(item.result)}</small>
                      </summary>
                    </details>
                  )
                })}
              </div>
            </div>
          ) : (
            <pre className="response-body compact">{response ? JSON.stringify(response, null, 2) : 'No response yet'}</pre>
          )}
        </div>
      </div>

      <div className="pools-dashboard-layout" style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {sidebarVisible && (
          <div className="pool-sidebar" style={{ width: '100%', maxWidth: '380px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="pool-algorithm-summary" style={{ marginTop: 0 }}>
              <div className="response-header compact">
                <h3>Algorithm Summary</h3>
                <span>{poolAlgorithmGroups.length} types / {activePoolSource.length} pools</span>
              </div>
              {poolAlgorithmGroups.length > 0 ? (
                <div className="algorithm-grid" style={{ maxHeight: '650px', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
                  {poolAlgorithmGroups.map(([algorithm, count]) => (
                    <div className="algorithm-row" key={algorithm}>
                      <span>{algorithm}</span>
                      <strong style={{ marginLeft: 3 }}>{count}</strong>
                      <button
                        type="button"
                        className="btn-pro secondary"
                        onClick={() => verifyAlgorithm(algorithm)}
                        disabled={playing || running}
                      >
                        Verify
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="response-body compact">No pools loaded.</pre>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <pre className="error-message">{error}</pre>}

      {activeEditors.map(editor => (
        <PoolEditorPopup
          key={editor.key}
          editor={editor}
          onClose={() => closePoolEditor(editor.key)}
          onSaveSuccess={handleEditorSaveSuccess}
          onVerifySuccess={handleEditorVerifySuccess}
        />
      ))}

      {/* Pool Selector Modal */}
      <Modal isOpen={selectorOpen} onClose={() => setSelectorOpen(false)} title="Select a Stratum Pool" maxWidth="600px">
        <div className="select-dropdown-pro" style={{ position: 'static', boxShadow: 'none', border: 'none', padding: 0 }}>
          {pools.map((pool, index) => {
            const key = ph.getKey(pool, index);
            const label = ph.getLabel(pool, index);
            const isActive = selectedId === key;
            return (
              <div
                key={key}
                className={`dropdown-item-pro ${isActive ? 'active' : ''}`}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                onClick={() => onSelect(key)}
              >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <strong style={{ color: isActive ? '#3b82f6' : 'inherit' }}>{label}</strong>
                  <code style={{ fontSize: '11px', opacity: 0.7 }}>{ph.getAlgo(pool)}</code>
                </div>
                <button
                  type="button"
                  className="btn-pro secondary"
                  style={{ fontSize: '10px', padding: '4px 8px' }}
                  onClick={(e) => { e.stopPropagation(); openPoolEditor({ key, label }); }}
                >
                  Edit
                </button>
              </div>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}
