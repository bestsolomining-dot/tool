import { useState } from 'react';

export default function MiningRigMRR({ onCall }) {
    const [mrrClient, setMrrClient] = useState('BT');
    const [mrrMethod, setMrrMethod] = useState('GET');
    const [mrrEndpoint, setMrrEndpoint] = useState('/rig/mine');
    const [mrrBody, setMrrBody] = useState('');
    const [rigId, setRigId] = useState('');

    const callMrrFunction = () => {
        const endpoint = mrrEndpoint.trim();
        if (!endpoint) return;

        let parsedBody;
        if (mrrBody.trim()) {
            try {
                parsedBody = JSON.parse(mrrBody);
            } catch {
                window.alert('Invalid JSON body');
                return;
            }
        }

        onCall('/api/v2/mrr/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client: mrrClient,
                method: mrrMethod,
                endpoint,
                body: parsedBody,
            }),
        });
    };

    return (
        <div className="rig-section mrr-theme" style={{ marginTop: '30px', borderTop: '1px solid #444', paddingTop: '20px' }}>
            <h3 className="section-title">MiningRigRentals</h3>
            <div className="market-inputs">
                <select className="select-pro" value={mrrClient} onChange={(e) => setMrrClient(e.target.value)}>
                    <option value="BT">Client: BT</option>
                    <option value="SL">Client: SL</option>
                </select>
            </div>

            <div className="button-group" style={{ marginTop: '10px' }}>
                <button className="btn-pro secondary" onClick={() => onCall('/api/v2/mrr/rigs', { query: { client: mrrClient } })}>My Rigs</button>
                <button className="btn-pro secondary" onClick={() => onCall(`/api/v2/mrr/balance?client=${mrrClient}`)}>Balance</button>
                <button className="btn-pro secondary" onClick={() => onCall(`/api/v2/mrr/algos?client=${mrrClient}`)}>Algos</button>
                <button className="btn-pro secondary" onClick={() => onCall(`/api/v2/mrr/profiles?client=${mrrClient}`)}>Profiles</button>
                <button className="btn-pro secondary" onClick={() => onCall(`/api/v2/mrr/rentals?client=${mrrClient}`)}>Rentals</button>
            </div>

            <div className="market-inputs" style={{ marginTop: '15px' }}>
                <input
                    className="input-pro"
                    placeholder="MRR Rig ID(s) (e.g. 81;82;83)"
                    value={rigId}
                    onChange={(e) => setRigId(e.target.value)}
                />
                <button className="btn-pro secondary" disabled={!rigId.trim()} onClick={() => onCall(`/api/v2/mrr/rig/${encodeURIComponent(rigId.trim())}/info?client=${mrrClient}`)}>
                    Get Rig Info
                </button>
                <button className="btn-pro secondary" disabled={!rigId.trim()} onClick={() => onCall(`/api/v2/mrr/rig/${encodeURIComponent(rigId.trim())}/pool?client=${mrrClient}`)}>
                    Get Pools
                </button>
            </div>

            <div className="market-inputs" style={{ marginTop: '15px', alignItems: 'stretch' }}>
                <select className="select-pro" value={mrrMethod} onChange={(e) => setMrrMethod(e.target.value)}>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                </select>
                <input
                    className="input-pro"
                    placeholder="Endpoint (e.g. /rig/mine)"
                    value={mrrEndpoint}
                    onChange={(e) => setMrrEndpoint(e.target.value)}
                />
                <button className="btn-pro secondary" onClick={callMrrFunction}>Execute</button>
            </div>
            <textarea
                className="input-pro"
                style={{ marginTop: '10px', minHeight: '80px', width: '100%' }}
                placeholder='JSON Body (Optional)'
                value={mrrBody}
                onChange={(e) => setMrrBody(e.target.value)}
            />
            
        </div>
    );
}