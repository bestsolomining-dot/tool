import React from 'react';

export default function AppHeader({ loading, error }) {
    return (
        <header className="app-header" style={{
            padding: '40px 0',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            marginBottom: '30px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end'
        }}>
            <div className="brand-block" style={{ flex: 1 }}>
                <h2>Ben Tre Mining Tool</h2>
                <p className="subtitle" style={{ opacity: 0.5, fontSize: '0.95rem', maxWidth: '600px', marginTop: '8px' }}>
                    A powerful desktop tool for Nicehash miners. Manage rigs, monitor stats, and automate hashpower purchases with ease.
                </p>
            </div>
            <div className="status-card" style={{ marginBottom: '5px' }}>
                <div className="status-item">
                    <span style={{ opacity: 0.5, marginRight: '8px' }}>SYSTEM:</span>
                    <span className={`status-value ${loading ? 'status-ready' : error ? 'status-error' : 'status-success'}`}>
                        {loading ? 'Loading...' : error ? 'Error' : 'Ready'}
                    </span>
                </div>
            </div>
        </header>
    );
}