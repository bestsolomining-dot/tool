import React, { useState, useEffect, useCallback } from 'react';

/**
 * UI component for Mining Rig Rentals account actions.
 * Provides a client selector and the Balance check functionality.
 */
export default function MrrAccount({ onCall }) {
        const [mrrClient, setMrrClient] = useState('BT');
        const [balance, setBalance] = useState(null);
        const [loading, setLoading] = useState(false);
        const availableClients = ['BT', 'SL', 'ALL'];

        const fetchBalance = useCallback(async (isSilent = true) => {
            if (!mrrClient || mrrClient === 'ALL') {
                setBalance(null);
                return;
            }
            setLoading(true);
            try {
                const result = await onCall('/api/v2/mrr/balance', { query: { client: mrrClient }, silent: isSilent });
                if (result?.success) {
                    setBalance(result.data?.btc || '0');
                }
            } finally {
                setLoading(false);
            }
        }, [mrrClient, onCall]);

        useEffect(() => {
            fetchBalance(true);
        }, [fetchBalance]);

        return (
            <div className="card-pro mrr-account-card">
                <div className="card-header">
                    <h2 className="title-pro">MRR Account Management</h2>
                    <p className="subtitle-pro">View balances and account status</p>
                </div>

                <div className="card-body">
                    <div className="field-row" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                        <div className="field" style={{ flex: 1 }}>
                            <label className="label">MRR Sub-Account Client</label>
                            <select
                                className="select-pro"
                                value={mrrClient}
                                onChange={(e) => setMrrClient(e.target.value)}
                            >
                                {availableClients.map(client => (
                                    <option key={client} value={client}>{client}</option>
                                ))}
                            </select>
                        </div>

                        <button
                            className="btn-pro secondary"
                            disabled={loading}
                            onClick={async () => {
                                const result = await onCall('/api/v2/mrr/balance', { query: { client: mrrClient }, showModal: true });
                                if (result?.success) {
                                    setBalance(result.data?.btc.toFixed(8) || '0');
                                }
                            }}
                        >
                        {loading && !balance ? '...' : 'Balance'} {balance !== null && <span style={{ color: '#fbbf24', marginLeft: '6px' }}>({balance} BTC)</span>}
                        </button>
                    </div>
                    <p className="help-text" style={{ marginTop: '0.75rem', opacity: 0.6, fontSize: '0.8rem' }}>
                        Queries the Mining Rig Rentals API for current BTC and algorithm-specific balances for the selected client.
                    </p>
                </div>
            </div>
        );
}