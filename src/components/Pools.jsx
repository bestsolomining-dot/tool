import { useEffect, useRef, useState } from 'react'
import PoolEditor from './PoolEditor' // Import the new PoolEditor component
import Modal from './Modal' // Import the new Modal component
 
const DEFAULT_VERIFICATION_LOCATION = 'ANY'
const LOCATION_MAP = {
  EU: 'EUROPE',
  EUROPE: 'EUROPE',
  USA: 'USA',
  US: 'USA',
  US_EAST: 'USA_EAST',
  USA_EAST: 'USA_EAST',
  EUROPE_NORTH: 'EUROPE_NORTH',
  SOUTH_AMERICA: 'SOUTH_AMERICA',
  ASIA: 'ASIA',
  ANY: 'ANY',
}

function getPoolKey(pool, index = 0) {
  return String(pool?.id || pool?.poolId || pool?.name || pool?.__generatedId || `gen-${index}`)
}

function getPoolId(pool) {
  return pool?.id || pool?.poolId
}

function getPoolLabel(pool, index = 0) {
  return String(pool?.name || pool?.id || pool?.poolId || pool?.__generatedId || `Pool ${index + 1}`)
}

function getPoolAlgorithm(pool) {
  return String(pool?.miningAlgorithm || pool?.algorithm || 'Unknown')
}

function normalizeVerificationLocation(value) {
  const key = String(value || '').trim().toUpperCase()
  return LOCATION_MAP[key] || DEFAULT_VERIFICATION_LOCATION
}

function buildPoolVerificationBody(pool) {
  if (!pool || typeof pool !== 'object') return null

  return {
    poolVerificationServiceLocation: normalizeVerificationLocation(
      pool.poolVerificationServiceLocation || pool.serviceLocation || pool.location || pool.market,
    ),
    miningAlgorithm: pool.miningAlgorithm || pool.algorithm,
    stratumHost: pool.stratumHost || pool.stratumHostname || pool.host,
    stratumPort: Number(pool.stratumPort || pool.port),
    username: pool.username,
    password: pool.password,
  }
}

function buildPoolSaveBody(pool) {
  if (!pool || typeof pool !== 'object') return null

  return {
    ...(pool.id || pool.poolId ? { id: pool.id || pool.poolId } : {}),
    name: pool.name,
    algorithm: pool.algorithm || pool.miningAlgorithm,
    stratumHostname: pool.stratumHostname || pool.stratumHost || pool.host,
    stratumPort: Number(pool.stratumPort || pool.port),
    username: pool.username,
    password: pool.password,
  }
}

function getMissingVerificationFields(payload) {
  return Object.entries(payload || {})
    .filter(([, value]) => value === undefined || value === null || value === '' || Number.isNaN(value))
    .map(([key]) => key)
}

function getMissingSaveFields(payload) {
  return ['name', 'algorithm', 'stratumHostname', 'stratumPort', 'username', 'password']
    .filter(key => payload?.[key] === undefined || payload?.[key] === null || payload?.[key] === '' || Number.isNaN(payload?.[key]))
}

function isVerifySuccess(result) {
  if (!result) return false
  if (result.ok === false) return false
  const data = result.data || result
  if (data.success === false || data.valid === false || data.error) return false
  return result.ok === true || data.success === true || data.valid === true
}

function getVerifyMessage(result) {
  const data = result?.data || result
  if (!data) return 'No response'
  if (data.error) return data.error
  if (data.message) return data.message
  if (data.stopped) return data.message || 'Stopped'
  if (Array.isArray(data.logs) && data.logs.length > 0) {
    return data.logs[data.logs.length - 1]?.message || 'Verification completed'
  }
  return isVerifySuccess(result) ? 'Verified' : 'Verification failed'
}

function getVerifyLogs(result) {
  const logs = result?.data?.logs || result?.logs
  return Array.isArray(logs) ? logs : []
}

function getVerifyAlgorithm(result) {
  return result?.requestBody?.miningAlgorithm || result?.poolDetails?.miningAlgorithm || result?.poolDetails?.algorithm || 'Unknown'
}

function normalizePools(data) {
  let list = []

  if (Array.isArray(data)) list = data
  else if (!data) list = []
  else if (Array.isArray(data.list)) list = data.list
  else if (Array.isArray(data.pools)) list = data.pools
  else if (data.result && Array.isArray(data.result.pools)) list = data.result.pools
  else if (typeof data === 'object') list = Object.values(data)

  return (Array.isArray(list) ? list : []).map((item, index) => {
    const obj = (typeof item === 'object' && !Array.isArray(item)) ? { ...item } : { value: item }
    if (!obj.id && !obj.poolId && !obj.name) obj.__generatedId = `gen-${index}`
    return obj
  })
}

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
  const [verificationDelay, setVerificationDelay] = useState(3000)
  const [lastRunTime, setLastRunTime] = useState(null)
  const [nextRunCountdown, setNextRunCountdown] = useState(null)
  const [mrrRigs, setMrrRigs] = useState(null)
  const [inspectData, setInspectData] = useState(null)

  const [activeEditorPool, setActiveEditorPool] = useState(null) // State to control PoolEditor modal
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const runTimerRef = useRef(null)
  const countdownTimerRef = useRef(null)
  const stopRef = useRef(false)
  const activeRequestRef = useRef(null)
  const dropdownRef = useRef(null)

  const openNewPoolEditor = () => {
    setActiveEditorPool({
      key: 'new',
      label: 'New Pool',
      initialData: {
        name: "My New Pool",
        algorithm: "SHA256",
        stratumHostname: "stratum.example.com",
        stratumPort: 3333,
        username: "worker",
        password: "x"
      },
      isNew: true
    });
  };

  async function loadPools() {
    return fetch('/api/v2/pools')
      .then(res => res.json())
      .then(data => {
        const normalized = normalizePools(data)
        setPools(normalized)
        return normalized
      })
      .catch(err => {
        setError(err.message || String(err))
        setPools([])
        return []
      })
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
      const res = await fetch('/api/v2/mrr/rigs');
      const data = await res.json();
      if (res.ok) setMrrRigs(data);
      else throw new Error(data.error || 'Failed to fetch MRR rigs');
    } catch (err) {
      setError(`MRR Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function onPointerDown(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => {
    return () => {
      if (runTimerRef.current) clearInterval(runTimerRef.current)
      if (activeRequestRef.current) activeRequestRef.current.abort()
    }
  }, [])

  async function onSelect(id) {
    const key = String(id)
    const pool = pools.find((item, index) => getPoolKey(item, index) === key) || null
    const poolId = getPoolId(pool)

    setSelectedId(key)
    setSelected(pool)
    setResponse(null)
    setVerifyResults([])
    setError('')
    setDropdownOpen(false)

    if (!pool) return
    if (!poolId) {
      setError('Selected pool does not include an id for pool details.')
      return
    }

    setDetailsLoading(true)
    try {
      const res = await fetch(`/api/v2/pool/${encodeURIComponent(poolId)}`)
      const contentType = res.headers.get('content-type') || ''
      const data = contentType.includes('application/json') ? await res.json() : await res.text()

      if (!res.ok) {
        const message = typeof data === 'string'
          ? `${res.status} ${res.statusText}: ${data.slice(0, 140)}`
          : data?.error || data?.message || res.statusText
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

    const payload = buildPoolVerificationBody(selected)
    const missingFields = getMissingVerificationFields(payload)
    if (missingFields.length > 0) {
      const poolId = getPoolId(selected);
      if (poolId) {
        try {
           const resDetails = await fetch(`/api/v2/pool/${encodeURIComponent(poolId)}`)
           const details = await resDetails.json()
           const fullPayload = buildPoolVerificationBody(details)
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
      const res = await fetch('/api/v2/pools/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      const result = { ok: res.ok, poolDetails, requestBody: payload, data }
      setResponse(result)
      setVerifyResults([{
        key: selectedId,
        label: selected ? getPoolLabel(selected) : selectedId,
        result,
      }])
      if (!res.ok) setError(data?.error || data?.message || res.statusText)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  async function verifyPoolBody(poolDetails, signal) {
    const payload = buildPoolVerificationBody(poolDetails)
    const missingFields = getMissingVerificationFields(payload)

    if (missingFields.length > 0) {
      return { ok: false, data: { error: `Missing required verify fields: ${missingFields.join(', ')}`, requestBody: payload } }
    }

    try {
      const res = await fetch('/api/v2/pools/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      const data = await res.json()
      return { ok: res.ok, status: res.status, headers: res.headers, poolDetails, requestBody: payload, data }
    } catch (err) {
      if (err.name === 'AbortError') {
        return { ok: false, requestBody: payload, data: { stopped: true, message: 'Stopped by user' } }
      }
      return { ok: false, requestBody: payload, data: { error: err.message || String(err) } }
    }
  }

  async function verifyAllOnce({ resetStop = true, keepRunning = false, targetPools = pools } = {}) {
    if (!Array.isArray(targetPools) || targetPools.length === 0 || playing) return
    setPlaying(true)
    setError('')
    setResponse(null)
    setVerifyResults([])
    if (resetStop) stopRef.current = false

    try {
      for (let i = 0; i < targetPools.length; i++) {
        if (stopRef.current) break

        const pool = targetPools[i]
        const poolId = getPoolId(pool)
        const key = getPoolKey(pool, i)
        const controller = new AbortController()
        activeRequestRef.current = controller

        setResponse(prev => ({ ...(prev || {}), [key]: 'verifying' }))
        setVerifyResults(prev => [
          ...prev.filter(item => item.key !== key),
          { key, label: getPoolLabel(pool, i), result: { pending: true } },
        ])

        let result
        try {
          let details = pool
          if (poolId) {
            const resDetails = await fetch(`/api/v2/pool/${encodeURIComponent(poolId)}`, { signal: controller.signal })
            if (resDetails.status === 429) {
              const retryAfter = resDetails.headers.get('Retry-After')
              if (retryAfter) {
                const seconds = parseInt(retryAfter, 10) || 1
                setError(`Rate limit hit on details. Waiting ${seconds}s...`)
                await new Promise(r => setTimeout(r, seconds * 1000))
                const retryRes = await fetch(`/api/v2/pool/${encodeURIComponent(poolId)}`, { signal: controller.signal })
                details = await retryRes.json()
              }
            } else {
              details = await resDetails.json()
            }
          }

          const bodyToSend = typeof details === 'string' ? JSON.parse(details) : details
          result = await verifyPoolBody(bodyToSend, controller.signal)

          if (result.status === 429) {
            const retryAfter = result.headers.get('Retry-After')
            if (retryAfter) {
              const seconds = parseInt(retryAfter, 10) || 1
              setError(`Rate limit hit on verify. Waiting ${seconds}s...`)
              await new Promise(r => setTimeout(r, seconds * 1000))
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
          { key, label: getPoolLabel(pool, i), result },
        ])

        if (stopRef.current || i >= targetPools.length - 1) break
        await new Promise(resolve => {
          const startedAt = Date.now()
          const timer = setInterval(() => {
            if (stopRef.current || Date.now() - startedAt >= verificationDelay) {
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
    stopRef.current = false

    const intervalMs = 5 * 60 * 1000

    const executeCycle = async () => {
      if (stopRef.current) return
      
      setNextRunCountdown(null)
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
      
      await verifyAllOnce({ resetStop: false, keepRunning: true })
      
      const finishedAt = new Date()
      setLastRunTime(finishedAt.toLocaleTimeString())

      // Start countdown for next run
      let remaining = intervalMs / 1000
      setNextRunCountdown(remaining)

      countdownTimerRef.current = setInterval(() => {
        remaining -= 1
        setNextRunCountdown(remaining > 0 ? remaining : 0)
        if (remaining <= 0) clearInterval(countdownTimerRef.current)
      }, 1000)
    }

    await executeCycle()
    if (stopRef.current) {
      setRunning(false)
      return
    }

    runTimerRef.current = setInterval(executeCycle, intervalMs)
  }

  function verifyAlgorithm(algorithm) {
    const targetPools = pools.filter(pool => getPoolAlgorithm(pool) === algorithm)
    verifyAllOnce({ targetPools })
  }

  function stopAutomation() {
    stopRef.current = true
    setRunning(false)
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
      activeRequestRef.current.abort()
      activeRequestRef.current = null
    }
    setLastRunTime(null) // Clear the last run time when automation is stopped
  }

  const openPoolEditor = (item) => {
    setActiveEditorPool({
      key: item.key,
      label: item.label,
      initialData: item.result?.poolDetails || item.result?.requestBody || null, // Pass existing data if available
      isNew: item.key === 'new'
    });
  };

  const closePoolEditor = () => {
    setActiveEditorPool(null);
  };

  const handleEditorVerifySuccess = (verificationResult) => {
    // Update the verification results in the main Pools component
    setVerifyResults(prev => [
      ...prev.filter(item => item.key !== verificationResult.key),
      verificationResult,
    ]);
  }


  const selectedLabel = selected ? getPoolLabel(selected) : 'Select a pool'
  const completedResults = verifyResults.filter(item => !item.result?.pending)
  const successCount = completedResults.filter(item => isVerifySuccess(item.result)).length
  const failCount = completedResults.length - successCount
  const algorithmCounts = completedResults.reduce((counts, item) => {
    const algorithm = getVerifyAlgorithm(item.result)
    counts[algorithm] = (counts[algorithm] || 0) + 1
    return counts
  }, {})
  const algorithmSummary = Object.entries(algorithmCounts)
    .map(([algorithm, count]) => `${algorithm}: ${count}`)
    .join(', ')
  const poolAlgorithmGroups = Object.entries(
    pools.reduce((groups, pool) => {
      const algorithm = getPoolAlgorithm(pool)
      groups[algorithm] = (groups[algorithm] || 0) + 1
      return groups
    }, {}),
  ).sort(([left], [right]) => left.localeCompare(right))

  return (
    <div className="card pools-manager">
      <div className="section-header">
        <h2>Stratum Pools</h2>
      </div>

      <div className="selection-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <div className="pool-select-pro" ref={dropdownRef} style={{ flex: 1 }}>
          <button 
            className={`select-trigger-pro ${dropdownOpen ? 'active' : ''}`} 
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span 
              className="current-selection"
              onClick={e => {
                if (selected) {
                  e.stopPropagation()
                  openPoolEditor({ key: selectedId, label: selectedLabel })
                }
              }}
              style={{ cursor: selected ? 'pointer' : 'inherit' }}
              title={selected ? "Click to open Pool Editor" : ""}
            >{selectedLabel}</span>
            <span className="count-badge">{pools.length}</span>
          </button>
          {dropdownOpen && (
            <div className="select-dropdown-pro shadow-lg">
              {pools.map((pool, index) => {
                const key = getPoolKey(pool, index);
                const label = getPoolLabel(pool, index);
                return (
                <div key={key} className="dropdown-item-pro" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => onSelect(key)}>
                   <div style={{ display: 'flex', flexDirection: 'column' }}>
                     <strong>{label}</strong>
                     <code>{getPoolAlgorithm(pool)}</code>
                   </div>
                   <button 
                     type="button" 
                     className="text-button" 
                     style={{ fontSize: '10px', opacity: 0.6, padding: '4px' }} 
                     onClick={(e) => { e.stopPropagation(); openPoolEditor({ key, label }); }}
                   >
                     EDIT
                   </button>
                </div>
              )})}
            </div>
          )}
        </div>
        <div className="actions" style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button className="btn-pro primary" onClick={openNewPoolEditor}>+ New Pool</button>
          <button className="btn-pro" onClick={fetchMrrRigs} title="Fetch MiningRigRentals data">MRR Rigs</button>
          <button className="btn-pro secondary" onClick={() => selected && openPoolEditor({ key: selectedId, label: selectedLabel })} disabled={!selected}>Edit Settings</button>
        </div>
      </div>

      <div className="pool-algorithm-summary">
        <div className="response-header compact">
          <h3>Pool algorithm summary</h3>
          <span>{poolAlgorithmGroups.length} types / {pools.length} pools</span>
        </div>
        {poolAlgorithmGroups.length > 0 ? (
          <div className="algorithm-grid">
            {poolAlgorithmGroups.map(([algorithm, count]) => (
              <div className="algorithm-row" key={algorithm}>
                <span>{algorithm}</span>
                <strong>{count}</strong>
                <button
                  type="button"
                  className="btn-pro secondary"
                  onClick={() => verifyAlgorithm(algorithm)}
                  disabled={playing || running}
                >
                  Verify algorithm
                </button>
              </div>
            ))}
          </div>
        ) : (
          <pre className="response-body compact">No pools loaded.</pre>
        )}
      </div>

      <div className="pool-actions" style={{ alignItems: 'center', gap: '1rem' }}>
        <button className="btn-pro primary" onClick={verify} disabled={loading || detailsLoading || playing || !selected}>
          {loading ? 'Verifying...' : 'Verify Pool'}
        </button>
        
        <button 
          className="btn-pro" 
          onClick={() => openPoolEditor({ key: selectedId, label: selectedLabel })} 
          disabled={!selected || detailsLoading || playing}
        >
          Edit Pool
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
           <label style={{ fontSize: '10px', fontWeight: 'bold' }}>DELAY (MS)</label>
           <input 
             type="number" 
             className="input-pro" 
             style={{ width: '70px', padding: '4px' }} 
             value={verificationDelay} 
             onChange={e => setVerificationDelay(Number(e.target.value))} 
           />
        </div>

        <button className="btn-pro" onClick={() => verifyAllOnce()} disabled={playing || running}>
          {playing ? 'Verifying...' : `Verify All (${verificationDelay}ms)`}
        </button>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '120px' }}>
          <button className="btn-pro" onClick={startRun} disabled={playing || running}>
            {running ? 'Running...' : 'Auto Run (10m)'}
          </button>
          <div style={{ minHeight: '24px', display: 'flex', flexDirection: 'column' }}>
            {running && nextRunCountdown !== null && (
              <small style={{ fontSize: '10px', color: '#3b82f6', fontWeight: 'bold' }}>
                Next run in: {Math.floor(nextRunCountdown / 60)}m {Math.floor(nextRunCountdown % 60)}s
              </small>
            )}
            {lastRunTime && (
              <small style={{ fontSize: '10px', color: '#059669' }}>
                Finished: {lastRunTime}
              </small>
            )}
          </div>
        </div>

        {(playing || running) && (
          <button className="btn-pro danger" onClick={stopAutomation}>Stop</button>
        )}
      </div>

      {error && <pre className="error-message">{error}</pre>}

      <div className="pool-response">
        <h3>Verify Status</h3>
        {verifyResults.length > 0 ? (
          <>
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
                <span>Fail</span>
                <strong>{failCount}</strong>
              </div>
              <div className="wide">
                <span>Algorithm</span>
                <strong>{algorithmSummary || 'No completed checks'}</strong>
              </div>
            </div>
            <div className="verify-list">
              {verifyResults.map(item => {
                const pending = item.result?.pending
                const success = !pending && isVerifySuccess(item.result)
                const logs = getVerifyLogs(item.result)
                const algorithm = getVerifyAlgorithm(item.result)
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
                      <small>{pending ? 'Waiting for response' : getVerifyMessage(item.result)}</small>
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
          </>
        ) : (
          <pre className="response-body compact">{response ? JSON.stringify(response, null, 2) : 'No response yet'}</pre>
        )}
      </div>

      {activeEditorPool && (
        <PoolEditor
          pool={activeEditorPool}
          onClose={closePoolEditor}
          onSaveSuccess={handleEditorSaveSuccess}
          onVerifySuccess={handleEditorVerifySuccess}
          initialPoolData={activeEditorPool.initialData}
          isNew={activeEditorPool.isNew}
          // PoolEditor itself is a modal, so no need to wrap it in the generic Modal component
        />
      )}

      {mrrRigs && (
        <Modal isOpen={mrrRigs} onClose={() => setMrrRigs(null)} title="MiningRigRentals Data">
          <pre className="response-body modal">
            {JSON.stringify(mrrRigs, null, 2)}
          </pre>
          <div className="modal-actions">
            <button className="btn-pro primary" onClick={() => setInspectData(mrrRigs)}>Expand View</button>
            <button className="btn-pro secondary" onClick={() => setMrrRigs(null)}>Close</button>
          </div>
        </Modal>
      )}

      {inspectData && (
        <Modal isOpen={inspectData} onClose={() => setInspectData(null)} title="Inspect Response" maxWidth="90vw">
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
    </div>
  )
}