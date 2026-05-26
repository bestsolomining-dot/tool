import { useState } from 'react'
import './App.css'
import Accounting from './components/Accounting'
import Pools from './components/Pools'

function App() {
  const [status, setStatus] = useState('Ready')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [output, setOutput] = useState(null)
  const [lastCall, setLastCall] = useState(null)
  const [responseModalOpen, setResponseModalOpen] = useState(false)
  const [algorithm, setAlgorithm] = useState('SHA256')
  const [market, setMarket] = useState('EU')

  async function callApi(path, options = {}) {
    const startedAt = performance.now()
    const method = options.method || 'GET'

    setLoading(true)
    setError('')
    setStatus(`Calling ${path}`)
    setLastCall({
      method,
      path,
      status: 'Pending',
      durationMs: null,
      timestamp: new Date().toLocaleTimeString(),
    })

    try {
      const response = await fetch(path, options)
      const contentType = response.headers.get('content-type') || ''
      const data = contentType.includes('application/json')
        ? await response.json()
        : await response.text()

      if (!response.ok) {
        const message = typeof data === 'string'
          ? `${response.status} ${response.statusText}: ${data.slice(0, 140)}`
          : data?.error || data?.message || response.statusText
        setLastCall({
          method,
          path,
          status: `${response.status} ${response.statusText}`,
          durationMs: Math.round(performance.now() - startedAt),
          timestamp: new Date().toLocaleTimeString(),
        })
        throw new Error(message)
      }

      setOutput(data)
      setStatus('Success')
      setLastCall({
        method,
        path,
        status: `${response.status} ${response.statusText}`,
        durationMs: Math.round(performance.now() - startedAt),
        timestamp: new Date().toLocaleTimeString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      setOutput(null)
      setStatus('Error')
      setLastCall(prev => ({
        method,
        path,
        status: prev?.status === 'Pending' ? 'Failed' : prev?.status || 'Failed',
        durationMs: Math.round(performance.now() - startedAt),
        timestamp: new Date().toLocaleTimeString(),
      }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <p className="eyebrow">NiceHash API v2</p>
          <h1>NiceHash Toolbox</h1>
          <p>
            Explore NiceHash v2 endpoints through a backend proxy. Use your keys in
            the backend environment and inspect API responses from the browser.
          </p>
        </div>
        <div className="status-card">
          <span className="status-label">Connection status</span>
          <strong className={`status-value status-${status.toLowerCase()}`}>{status}</strong>
          {loading && <small>Loading...</small>}
          {error && <pre className="error-message">{error}</pre>}
          <button
            type="button"
            className="button secondary"
            onClick={() => setResponseModalOpen(true)}
            disabled={!lastCall}
          >
            View API Response
          </button>
        </div>
      </header>

      <main className="dashboard">
        <section className="quick-actions">
        <article className="panel">
          <h2>Public API</h2>
          <button className="button" onClick={() => callApi('/api/v2/time')}>
            Server Time
          </button>
          <button className="button" onClick={() => callApi('/api/v2/algorithms')}>
            Algorithms
          </button>
        </article>

        <Accounting />

        <article className="panel">
          <h2>Mining</h2>
          <button className="button" onClick={() => callApi('/api/v2/mining/rigs')}>
            List Rigs
          </button>
          <button className="button" onClick={() => callApi('/api/v2/mining/address')}>
            Mining Address
          </button>
        </article>

        <article className="panel">
          <h2>Hashpower</h2>
          <label className="label">
            Algorithm
            <input
              type="text"
              className="input"
              value={algorithm}
              onChange={(event) => setAlgorithm(event.target.value)}
            />
          </label>
          <label className="label">
            Market
            <input
              type="text"
              className="input"
              value={market}
              onChange={(event) => setMarket(event.target.value)}
            />
          </label>
          <button
            className="button"
            onClick={() =>
              callApi(
                `/api/v2/hashpower/order-book?algorithm=${encodeURIComponent(algorithm)}&market=${encodeURIComponent(market)}`,
              )
            }
          >
            Fetch Order Book
          </button>
        </article>
        </section>

        <section className="workspace-grid">
          <Pools />
        </section>
      </main>

      {responseModalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setResponseModalOpen(false)}>
          <section
            className="response-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="response-modal-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="response-header">
              <div>
                <h2 id="response-modal-title">Current API Response</h2>
                <p>{lastCall ? `${lastCall.method} ${lastCall.path}` : 'No API call selected'}</p>
              </div>
              <span>{lastCall?.status || 'Idle'}</span>
            </div>
            {lastCall && (
              <div className="response-meta">
                <span>{lastCall.timestamp}</span>
                <span>{lastCall.durationMs === null ? 'In progress' : `${lastCall.durationMs} ms`}</span>
              </div>
            )}
            <pre className="response-body modal">
              {output ? JSON.stringify(output, null, 2) : 'Use a dashboard button to query NiceHash.'}
            </pre>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setResponseModalOpen(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
