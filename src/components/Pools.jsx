import { useEffect, useRef, useState } from 'react'
import PoolEditorPopup from './PoolEditorPopup' // Use the new wrapper
import Modal from './Modal' // Import the new Modal component
import { poolHelpers as ph, poolApi, apiFetch } from '../core/poolUtils'

export default function Pools({ niceHashData, mrrClient, setMrrClient, nhClient, setNhClient }) {
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
  const [selectorOpen, setSelectorOpen] = useState(false)
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
      // Helper to strip protocol prefixes like stratum+tcp:// from the hostname
      const cleanHost = (h) => String(h || '').replace(/^(stratum\+tcp:\/\/|stratum\+ssl:\/\/|stratum:\/\/|tcp:\/\/|ssl:\/\/)/i, '').trim();
      const mapped = data.map(row => ({
        name: String(row['Pool Name'] || row.name || row['Name'] || row['poolName'] || 'Imported Pool').trim(),
        miningAlgorithm: String(row['Algorithm'] || row.algorithm || row.miningAlgorithm || row['Algo'] || row['algo'] || '').trim(),
        stratumHost: cleanHost(row['Stratum Host'] || row.stratumHost || row.stratumHostname || row.host || row['Host'] || row['host'] || ''),
        stratumPort: Number(row['Port'] || row.stratumPort || row.port || row['port'] || 3333), // Ensure port is always a number, default to 3333
        username: String(row['Username'] || row.username || row['User'] || row['user'] || '').trim(),
        password: String(row['Password'] || row.password || row['Pass'] || row['pass'] || 'x').trim(),
        poolVerificationServiceLocation: String(row['Market'] || row.location || row['Location'] || row['market'] || 'ANY').trim()
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

  // Function to load NiceHash pools for the selected client
  async function loadPools() {
    setLoading(true);
    try {
      const result = await poolApi.list(nhClient, { size: 1000 }); // Increase size to load more pools
      const normalized = ph.normalizeList(result.data);
      setPools(normalized);
      return normalized;
    } catch (err) {
      setError(err.message || String(err));
      setPools([]);
      return [];
    } finally {
      setLoading(false);
    }
  }

  // Initialize pools on mount
  useEffect(() => {
    loadPools();
  }, [nhClient]); // Re-fetch pools when nhClient changes

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
      const result = await poolApi.get(poolId, nhClient);

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
          const details = (await poolApi.get(poolId, nhClient)).data;
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
      let result = await poolApi.verify(payload, nhClient); // Pass nhClient

      if (result.status === 429) {
        const retryAfter = result.headers?.get('Retry-After') || result.data?.headers?.['retry-after'];
        const seconds = parseInt(retryAfter, 10) || 30;
        setRateLimitStatus(`Rate limit hit. Retrying in ${seconds}s...`);
        try {
          await new Promise(r => setTimeout(r, seconds * 1000));
          result = await poolApi.verify(payload, nhClient); // Pass nhClient
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
      const result = await poolApi.verify(payload, nhClient, signal); // Pass nhClient
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
            let resDetails = await poolApi.get(poolId, nhClient, controller.signal);
            if (resDetails.status === 429) {
              const seconds = parseInt(resDetails.headers?.get('Retry-After') || resDetails.data?.headers?.['retry-after'], 10) || 30;
              setRateLimitStatus(`Rate limit hit on details. Waiting ${seconds}s...`);
              try {
                await new Promise(r => setTimeout(r, seconds * 1000));
                resDetails = await poolApi.get(poolId, nhClient);
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
      <div className="market-inputs" style={{ marginBottom: '15px' }}>
        <small style={{ opacity: 0.8, fontSize: '13px', marginLeft: '10px' }}>ACTIVE NICEHASH CLIENT</small>
        <select className="select-pro" value={nhClient} onChange={(e) => setNhClient(e.target.value)}>
          <option value="BT">NiceHash Client: BT</option>
          <option value="PH">NiceHash Client: PH</option>
        </select>

        {/* <div className="pool-actions-toolbar" style={{ display: 'flex', gap: '10px', marginBottom: '1.5rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
          <button
            className="btn-pro"
            style={{ flex: 1, minWidth: '160px' }}
            onClick={() => setSelectorOpen(true)}
            disabled={loading || detailsLoading || playing || running}
          >
            Select Single Pool
          </button>
          <button
            className="btn-pro"
            style={{ flex: 1, minWidth: '160px' }}
            onClick={verify}
            disabled={loading || detailsLoading || playing || !selected || running}
          >
            {loading ? 'Verifying...' : `Verify ${selected ? ph.getLabel(selected) : 'Selected Pool'}`}
          </button>
        </div> */}
        <div className="pool-automation-main" style={{ flex: 1, minWidth: '600px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Integrated Pool Automation & Bulk Verification Section */}
          <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* <h3 style={{ margin: 0 }}>Automation & Bulk Verify</h3> */}
            {rateLimitStatus && (
              <div style={{ color: '#fbbf24', fontSize: '12px', fontWeight: 'bold' }}>
                ⚠️ {rateLimitStatus}
              </div>
            )}
          </div>

          {/* Controls Section */}
          {progress.total > 0 && (
              <div className="verify-progress-bar-container" style={{ width: '100%', height: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', overflow: 'hidden', position: 'relative', marginBottom: '15px' }}>
                <div className="verify-progress-bar-fill" style={{ width: `${(progress.current / progress.total) * 100}%`, height: '100%', background: '#3b82f6', transition: 'width 0.3s ease' }} />
              </div>
            )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '15px', background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="field">
                  <label className="label" style={{ fontSize: '10px' }}>DELAY (ms)</label>
                  <input type="number" className="input-pro" value={verificationDelay} onChange={e => setVerificationDelay(Number(e.target.value))} />
                </div>
                <div className="field">
                  <label className="label" style={{ fontSize: '10px' }}>INTERVAL (s)</label>
                  <input type="number" className="input-pro" value={automationInterval} onChange={e => setAutomationInterval(Number(e.target.value))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn-pro primary" style={{ flex: 2 }} onClick={startRun} disabled={playing || running}>
                  {running ? 'Running...' : 'Start Auto Run'}
                </button>
                {(playing || running) && (
                  <button className="btn-pro" onClick={stopAutomation} style={{ flex: 1, background: '#ef4444' }}>Stop</button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', height: '32px' }}>
                <input type="checkbox" id="mainVerifySourceToggle" checked={verifyFromFile} onChange={(e) => setVerifyFromFile(e.target.checked)} />
                <label htmlFor="mainVerifySourceToggle" style={{ fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}>
                  VERIFY FROM FILE ({filePools.length})
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button className="btn-pro secondary" onClick={() => fileInputRef.current?.click()}>Import XLSX</button>
                <button className="btn-pro secondary" onClick={() => verifyAllOnce()} disabled={playing || running}>Verify All</button>
              </div>
              <button className="btn-pro secondary" onClick={handleExportResults} disabled={completedResults.length === 0}>
                Export Results ({completedResults.length})
              </button>
            </div>

            <div style={{ fontSize: '12px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.3)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ color: running ? '#3b82f6' : '#94a3b8', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                <span>Cycle Status:</span>
                <span>{running ? `Active (Cycle #${runCount})` : 'Idle'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.8 }}>
                <span>Total Time Run:</span>
                <span>{Math.floor(currentRunElapsed / 60)}m {currentRunElapsed % 60}s</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.8, color: '#10b981' }}>
                <span>Last Cycle End:</span>
                <span>{lastRunTime || 'N/A'}</span>
              </div>
              {nextRunCountdown !== null && running && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fbbf24', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '4px', marginTop: '2px' }}>
                  <span>Next cycle in:</span>
                  <span>{nextRunCountdown}s</span>
                </div>
              )}
            </div>
          </div>

          {/* Results Section */}
          {/* <div className="pool-results-main" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '15px', flex: 1, minHeight: '300px' }}>
            

            {verifyResults.length > 0 ? (
              <div className="results-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div className="verify-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '10px' }}>
                  <div><span style={{ fontSize: '10px', opacity: 0.6 }}>Total:</span> <strong>{verifyFromFile ? filePools.length : pools.length}</strong></div>
                  <div><span style={{ fontSize: '10px', opacity: 0.6 }}>Verified:</span> <strong>{completedResults.length}</strong></div>
                  <div><span style={{ fontSize: '10px', color: '#34d399' }}>Success:</span> <strong>{successCount}</strong></div>
                  <div><span style={{ fontSize: '10px', color: '#f87171' }}>Fail:</span> <strong>{failCount}</strong></div>
                </div>

                <div className="verify-list" style={{ maxHeight: '400px', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
                  {verifyResults.map(item => {
                    const pending = item.result?.pending
                    const success = !pending && ph.isVerifySuccess(item.result)
                    const algorithm = ph.getVerifyAlgo(item.result)
                    return (
                      <div key={item.key} style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: 'rgba(255,255,255,0.02)',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        fontSize: '12px',
                        gap: '12px'
                      }}>
                        <div style={{ width: '80px', textAlign: 'center', padding: '2px 0', borderRadius: '4px', fontWeight: 'bold', fontSize: '10px', background: pending ? 'rgba(59, 130, 246, 0.1)' : success ? 'rgba(52, 211, 153, 0.1)' : 'rgba(248, 113, 113, 0.1)', color: pending ? '#3b82f6' : success ? '#34d399' : '#f87171', border: `1px solid ${pending ? '#3b82f644' : success ? '#34d39944' : '#f8717144'}` }}>{pending ? 'PENDING' : success ? 'SUCCESS' : 'FAILED'}</div>
                        <div style={{ flex: 1, fontWeight: 'bold' }}>{item.label}</div>
                        <div style={{ width: '120px', opacity: 0.6, fontFamily: 'monospace' }}>{algorithm}</div>
                        <div style={{ flex: 2, opacity: 0.8, fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pending ? 'Waiting...' : ph.getVerifyMessage(item.result)}</div>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <button className="text-button" style={{ fontSize: '11px' }} onClick={() => setInspectData(item.result)}>Inspect</button>
                          <button className="text-button" style={{ fontSize: '11px' }} onClick={() => openPoolEditor(item)}>Edit</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', opacity: 0.5 }}>
                No verification results yet. Start a manual "Verify All" or "Auto Run" to begin monitoring.
              </div>
            )}
          </div> */}
          {verifyResults.length > 0 ? (
            <div
              className="results-wrapper"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '15px',
                minHeight: 0,        // ✅ cho phép co lại khi cha là flex column
                overflow: 'hidden'   // ✅ ngăn tràn ra ngoài
              }}
            >
              <div
                className="verify-summary"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                  gap: '10px'
                }}
              >
                <div>
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>Total:</span> <strong>{verifyFromFile ? filePools.length : pools.length}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>Verified:</span> <strong>{completedResults.length}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '10px', color: '#34d399' }}>Success:</span> <strong>{successCount}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '10px', color: '#f87171' }}>Fail:</span> <strong>{failCount}</strong>
                </div>
              </div>

              <div
                className="verify-list"
                style={{
                  maxHeight: '400px',
                  overflowY: 'hiden',
                  overflowX: 'auto',
                  
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(255,255,255,0.1) transparent'
                }}
              >
                {verifyResults.map(item => {
                  const pending = item.result?.pending;
                  const success = !pending && ph.isVerifySuccess(item.result);
                  const algorithm = ph.getVerifyAlgo(item.result);
                  return (
                    <div
                      key={item.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: 'rgba(255,255,255,0.02)',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        fontSize: '12px',
                        gap: '12px'
                      }}
                    >
                      <div
                        style={{
                          width: '80px',
                          textAlign: 'center',
                          padding: '2px 0',
                          borderRadius: '4px',
                          fontWeight: 'bold',
                          fontSize: '10px',
                          background: pending
                            ? 'rgba(59, 130, 246, 0.1)'
                            : success
                              ? 'rgba(52, 211, 153, 0.1)'
                              : 'rgba(248, 113, 113, 0.1)',
                          color: pending ? '#3b82f6' : success ? '#34d399' : '#f87171',
                          border: `1px solid ${pending ? '#3b82f644' : success ? '#34d39944' : '#f8717144'
                            }`
                        }}
                      >
                        {pending ? 'PENDING' : success ? 'SUCCESS' : 'FAILED'}
                      </div>
                      <div style={{ flex: 1, fontWeight: 'bold' }}>{item.label}</div>
                      <div
                        style={{
                          width: '120px',
                          opacity: 0.6,
                          fontFamily: 'monospace'
                        }}
                      >
                        {algorithm}
                      </div>
                      <div
                        style={{
                          flex: 2,
                          opacity: 0.8,
                          fontSize: '11px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {pending ? 'Waiting...' : ph.getVerifyMessage(item.result)}
                      </div>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                          className="text-button"
                          style={{ fontSize: '11px' }}
                          onClick={() => setInspectData(item.result)}
                        >
                          Inspect
                        </button>
                        <button
                          className="text-button"
                          style={{ fontSize: '11px' }}
                          onClick={() => openPoolEditor(item)}
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', opacity: 0.5 }}>
              No verification results yet. Start a manual "Verify All" or "Auto Run" to begin monitoring.
            </div>
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
          nhClient={nhClient}
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

      {/* Inspection Modal */}
      <Modal
        isOpen={!!inspectData}
        onClose={() => setInspectData(null)}
        title="Verification Details"
        maxWidth="900px"
      >
        <pre className="response-body" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          {JSON.stringify(inspectData, null, 2)}
        </pre>
      </Modal>
      <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".xlsx" onChange={handleImportXlsx} />
    </div>
  )
}
