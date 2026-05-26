import React, { useState, useEffect, useRef } from 'react';
import Modal from './Modal';

// Helper functions (copied from Pools.jsx to make PoolEditor self-contained)
function getPoolKey(pool, index = 0) {
  return String(pool?.id || pool?.poolId || pool?.name || pool?.__generatedId || `gen-${index}`)
}

function getPoolId(pool) {
  return pool?.id || pool?.poolId
}

function getPoolLabel(pool, index = 0) {
  return String(pool?.name || pool?.id || pool?.poolId || pool?.__generatedId || `Pool ${index + 1}`)
}

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

export default function PoolEditor({ pool, onClose, onSaveSuccess, onVerifySuccess, initialPoolData, isNew }) {
  const [editorBody, setEditorBody] = useState('');
  const [editorVerifyBody, setEditorVerifyBody] = useState(null);
  const [editorResponse, setEditorResponse] = useState(null);
  const [editorSaveResponse, setEditorSaveResponse] = useState(null);
  const [editorError, setEditorError] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorDetailsLoading, setEditorDetailsLoading] = useState(false);
  const modalRef = useRef(null);

  const currentPoolId = pool?.key;
  const currentPoolLabel = pool?.label;

  useEffect(() => {
    if (initialPoolData) {
      setEditorBody(JSON.stringify(initialPoolData, null, 2));
      try {
        setEditorVerifyBody(buildPoolVerificationBody(initialPoolData));
      } catch {
        setEditorVerifyBody(null);
      }
    } else if (currentPoolId && !isNew) {
      setEditorDetailsLoading(true);
      fetchPoolDetails(currentPoolId);
    } else {
      // For new pools, set a template
      setEditorBody(JSON.stringify({
        name: "My New Pool",
        algorithm: "SHA256",
        stratumHostname: "stratum.example.com",
        stratumPort: 3333,
        username: "worker",
        password: "x"
      }, null, 2));
      setEditorVerifyBody(null);
    }
    // Reset other states when pool changes
    setEditorResponse(null);
    setEditorSaveResponse(null);
    setEditorError('');
    setEditorLoading(false);
    setEditorSaving(false);
  }, [currentPoolId, isNew, initialPoolData]);

  const fetchPoolDetails = async (poolId) => {
    try {
      let res = await fetch(`/api/v2/pool/${encodeURIComponent(poolId)}`);

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10) || 2;
          setEditorError(`Rate limit hit. Retrying in ${seconds}s...`);
          await new Promise(r => setTimeout(r, seconds * 1000));
          res = await fetch(`/api/v2/pool/${encodeURIComponent(poolId)}`);
        }
      }

      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : await res.text();

      if (!res.ok) {
        const message = typeof data === 'string'
          ? `${res.status} ${res.statusText}: ${data.slice(0, 140)}`
          : data?.error || data?.message || res.statusText;
        throw new Error(message);
      }

      setEditorBody(JSON.stringify(data, null, 2));
      setEditorVerifyBody(buildPoolVerificationBody(data));
    } catch (err) {
      setEditorError(`Could not fetch pool details: ${err.message || String(err)}`);
      setEditorBody(JSON.stringify({}, null, 2)); // Fallback to empty JSON
      setEditorVerifyBody(null);
    } finally {
      setEditorDetailsLoading(false);
    }
  };

  const updateEditorBodyHandler = (nextBody) => {
    setEditorBody(nextBody);
    setEditorResponse(null);
    setEditorSaveResponse(null);
    setEditorError('');

    try {
      setEditorVerifyBody(buildPoolVerificationBody(JSON.parse(nextBody)));
    } catch {
      setEditorVerifyBody(null);
    }
  };

  const verifyEditorPool = async () => {
    setEditorLoading(true);
    setEditorError('');
    setEditorResponse(null);

    let poolDetails;
    try {
      poolDetails = JSON.parse(editorBody);
    } catch {
      setEditorError('Invalid JSON in editor body');
      setEditorLoading(false);
      return;
    }

    const payload = buildPoolVerificationBody(poolDetails);
    const missingFields = getMissingVerificationFields(payload);
    setEditorVerifyBody(payload);

    if (missingFields.length > 0) {
      setEditorError(`Missing required verify fields: ${missingFields.join(', ')}`);
      setEditorLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/v2/pools/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const result = { ok: res.ok, poolDetails, requestBody: payload, data };
      setEditorResponse(result);
      if (!res.ok) {
        setEditorError(data?.error || data?.message || res.statusText);
      } else if (onVerifySuccess) {
        onVerifySuccess({ key: currentPoolId, label: currentPoolLabel, result });
      }
    } catch (err) {
      setEditorError(err.message || String(err));
    } finally {
      setEditorLoading(false);
    }
  };

  const saveEditorPool = async ({ verifyAfterSave = false } = {}) => {
    setEditorSaving(true);
    setEditorError('');
    setEditorSaveResponse(null);

    let poolDetails;
    try {
      poolDetails = JSON.parse(editorBody);
    } catch {
      setEditorError('Invalid JSON in editor body');
      setEditorSaving(false);
      return;
    }

    const savePayload = buildPoolSaveBody(poolDetails);
    const missingFields = getMissingSaveFields(savePayload);
    if (missingFields.length > 0) {
      setEditorError(`Missing required save fields: ${missingFields.join(', ')}`);
      setEditorSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/v2/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savePayload),
      });
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : await res.text();
      const saveResult = { ok: res.ok, status: `${res.status} ${res.statusText}`, requestBody: savePayload, data };
      setEditorSaveResponse(saveResult);

      if (!res.ok) {
        const message = typeof data === 'string' ? data : data?.error || data?.message || res.statusText;
        throw new Error(message);
      }

      // Update editor body with fresh data from server if an ID was assigned/updated
      const savedId = data?.id || data?.poolId || savePayload.id;
      if (savedId) {
        const detailRes = await fetch(`/api/v2/pool/${encodeURIComponent(savedId)}`);
        const detailData = await detailRes.json();
        setEditorBody(JSON.stringify(detailData, null, 2));
        setEditorVerifyBody(buildPoolVerificationBody(detailData));
      }

      if (onSaveSuccess) {
        onSaveSuccess(savedId || currentPoolId);
      }

      if (verifyAfterSave) {
        await verifyEditorPool();
      }
    } catch (err) {
      setEditorError(err.message || String(err));
    } finally {
      setEditorSaving(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Pool Editor"
      maxWidth="1100px"
    >
      <div className="pool-editor-header-meta" style={{ 
        marginBottom: '1rem', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        opacity: 0.8,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        paddingBottom: '0.5rem'
      }}>
        <strong>{currentPoolLabel}</strong>
        <span style={{ fontSize: '12px' }}>
          {editorDetailsLoading ? 'Loading details...' : editorResponse ? (isVerifySuccess(editorResponse) ? '✅ Verified' : '❌ Verification Failed') : 'Editing Configuration'}
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
                    return JSON.stringify(buildPoolSaveBody(JSON.parse(editorBody)), null, 2)
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
                  <h3>Latest verify result</h3>
                  <span>{isVerifySuccess(editorResponse) ? 'Success' : 'Fail'}</span>
                </div>
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
    </Modal>
  );
}