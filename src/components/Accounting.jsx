import { useState } from 'react'
import { apiFetch } from '../core/poolUtils'

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

export default function Accounting({ onCall }) {
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

    if (onCall) {
      onCall(path, { ...options, showModal: true });
      return;
    }

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
        options.headers = { 'Content-Type': 'application/json' };
        options.body = body ? JSON.stringify(JSON.parse(body)) : '{}'
      } catch {
        setError('Invalid JSON body');
        setLoading(false);
        return;
      }
    }

    try {
      const result = await apiFetch(path, options);
      setLastCall({
        method: endpoint.method,
        path,
        status: result.status,
        durationMs: Math.round(performance.now() - startedAt),
      });

      if (!result.ok) {
        setError(typeof result.data === 'string' ? result.data : result.data?.error || result.data?.message || result.status);
      } else {
        setOutput(result.data);
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
    <div className="accounting-form">
      {/* <div className="field-row">
        <div className="field">
          <label className="label">Endpoint</label>
          <select className="select-pro" value={endpointKey} onChange={event => setEndpointKey(event.target.value)}>
            {ENDPOINTS.map(item => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">Currency</label>
          <input className="input-pro" value={currency} onChange={event => setCurrency(event.target.value)} />
        </div>
      </div>

      <div className="field">
        <label className="label">Transaction ID</label>
        <input className="input-pro" value={transactionId} onChange={event => setTransactionId(event.target.value)} />
      </div> */}

      {endpoint.method === 'POST' && (
        <div className="field">
          <label className="label">Request Body</label>
          <textarea
            className="input-pro code"
            value={body}
            onChange={event => setBody(event.target.value)}
            placeholder='{"address":"...","amount":0.1}'
          />
        </div>
      )}

      <button className="btn-pro primary" onClick={callApi} disabled={loading}>
        {endpoint.method} Balance
      </button>

      {!onCall && (
        <div className="inline-response">
          {error && <pre className="error-message">{error}</pre>}
          <div className="inline-response-header">
            <h3>Response</h3>
            <span>{lastCall ? `${lastCall.method} ${lastCall.path}` : 'No call yet'}</span>
          </div>
          <pre className="response-body">{output ? JSON.stringify(output, null, 2) : 'No response yet'}</pre>
        </div>
      )}
    </div>
  )
}
