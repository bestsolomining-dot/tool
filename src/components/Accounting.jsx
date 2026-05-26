import { useState } from 'react'

const ENDPOINTS = [
  { key: 'balances', label: 'Get All Balances', method: 'GET', path: '/api/v2/accounting/balances' },
  { key: 'balance', label: 'Get Balance (by currency)', method: 'GET', path: '/api/v2/accounting/balance/{currency}' },
  { key: 'activitiesAll', label: 'Get All Activities', method: 'GET', path: '/api/v2/accounting/activities' },
  { key: 'activity', label: 'Get Activities (by currency)', method: 'GET', path: '/api/v2/accounting/activity/{currency}' },
  { key: 'currencies', label: 'Get Currencies', method: 'GET', path: '/api/v2/accounting/currencies' },
  { key: 'depositAddresses', label: 'Deposit Addresses', method: 'GET', path: '/api/v2/accounting/depositAddresses' },
  { key: 'deposits', label: 'Get Deposits (all)', method: 'GET', path: '/api/v2/accounting/deposits' },
  { key: 'depositsByCurrency', label: 'Get Deposits (by currency)', method: 'GET', path: '/api/v2/accounting/deposits/{currency}' },
  { key: 'withdrawals', label: 'Get Withdrawals (by currency)', method: 'GET', path: '/api/v2/accounting/withdrawals/{currency}' },
  { key: 'createWithdrawal', label: 'Create Withdrawal (POST)', method: 'POST', path: '/api/v2/accounting/withdrawal' },
  { key: 'transaction', label: 'Get Transaction (by currency & id)', method: 'GET', path: '/api/v2/accounting/transaction/{currency}/{transactionId}' },
]

export default function Accounting() {
  const [endpointKey, setEndpointKey] = useState('balances')
  const [currency, setCurrency] = useState('BTC')
  const [transactionId, setTransactionId] = useState('')
  const [body, setBody] = useState('')
  const [output, setOutput] = useState(null)
  const [lastCall, setLastCall] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const endpoint = ENDPOINTS.find(item => item.key === endpointKey)

  function buildPath() {
    return endpoint.path
      .replace('{currency}', encodeURIComponent(currency))
      .replace('{transactionId}', encodeURIComponent(transactionId))
  }

  async function callApi() {
    const startedAt = performance.now()
    const path = buildPath()
    const options = { method: endpoint.method }

    setLoading(true)
    setError('')
    setOutput(null)
    setLastCall({
      method: endpoint.method,
      path,
      status: 'Pending',
      durationMs: null,
    })

    if (endpoint.method === 'POST') {
      try {
        options.headers = { 'Content-Type': 'application/json' }
        options.body = body ? JSON.stringify(JSON.parse(body)) : '{}'
      } catch {
        setError('Invalid JSON body')
        setLoading(false)
        return
      }
    }

    try {
      const res = await fetch(path, options)
      const contentType = res.headers.get('content-type') || ''
      const data = contentType.includes('application/json') ? await res.json() : await res.text()

      setLastCall({
        method: endpoint.method,
        path,
        status: `${res.status} ${res.statusText}`,
        durationMs: Math.round(performance.now() - startedAt),
      })

      if (!res.ok) {
        setError(typeof data === 'string' ? data : data?.error || data?.message || res.statusText)
      } else {
        setOutput(data)
      }
    } catch (err) {
      setError(err.message || String(err))
      setLastCall(prev => ({
        ...prev,
        status: 'Failed',
        durationMs: Math.round(performance.now() - startedAt),
      }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h2>Accounting</h2>

      <label className="label">Endpoint</label>
      <select className="input" value={endpointKey} onChange={event => setEndpointKey(event.target.value)}>
        {ENDPOINTS.map(item => (
          <option key={item.key} value={item.key}>{item.label}</option>
        ))}
      </select>

      <label className="label">Currency (if applicable)</label>
      <input className="input" value={currency} onChange={event => setCurrency(event.target.value)} />

      <label className="label">Transaction ID (if applicable)</label>
      <input className="input" value={transactionId} onChange={event => setTransactionId(event.target.value)} />

      <label className="label">POST Body (JSON, if applicable)</label>
      <textarea
        className="input"
        style={{ minHeight: 90 }}
        value={body}
        onChange={event => setBody(event.target.value)}
        placeholder='{"address":"...","amount":0.1}'
      />

      <button className="button" onClick={callApi} disabled={loading}>
        {loading ? 'Calling...' : 'Call Accounting API'}
      </button>

      {error && <pre className="error-message">{error}</pre>}

      <div className="inline-response">
        <div className="inline-response-header">
          <h3>Response</h3>
          <span>{lastCall ? `${lastCall.method} ${lastCall.path}` : 'No call yet'}</span>
        </div>
        {lastCall && (
          <div className="response-meta inline">
            <span>{lastCall.status}</span>
            <span>{lastCall.durationMs === null ? 'In progress' : `${lastCall.durationMs} ms`}</span>
          </div>
        )}
        <pre className="response-body">{output ? JSON.stringify(output, null, 2) : 'No response yet'}</pre>
      </div>
    </div>
  )
}
