import { useEffect, useRef, useState } from 'react'

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
  const [body, setBody] = useState('')
  const [verifyBody, setVerifyBody] = useState(null)
  const [response, setResponse] = useState(null)
  const [verifyResults, setVerifyResults] = useState([])
  const [editor, setEditor] = useState(null)
  const [editorBody, setEditorBody] = useState('')
  const [editorVerifyBody, setEditorVerifyBody] = useState(null)
  const [editorResponse, setEditorResponse] = useState(null)
  const [editorSaveResponse, setEditorSaveResponse] = useState(null)
  const [editorError, setEditorError] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorSaving, setEditorSaving] = useState(false)
  const [editorDetailsLoading, setEditorDetailsLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [running, setRunning] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const runTimerRef = useRef(null)
  const stopRef = useRef(false)
  const activeRequestRef = useRef(null)
  const dropdownRef = useRef(null)

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
      setBody('')
      setVerifyBody(null)
    })
  }, [])

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
    setBody('')
    setVerifyBody(null)
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

      setBody(JSON.stringify(data, null, 2))
      setVerifyBody(buildPoolVerificationBody(data))
    } catch (err) {
      setError(err.message || String(err))
      setBody('')
      setVerifyBody(null)
    } finally {
      setDetailsLoading(false)
    }
  }

  async function verify() {
    if (!selected) {
      setError('Select a pool first.')
      return
    }

    setLoading(true)
    setResponse(null)
    setVerifyResults([])
    setError('')

    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      setError('Invalid JSON in pool body')
      setLoading(false)
      return
    }

    let poolDetails = parsed
    if (Array.isArray(parsed)) {
      poolDetails = parsed.find(item => String(item.id || item.poolId || item.name) === selectedId) || parsed[0]
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.pools)) {
      poolDetails = parsed.pools.find(item => String(item.id || item.poolId || item.name) === selectedId) || parsed.pools[0]
    }

    const payload = buildPoolVerificationBody(poolDetails)
    const missingFields = getMissingVerificationFields(payload)
    setVerifyBody(payload)

    if (missingFields.length > 0) {
      setError(`Missing required verify fields: ${missingFields.join(', ')}`)
      setLoading(false)
      return
    }

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
      return { ok: res.ok, poolDetails, requestBody: payload, data }
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
          const details = poolId
            ? await fetch(`/api/v2/pool/${encodeURIComponent(poolId)}`, { signal: controller.signal }).then(res => res.json())
            : pool
          const bodyToSend = typeof details === 'string' ? JSON.parse(details) : details
          result = await verifyPoolBody(bodyToSend, controller.signal)
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
            if (stopRef.current || Date.now() - startedAt >= 3000) {
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
    await verifyAllOnce({ resetStop: false, keepRunning: true })
    if (stopRef.current) {
      setRunning(false)
      return
    }

    runTimerRef.current = setInterval(() => {
      if (stopRef.current) return
      verifyAllOnce({ resetStop: false, keepRunning: true })
    }, 10 * 60 * 1000)
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
    if (activeRequestRef.current) {
      activeRequestRef.current.abort()
      activeRequestRef.current = null
    }
  }

  function updateEditorBody(nextBody) {
    setEditorBody(nextBody)
    setEditorResponse(null)
    setEditorSaveResponse(null)
    setEditorError('')

    try {
      setEditorVerifyBody(buildPoolVerificationBody(JSON.parse(nextBody)))
    } catch {
      setEditorVerifyBody(null)
    }
  }

  async function openPoolEditor(item) {
    setEditor({ key: item.key, label: item.label })
    setEditorResponse(item.result || null)
    setEditorSaveResponse(null)
    setEditorError('')
    setEditorDetailsLoading(true)

    const pool = pools.find((candidate, index) => getPoolKey(candidate, index) === item.key)
    const poolId = getPoolId(pool) || item.result?.poolDetails?.id || item.result?.poolDetails?.poolId || item.key

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

      setEditorBody(JSON.stringify(data, null, 2))
      setEditorVerifyBody(buildPoolVerificationBody(data))
    } catch (err) {
      let fallbackPool = item.result?.poolDetails || item.result?.requestBody
      if (selectedId === item.key && body) {
        try {
          fallbackPool = JSON.parse(body)
        } catch {
          fallbackPool = item.result?.poolDetails || item.result?.requestBody
        }
      }

      setEditorBody(JSON.stringify(fallbackPool || {}, null, 2))
      setEditorVerifyBody(buildPoolVerificationBody(fallbackPool))
      setEditorError(`Could not fetch pool details: ${err.message || String(err)}`)
    } finally {
      setEditorDetailsLoading(false)
    }
  }

  function closePoolEditor() {
    setEditor(null)
    setEditorBody('')
    setEditorVerifyBody(null)
    setEditorResponse(null)
    setEditorSaveResponse(null)
    setEditorError('')
    setEditorLoading(false)
    setEditorSaving(false)
    setEditorDetailsLoading(false)
  }

  function applyEditorToSelectedPool() {
    if (!editor || editor.key !== selectedId) return
    setBody(editorBody)
    setVerifyBody(editorVerifyBody)
  }

  async function verifyEditorPool() {
    setEditorLoading(true)
    setEditorError('')
    setEditorResponse(null)

    let poolDetails
    try {
      poolDetails = JSON.parse(editorBody)
    } catch {
      setEditorError('Invalid JSON in editor body')
      setEditorLoading(false)
      return
    }

    const payload = buildPoolVerificationBody(poolDetails)
    const missingFields = getMissingVerificationFields(payload)
    setEditorVerifyBody(payload)

    if (missingFields.length > 0) {
      setEditorError(`Missing required verify fields: ${missingFields.join(', ')}`)
      setEditorLoading(false)
      return
    }

    try {
      const res = await fetch('/api/v2/pools/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      const result = { ok: res.ok, poolDetails, requestBody: payload, data }
      setEditorResponse(result)
      setVerifyResults(prev => [
        ...prev.filter(item => item.key !== editor.key),
        { key: editor.key, label: editor.label, result },
      ])
      if (!res.ok) setEditorError(data?.error || data?.message || res.statusText)
    } catch (err) {
      setEditorError(err.message || String(err))
    } finally {
      setEditorLoading(false)
    }
  }

  async function saveEditorPool({ verifyAfterSave = false } = {}) {
    setEditorSaving(true)
    setEditorError('')
    setEditorSaveResponse(null)

    let poolDetails
    try {
      poolDetails = JSON.parse(editorBody)
    } catch {
      setEditorError('Invalid JSON in editor body')
      setEditorSaving(false)
      return
    }

    const savePayload = buildPoolSaveBody(poolDetails)
    const missingFields = getMissingSaveFields(savePayload)
    if (missingFields.length > 0) {
      setEditorError(`Missing required save fields: ${missingFields.join(', ')}`)
      setEditorSaving(false)
      return
    }

    try {
      const res = await fetch('/api/v2/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savePayload),
      })
      const contentType = res.headers.get('content-type') || ''
      const data = contentType.includes('application/json') ? await res.json() : await res.text()
      const saveResult = { ok: res.ok, status: `${res.status} ${res.statusText}`, requestBody: savePayload, data }
      setEditorSaveResponse(saveResult)

      if (!res.ok) {
        const message = typeof data === 'string' ? data : data?.error || data?.message || res.statusText
        throw new Error(message)
      }

      await loadPools()

      const savedId = data?.id || data?.poolId || savePayload.id
      if (savedId) {
        const detailRes = await fetch(`/api/v2/pool/${encodeURIComponent(savedId)}`)
        const detailData = await detailRes.json()
        setEditorBody(JSON.stringify(detailData, null, 2))
        setEditorVerifyBody(buildPoolVerificationBody(detailData))
        if (selectedId === editor.key || selectedId === savedId) {
          setBody(JSON.stringify(detailData, null, 2))
          setVerifyBody(buildPoolVerificationBody(detailData))
        }
      }

      if (verifyAfterSave) {
        await verifyEditorPool()
      }
    } catch (err) {
      setEditorError(err.message || String(err))
    } finally {
      setEditorSaving(false)
    }
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
    <div className="card">
      <h2>Pools</h2>

      <label className="label">Select pool</label>
      <div className="pool-select" ref={dropdownRef}>
        <button
          type="button"
          className={`pool-select-trigger${dropdownOpen ? ' is-open' : ''}`}
          onClick={() => setDropdownOpen(open => !open)}
          aria-haspopup="listbox"
          aria-expanded={dropdownOpen}
        >
          <span>{selectedLabel}</span>
          <small>{detailsLoading ? 'Loading details' : pools.length ? `${pools.length} pools` : 'No pools'}</small>
        </button>

        {dropdownOpen && (
          <div className="pool-select-menu" role="listbox" aria-label="Pools">
            {pools.map((pool, index) => {
              const val = getPoolKey(pool, index)
              const label = getPoolLabel(pool, index)
              return (
                <button
                  type="button"
                  key={val}
                  className={`pool-select-option${selectedId === val ? ' is-selected' : ''}`}
                  onClick={() => onSelect(val)}
                  role="option"
                  aria-selected={selectedId === val}
                >
                  <span>{label}</span>
                  <small>{val}</small>
                </button>
              )
            })}
            {!pools.length && <div className="pool-select-empty">No pools available</div>}
          </div>
        )}
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
                  className="button secondary"
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

      <label className="label">Pool config (JSON)</label>
      <textarea
        className="input pool-json"
        value={body}
        onChange={event => {
          setBody(event.target.value)
          try {
            setVerifyBody(buildPoolVerificationBody(JSON.parse(event.target.value)))
          } catch {
            setVerifyBody(null)
          }
        }}
        placeholder={detailsLoading ? 'Loading pool details...' : 'Select a pool to load its config.'}
        disabled={detailsLoading}
      />

      <div className="pool-request-preview">
        <div className="response-header compact">
          <h3>Verify request body</h3>
          <span>POST /api/v2/pools/verify</span>
        </div>
        <pre className="response-body compact">
          {verifyBody ? JSON.stringify(verifyBody, null, 2) : 'Select a pool to generate the required verify body.'}
        </pre>
      </div>

      <div className="pool-actions">
        <button className="button" onClick={verify} disabled={loading || detailsLoading || playing || !selected}>
          {loading ? 'Verifying...' : 'Verify Pool'}
        </button>
        <button className="button" onClick={() => verifyAllOnce()} disabled={playing || running}>
          {playing ? 'Verifying...' : 'Verify All (3s delay)'}
        </button>
        <button className="button" onClick={startRun} disabled={playing || running}>
          {running ? 'Running...' : 'Auto Run (every 10m)'}
        </button>
        {(playing || running) && (
          <button className="button danger" onClick={stopAutomation}>Stop</button>
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
                      <span className={`verify-status ${pending ? 'pending' : success ? 'success' : 'fail'}`}>
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
                        {item.label}
                      </button>
                      <span className="verify-algorithm">{algorithm}</span>
                      <small>{pending ? 'Waiting for response' : getVerifyMessage(item.result)}</small>
                    </summary>
                    {logs.length > 0 && (
                      <div className="verify-log">
                        <h4>Verification log</h4>
                        {logs.map((log, index) => (
                          <div className="verify-log-row" key={`${item.key}-log-${index}`}>
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

      {editor && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closePoolEditor}>
          <section
            className="pool-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pool-editor-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="response-header">
              <div>
                <h2 id="pool-editor-title">Pool Editor</h2>
                <p>{editor.label}</p>
              </div>
              <span>{editorDetailsLoading ? 'Loading' : editorResponse ? (isVerifySuccess(editorResponse) ? 'Verified' : 'Failed') : 'Editing'}</span>
            </div>

            <div className="pool-editor-grid">
              <label className="label">
                Pool details JSON
                <textarea
                  className="input pool-json editor"
                  value={editorBody}
                  onChange={event => updateEditorBody(event.target.value)}
                  disabled={editorDetailsLoading}
                  placeholder={editorDetailsLoading ? 'Loading pool details...' : ''}
                />
              </label>

              <div className="pool-editor-side">
                <div className="pool-request-preview flat">
                  <div className="response-header compact">
                    <h3>Save request body</h3>
                    <span>POST /api/v2/pool</span>
                  </div>
                  <pre className="response-body compact">
                    {(() => {
                      try {
                        return JSON.stringify(buildPoolSaveBody(JSON.parse(editorBody)), null, 2)
                      } catch {
                        return 'Invalid JSON.'
                      }
                    })()}
                  </pre>
                </div>

                <div className="pool-request-preview flat">
                  <div className="response-header compact">
                    <h3>Verify request body</h3>
                    <span>Generated</span>
                  </div>
                  <pre className="response-body compact">
                    {editorVerifyBody ? JSON.stringify(editorVerifyBody, null, 2) : 'Invalid JSON or unsupported pool shape.'}
                  </pre>
                </div>

                {editorResponse && (
                  <div className="pool-request-preview flat">
                    <div className="response-header compact">
                      <h3>Latest verify result</h3>
                      <span>{isVerifySuccess(editorResponse) ? 'Success' : 'Fail'}</span>
                    </div>
                    <pre className="response-body compact">
                      {JSON.stringify(editorResponse, null, 2)}
                    </pre>
                  </div>
                )}

                {editorSaveResponse && (
                  <div className="pool-request-preview flat">
                    <div className="response-header compact">
                      <h3>Latest save result</h3>
                      <span>{editorSaveResponse.ok ? 'Saved' : 'Fail'}</span>
                    </div>
                    <pre className="response-body compact">
                      {JSON.stringify(editorSaveResponse, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {editorError && <pre className="error-message modal-error">{editorError}</pre>}

            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={applyEditorToSelectedPool}
                disabled={editor.key !== selectedId}
              >
                Apply to Selected
              </button>
              <button type="button" className="button" onClick={() => saveEditorPool()} disabled={editorSaving || editorDetailsLoading}>
                {editorSaving ? 'Saving...' : 'Save Pool'}
              </button>
              <button type="button" className="button secondary" onClick={() => saveEditorPool({ verifyAfterSave: true })} disabled={editorSaving || editorLoading || editorDetailsLoading}>
                Save + Verify
              </button>
              <button type="button" className="button" onClick={verifyEditorPool} disabled={editorLoading || editorDetailsLoading}>
                {editorLoading ? 'Verifying...' : 'Verify Edited Pool'}
              </button>
              <button type="button" className="button secondary" onClick={closePoolEditor}>
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
