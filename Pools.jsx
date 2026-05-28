import { useEffect, useRef, useState } from 'react'
import PoolEditorPopup from './PoolEditorPopup' // Use the new wrapper
import Modal from './Modal' // Import the new Modal component
import { poolHelpers as ph, poolApi } from './poolUtils'

export default function Pools() {
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
  const [verificationDelay, setVerificationDelay] = useState(5000)
  const [lastRunTime, setLastRunTime] = useState(null)
  const [rateLimitStatus, setRateLimitStatus] = useState(null)
  const [nextRunCountdown, setNextRunCountdown] = useState(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [mrrRigs, setMrrRigs] = useState(null)
  const [inspectData, setInspectData] = useState(null)
  const [runCount, setRunCount] = useState(0)
  const [currentRunStartTime, setCurrentRunStartTime] = useState(null)
  const [currentRunElapsed, setCurrentRunElapsed] = useState(0)

  const [activeEditors, setActiveEditors] = useState([]) // Support multiple popups
  const [selectorOpen, setSelectorOpen] = useState(false) // State for Pool Selection Modal
  const runTimerRef = useRef(null)
  const countdownTimerRef = useRef(null)
  const elapsedTimerRef = useRef(null)
  const stopRef = useRef(false)
  const activeRequestRef = useRef(null)
  const dropdownRef = useRef(null) // Kept for legacy or cleanup

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

  useEffect(() => {
    loadPools().then(() => {
      setSelected(null)
      setSelectedId('')
    })
  }, [])

  async function fetchMrrRigs() {
    setLoading(true);
    setMrrRigs(null);
    try {
      const result = await poolApi.mrrRigs();
      if (result.ok) setMrrRigs(result.data);
      else throw new Error(result.data?.error || 'Failed to fetch MRR rigs');
    } catch (err) {
      setError(`MRR Error: ${err.message}`);
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
      if (runTimerRef.current) clearTimeout(runTimerRef.current)
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
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
        const seconds = parseInt(retryAfter, 10) || 10;
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

  async function verifyAllOnce({ resetStop = true, keepRunning = false, targetPools } = {}) {
    const poolsToVerify = targetPools || poolsRef.current
    if (!Array.isArray(poolsToVerify) || poolsToVerify.length === 0 || playing) return
    setPlaying(true)
    setError('')
    setResponse(null)
    setVerifyResults([])
    setProgress({ current: 0, total: poolsToVerify.length })
    if (resetStop) stopRef.current = false

    try {
      for (let i = 0; i < poolsToVerify.length; i++) {
        if (stopRef.current) break

        const pool = poolsToVerify[i]
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
            let resDetails = await poolApi.get(poolId);
            if (resDetails.status === 429) {
              const seconds = parseInt(resDetails.headers?.get('Retry-After') || resDetails.data?.headers?.['retry-after'], 10) || 10;
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
            const seconds = parseInt(retryAfter, 10) || 10;
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
        setProgress({ current: i + 1, total: poolsToVerify.length })

        if (stopRef.current || i >= poolsToVerify.length - 1) break
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
      if (!stopRef.current) setLastRunTime(new Date().toLocaleTimeString())
      if (!keepRunning && stopRef.current) setRunning(false)
    }
  }

  async function startRun() {
    if (running || playing) return
    setRunning(true)
    setRunCount(0)
    stopRef.current = false

    const intervalMs = 10000

    const executeCycle = async () => {
      if (stopRef.current) return

      setCurrentRunStartTime(new Date())
      setCurrentRunElapsed(0)
      setRunCount(prev => prev + 1)
      setNextRunCountdown(null)
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)

      elapsedTimerRef.current = setInterval(() => {
        setCurrentRunElapsed(prev => prev + 1)
      }, 1000)

      if (runVerifyAllInAuto) {
        await verifyAllOnce({ resetStop: false, keepRunning: true })
      }

      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
      
      if (stopRef.current) return

      // Start countdown for next run
      let remaining = intervalMs / 1000
      setNextRunCountdown(remaining)
      setCurrentRunStartTime(null)

      countdownTimerRef.current = setInterval(() => {
        remaining -= 1
        setNextRunCountdown(remaining > 0 ? remaining : 0)
        if (remaining <= 0) clearInterval(countdownTimerRef.current)
      }, 1000)

      runTimerRef.current = setTimeout(executeCycle, intervalMs)
    }

    await executeCycle()
    if (stopRef.current) { // If stopped during the first cycle
      setRunning(false)
    }
  }

  function verifyAlgorithm(algorithm) {
    const targetPools = pools.filter(pool => ph.getAlgo(pool) === algorithm)
    verifyAllOnce({ targetPools })
  }

  async function importXlsx(file) {
    if (!file) return;
    if (!ph.XLSX) {
      setError('XLSX library not loaded. Please install it with: npm install xlsx');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target.result;
        const workbook = ph.XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = ph.XLSX.utils.sheet_to_json(sheet);

        const importedPools = json.map((row, i) => ({
          name: row.name || row['Pool Name'] || row.label || `Imp-${i}`,
          algorithm: row.algorithm || row.Algorithm || row.miningAlgorithm || '',
          stratumHostname: row.stratumHostname || row.stratumHost || row.host || row['Stratum Host'] || '',
          stratumPort: Number(row.stratumPort || row.port || row.Port || 3333),
          username: row.username || row.Username || '',
          password: row.password || row.Password || 'x',
          key: `imp_${Date.now()}_${i}`
        }));

        if (importedPools.length === 0) throw new Error('No valid pool rows found in XLSX');
        // Run verification on the imported list immediately
        await verifyAllOnce({ targetPools: importedPools, resetStop: true });
      } catch (err) {
        setError('Import Failed: ' + err.message);
      }
    };
    reader.readAsBinaryString(file);
  }

  async function importFromUrl() {
    const url = 'https://notepad.vn/01WUDFi17';
    setLoading(true);
    setError('');
    try {
      const res = await fetch(url);
      const data = await res.json();
      setPools(ph.normalizeList(data));
    } catch (err) {
      setError('URL Sync Failed: ' + err.message + '. Ensure the link returns raw JSON.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyImported() {
    const input = prompt('Paste pool JSON object or array to verify (one-time run):');
    if (!input) return;
    try {
      if (!ph.XLSX) {
        throw new Error('XLSX library not loaded. Cannot import files.');
      }
      const parsed = JSON.parse(input);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const targetPools = list.map((p, i) => ({
        ...p,
        key: p.key || `imp_${Date.now()}_${i}`
      }));
      await verifyAllOnce({ targetPools, resetStop: true });
    } catch (err) {
      setError('Import Failed: ' + err.message);
    }
  }

  function stopAutomation() {
    stopRef.current = true
    setRunning(false)
    setRunCount(0)
    setCurrentRunStartTime(null)
    setCurrentRunElapsed(0)
    if (runTimerRef.current) {
      clearTimeout(runTimerRef.current)
      runTimerRef.current = null
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
      setNextRunCountdown(null)
    }
    if (activeRequestRef.current) {
      activeRequestRef.current.abort()
      activeRequestRef.current = null
    }
    setLastRunTime(null)
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

    const data = resultsToExport.map(item => {
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

    ph.exportToXlsx(data, `pool_verification_${new Date().getTime()}.xlsx`);
  };

  const selectedLabel = selected ? ph.getLabel(selected) : 'Select a pool'
  const completedResults = verifyResults.filter(item => !item.result?.pending)
  const successCount = completedResults.filter(item => ph.isVerifySuccess(item.result)).length
  const failCount = completedResults.length - successCount
  const algorithmCounts = completedResults.reduce((counts, item) => {
    const algorithm = ph.getVerifyAlgo(item.result)
    counts[algorithm] = (counts[algorithm] || 0) + 1
    return counts
  }, {})
  const algorithmSummary = Object.entries(algorithmCounts)
    .map(([algorithm, count]) => `${algorithm}: ${count}`)
    .join(', ')
  const poolAlgorithmGroups = Object.entries(
    pools.reduce((groups, pool) => {
      const algorithm = ph.getAlgo(pool)
      groups[algorithm] = (groups[algorithm] || 0) + 1
      return groups
    }, {}),
  ).sort(([left], [right]) => left.localeCompare(right))

  return (
    <div className="card pools-manager">
      {!!inspectData && (
        <Modal isOpen={true} onClose={() => setInspectData(null)} title="Inspect Response" maxWidth="90vw">
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
            <button
              className="text-button"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(inspectData, null, 2));
                alert('Copied to clipboard');
              }}
            >
              Copy JSON
            </button>
          </div>
          <pre className="response-body modal" style={{ maxHeight: '70vh' }}>
            {JSON.stringify(inspectData, null, 2)}
          </pre>
          <div className="modal-actions">
            <button className="btn-pro secondary" onClick={() => setInspectData(null)}>
              Dismiss
            </button>
          </div>
        </Modal>
      )}
      <div className="pool-actions" style={{ minWidth: '500px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.8rem', marginBottom: '1rem' }}>
        <div className="pool-actions" style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'left', gap: '0.8rem', marginBottom: '1rem' }}>
          
          {/* Export button */}
          <button
            className="btn-pro secondary"
            onClick={handleExportResults}
            disabled={completedResults.length === 0 || playing || running}
            title="Export completed verification results to XLSX"
          >
            Export Results
          </button>
          {/* Verify All button */}
          <button className="btn-pro" onClick={() => verifyAllOnce()} disabled={playing || running || !enableVerifyAllButton}>
            {playing ? 'Verifying...' : `Verify All (${verificationDelay}ms)`}
          </button>
          {/* Import XLSX button */}
          <button className="btn-pro secondary" onClick={() => fileInputRef.current?.click()} disabled={playing || running || !enableVerifyImportedButton}>
            Import XLSX
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".xlsx, .xls"
            onChange={(e) => {
              if (e.target.files?.[0]) importXlsx(e.target.files[0]);
              e.target.value = ''; // Clear value to allow re-importing the same file
            }}
          />
          {/* Verify Imported button */}
          <button className="btn-pro secondary" onClick={verifyImported} disabled={playing || running || !enableVerifyImportedButton}>
            Verify Imported
          </button>
          {/* Auto Run button (standalone) */}
          <button className="btn-pro" onClick={startRun} disabled={playing || running}>
            {running ? 'Running...' : 'Auto'}
          </button>
          {/* Sync Remote Config */}
          <button className="btn-pro secondary" onClick={importFromUrl} disabled={playing || running}>
            Sync Remote
          </button>
          {/* Stop button (conditional) */}
          {(playing || running) && (
            <button className="btn-pro" onClick={stopAutomation}>Stop</button>
          )}
          {/* Checkboxes for control */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginLeft: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={enableVerifyAllButton} onChange={(e) => setEnableVerifyAllButton(e.target.checked)} />
              Enable 'Verify All' Button
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={enableVerifyImportedButton} onChange={(e) => setEnableVerifyImportedButton(e.target.checked)} />
              Enable 'Verify Imported/XLSX' Buttons
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={runVerifyAllInAuto} onChange={(e) => setRunVerifyAllInAuto(e.target.checked)} />
              Run 'Verify All' in Auto Mode
            </label>
          </div>
          {/* Time information block – pushed to the end on flex row, wraps below on small screens */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', fontSize: '0.9rem', marginRight: 'auto', background: 'rgba(92, 92, 92, 0.2)', padding: '4px 8px', borderRadius: '6px' }}>
            {/* Delay input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <label style={{ fontSize: '10px', fontWeight: 'bold' }}>DELAY (5s)</label>
              <input
                type="number"
                className="input-pro"
                style={{ width: '70px', padding: '3px' }}
                value={verificationDelay}
                onChange={e => setVerificationDelay(Number(e.target.value))}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '1rem', marginLeft: 'auto', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '6px' }}>
              {running && (
                <>
                  <div style={{ color: '#f59e0b', fontWeight: 'bold' }}>
                    Running #{runCount}
                  </div>
                  {currentRunStartTime && (
                    <div style={{ color: '#8b5cf6' }}>
                      Elapsed: {Math.floor(currentRunElapsed / 60)}m {currentRunElapsed % 60}s
                    </div>
                  )}
                  {nextRunCountdown !== null && (
                    <div style={{ color: '#3b82f6', fontWeight: 'bold' }}>
                      Next in: {Math.floor(nextRunCountdown / 60)}m {Math.floor(nextRunCountdown % 60)}s
                    </div>
                  )}
                </>
              )}

              {lastRunTime && !running && !playing && (
                <div style={{ color: '#059669' }}>
                  Finished: {lastRunTime}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="pool-main-content" style={{ flex: 1, minWidth: '500px' }}>
              {progress.total > 0 && (
                <div className="verify-progress-bar-container" style={{ width: '100%', height: '18px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '12px', overflow: 'hidden', position: 'relative', border: '1px solid rgba(255,255,255,0.1)' }}>
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
                      <strong>{pools.length}</strong>
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
                      <span>Error</span>
                      <strong>{failCount}</strong>
                    </div>
                    <div className="wide">
                      <span>Algorithm</span>
                      {algorithmSummary || 'No completed checks'}
                    </div>
                  </div>
                  <div className="verify-list">
                    {verifyResults.map(item => {
                      const pending = item.result?.pending
                      const success = !pending && ph.isVerifySuccess(item.result)
                      const logs = ph.getVerifyLogs(item.result)
                      const algorithm = ph.getVerifyAlgo(item.result)
                      return (
                        <details className="verify-item" key={item.key}>
                          <summary>
                            <span
                              className={`verify-status ${pending ? 'pending' : success ? 'success' : 'error'}`}
                              onClick={event => {
                                if (pending) return
                                event.preventDefault()
                                event.stopPropagation()
                                openPoolEditor(item)
                              }}
                              style={{ cursor: pending ? 'wait' : 'pointer' }}
                              title={pending ? "Verifying..." : "Click to open Pool Editor"}
                            >
                              {pending ? 'Checking' : success ? 'Success' : 'Error'}
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
                          {logs.length > 0 && (
                            <div className="verify-log">
                              <h4>Verification log</h4>
                              {logs.map((log, index) => (
                                <div className={`verify-log-row ${log.level?.toLowerCase() || ''}`} key={`${item.key}-log-${index}`}>
                                  <span>{log.level || 'LOG'}</span>
                                  <time>{log.timestamp || '-'}</time>
                                  <p>{log.message || JSON.stringify(log)}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          <pre className="response-body compact">
                            {JSON.stringify(item.result, null, 2)}
                          </pre>
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
        </div>
      </div>
      <div className="pools-dashboard-layout" style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {sidebarVisible && (

          <div className="pool-sidebar" style={{ width: '100%', maxWidth: '380px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="pool-algorithm-summary" style={{ marginTop: 0 }}>
              <div className="response-header compact">
                <h3>Algorithm Summary</h3>
                <span>{poolAlgorithmGroups.length} types / {pools.length} pools</span>
              </div>
              {poolAlgorithmGroups.length > 0 ? (
                <div className="algorithm-grid">
                  {poolAlgorithmGroups.map(([algorithm, count]) => (
                    <div className="algorithm-row" key={algorithm}>
                      <span>{algorithm}</span>
                      <strong style={{ marginLeft: 'auto', marginRight: '1rem', flexWrap: 'wrap', alignItems: 'flex-start', display: 'flex', gap: '6.5rem' }}>
                        {count}
                      </strong>
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

            {mrrRigs && (
              <div className="pool-mrr-summary" style={{ background: 'rgba(255,255,255,0.02)', padding: '0.3rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="response-header compact" style={{ marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '14px' }}>MRR Rigs Data</h3>
                  <button className="text-button" onClick={() => setMrrRigs(null)}>Clear</button>
                </div>
                <pre className="response-body compact" style={{ fontSize: '11px', maxHeight: '300px', overflow: 'auto', background: 'rgba(0,0,0,0.2)' }}>
                  {JSON.stringify(mrrRigs, null, 2)}
                </pre>
              </div>
            )}
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
    </div>
  );
}
