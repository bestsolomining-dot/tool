import React, { useEffect, useState } from 'react'
import Modal from './Modal'
import { poolHelpers as ph, apiFetch, poolApi } from '../core/poolUtils' // Assuming nhClient is passed as a prop

export default function PoolEditor({ pool, onClose, onSaveSuccess, onVerifySuccess, initialPoolData, isNew, isPopout = false, nhClient }) {
  const [editorBody, setEditorBody] = useState('')
  const [editorVerifyBody, setEditorVerifyBody] = useState(null) // This is the payload for verification
  const [editorResponse, setEditorResponse] = useState(null)
  const [editorSaveResponse, setEditorSaveResponse] = useState(null)
  const [editorError, setEditorError] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorSaving, setEditorSaving] = useState(false)
  const [editorDetailsLoading, setEditorDetailsLoading] = useState(false)
  const [editorLastCall, setEditorLastCall] = useState(null)

  const currentPoolId = pool?.id || pool?.key
  const currentPoolLabel = pool?.label

  useEffect(() => {
    let cancelled = false

    setEditorResponse(null)
    setEditorSaveResponse(null)
    setEditorError('')
    setEditorLoading(false)
    setEditorSaving(false)
    setEditorDetailsLoading(false)
    setEditorLastCall(null)

    if (initialPoolData) {
      setEditorBody(JSON.stringify(initialPoolData, null, 2))
      try {
        setEditorVerifyBody(ph.buildVerifyBody(initialPoolData))
      } catch {
        setEditorVerifyBody(null)
      }
    } else if (isNew) {
      setEditorBody(JSON.stringify({
        name: 'My New Pool',
        algorithm: 'SHA256',
        stratumHostname: 'stratum.example.com',
        stratumPort: 3333,
        username: 'worker',
        password: 'x',
      }, null, 2))
      setEditorVerifyBody(null)
    } else {
      setEditorBody(JSON.stringify({}, null, 2))
      setEditorVerifyBody(null)
    }

    async function loadDetails() {
      if (!currentPoolId || isNew) return

      setEditorDetailsLoading(true)
      const result = await callEditorApi(poolApi.get(currentPoolId), 'Pool details');

      if (cancelled) return

      if (result.ok) {
        setEditorBody(JSON.stringify(result.data, null, 2))
        setEditorVerifyBody(ph.buildVerifyBody(result.data))
        setEditorResponse(result)
      } else {
        const message = typeof result.data === 'string'
          ? `${result.status}: ${result.data.slice(0, 140)}`
          : result.data?.error || result.data?.message || result.status
        setEditorError(`Could not fetch pool details: ${message}`)
        setEditorBody(JSON.stringify({}, null, 2))
        setEditorVerifyBody(null)
        setEditorResponse(result)
      }

      setEditorDetailsLoading(false)
    }

    loadDetails()

    return () => {
      cancelled = true
    }
  }, [currentPoolId, isNew, initialPoolData])

  const callEditorApi = async (apiPromise, responseLabel) => {
    const startedAt = performance.now()
    const result = await apiPromise;
    const durationMs = Math.round(performance.now() - startedAt);
    
    setEditorLastCall({
      label: responseLabel,
      status: result.status || 'Failed',
      durationMs: durationMs,
    });

    return { ...result, durationMs };
  }

  const updateEditorBodyHandler = (nextBody) => {
    setEditorBody(nextBody)
    setEditorResponse(null)
    setEditorSaveResponse(null)
    setEditorError('')

    try {
      setEditorVerifyBody(ph.buildVerifyBody(JSON.parse(nextBody)))
    } catch {
      setEditorVerifyBody(null)
    }
  }

  const verifyEditorPool = async () => {
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

    if (poolDetails.name?.toLowerCase() === 'active') {
      setEditorLoading(false)
      return
    }

    const payload = ph.buildVerifyBody(poolDetails)
    const missingFields = ph.getMissingVerifyFields(payload)
    setEditorVerifyBody(payload)

    if (missingFields.length > 0) {
      setEditorError(`Missing required verify fields: ${missingFields.join(', ')}`)
      setEditorLoading(false)
      return
    }

    try {
      const result = await callEditorApi(poolApi.verify(payload, nhClient), 'Verify pool'); // Pass nhClient
      const enrichedResult = { ...result, poolDetails }
      setEditorResponse(enrichedResult)

      if (!result.ok) {
        setEditorError(result.data?.error || result.data?.message || result.status)
      } else if (onVerifySuccess) {
        onVerifySuccess({ key: currentPoolId, label: currentPoolLabel, result: enrichedResult })
      }
    } catch (err) {
      setEditorError(err.message || String(err))
    } finally {
      setEditorLoading(false)
    }
  }

  const saveEditorPool = async ({ verifyAfterSave = false } = {}) => {
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

    const savePayload = ph.buildSaveBody(poolDetails)
    const missingFields = ph.getMissingSaveFields(savePayload)
    if (missingFields.length > 0) {
      setEditorError(`Missing required save fields: ${missingFields.join(', ')}`)
      setEditorSaving(false)
      return
    }

    try {
      const saveResult = await callEditorApi(poolApi.save(savePayload, nhClient), 'Save pool'); // Pass nhClient
      setEditorSaveResponse(saveResult)

      if (!saveResult.ok) {
        const message = typeof saveResult.data === 'string'
          ? saveResult.data
          : saveResult.data?.error || saveResult.data?.message || saveResult.status
        throw new Error(message)
      }

      const savedId = saveResult.data?.id || saveResult.data?.poolId || savePayload.id
      if (savedId) {
        const detailResult = await callEditorApi(poolApi.get(savedId), 'Reload pool details');

        if (detailResult.ok) {
          setEditorBody(JSON.stringify(detailResult.data, null, 2))
          setEditorVerifyBody(ph.buildVerifyBody(detailResult.data))
          setEditorResponse(detailResult)
        }
      }

      if (onSaveSuccess) {
        onSaveSuccess(savedId || currentPoolId)
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

  return (
    <div className={isPopout ? 'pool-editor-popout-container' : ''}>
      {isPopout && (
        <div className="popout-header" style={{ marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Pool Editor</h2>
          <small style={{ opacity: 0.5 }}>External Window Mode</small>
        </div>
      )}
      <div
        className="pool-editor-header-meta"
        style={{
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          opacity: 0.8,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          paddingBottom: '0.5rem',
        }}
      >
        <strong>{currentPoolLabel}</strong>
        <span style={{ fontSize: '12px' }}>
          {editorDetailsLoading ? 'Loading details...' : editorResponse ? (ph.isVerifySuccess(editorResponse) ? 'Verified' : 'Verification Failed') : 'Editing Configuration'}
        </span>
      </div>

      <div className="pool-editor-grid">
        <label className="label">
          Pool details JSON
          <textarea
            className="input-pro code"
            value={editorBody}
            onChange={event => updateEditorBodyHandler(event.target.value)}
            disabled={editorDetailsLoading}
            placeholder={editorDetailsLoading ? 'Loading pool details...' : ''}
          />
        </label>

        <div className="pool-editor-side">
          <div className="code-block-wrapper">
            <div className="code-block-header">
              <h3>Save request body</h3>
              <span>POST /api/v2/pool</span>
            </div>
            <pre className="code-block-content">
              {(() => {
                try {
                  return JSON.stringify(ph.buildSaveBody(JSON.parse(editorBody)), null, 2)
                } catch {
                  return 'Invalid JSON.'
                }
              })()}
            </pre>
          </div>

          <div className="code-block-wrapper">
            <div className="code-block-header">
              <h3>Verify request body</h3>
              <span>Generated</span>
            </div>
            <pre className="code-block-content">
              {editorVerifyBody ? JSON.stringify(editorVerifyBody, null, 2) : 'Invalid JSON or unsupported pool shape.'}
            </pre>
          </div>

          {editorResponse && (
            <div className="code-block-wrapper">
              <div className="code-block-header">
                <h3>Latest API response</h3>
                <span>{editorLastCall?.label || (editorResponse.ok ? 'Success' : 'Fail')}</span>
              </div>
              {editorLastCall && (
                <div className="response-meta" style={{ padding: '0.75rem 1rem 0', opacity: 0.75, fontSize: '12px' }}>
                  <span>{editorLastCall.method} {editorLastCall.path}</span>
                  <span>{editorLastCall.status} ({editorLastCall.durationMs}ms)</span>
                </div>
              )}
              <pre className="code-block-content">
                {JSON.stringify(editorResponse, null, 2)}
              </pre>
            </div>
          )}

          {editorSaveResponse && (
            <div className="code-block-wrapper">
              <div className="code-block-header">
                <h3>Latest save result</h3>
                <span>{editorSaveResponse.ok ? 'Saved' : 'Fail'}</span>
              </div>
              <pre className="code-block-content">
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
          className="btn-pro primary"
          onClick={() => saveEditorPool()}
          disabled={editorSaving || editorDetailsLoading}
        >
          {editorSaving ? 'Saving...' : 'Save Pool'}
        </button>
        <button
          type="button"
          className="btn-pro"
          onClick={() => saveEditorPool({ verifyAfterSave: true })}
          disabled={editorSaving || editorLoading || editorDetailsLoading}
        >
          Save + Verify
        </button>
        <button
          type="button"
          className="btn-pro"
          onClick={verifyEditorPool}
          disabled={editorLoading || editorDetailsLoading}
        >
          {editorLoading ? 'Verifying...' : 'Verify Edited Pool'}
        </button>
        <button type="button" className="btn-pro secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
