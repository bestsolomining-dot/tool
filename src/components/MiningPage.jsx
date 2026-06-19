import HeroMinersCard from './HeroMinersCard';
import MiningCoin from './MiningCoin.jsx';
import { RentedRigProvider } from './RentedRigContext.jsx';
import { MiningWorkspaceProvider, useMiningWorkspace } from './MiningWorkspaceProvider.jsx';
import { btcValue, compactNumber, percentValue } from './miningWorkspaceData';

function StatCard({ label, value, accent }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: '14px',
      border: '1px solid rgba(148,163,184,0.12)',
      background: 'rgba(15,23,42,0.74)',
      boxShadow: '0 12px 24px rgba(0,0,0,0.15)',
    }}>
      <div style={{ color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color: accent, fontSize: '24px', lineHeight: 1.1, fontWeight: 900, marginTop: '6px' }}>{value}</div>
    </div>
  );
}

function MiningRouteHero() {
  const { routes, heroRows, miningDutchRows, loading, error, lastUpdated, refresh } = useMiningWorkspace();
  const bestRoute = routes[0] || null;
  const activeRouteCount = routes.filter((route) => route.miningDutchBtcPerDay > 0 || route.heroMiners > 0).length;
  const profitableCount = routes.filter((route) => route.spread > 0).length;

  return (
    <section style={{ display: 'grid', gap: '14px', marginBottom: '18px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: '12px',
      }}>
        <StatCard label="Tracked HeroMiners" value={compactNumber(heroRows.length, 0)} accent="#38bdf8" />
        <StatCard label="Mining-Dutch algos" value={compactNumber(miningDutchRows.length, 0)} accent="#fbbf24" />
        <StatCard label="Positive spread" value={compactNumber(profitableCount, 0)} accent="#34d399" />
        <StatCard label="Active routes" value={compactNumber(activeRouteCount, 0)} accent="#a78bfa" />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.1fr 0.9fr',
        gap: '14px',
      }}>
        <div style={{
          padding: '18px',
          borderRadius: '18px',
          border: '1px solid rgba(148,163,184,0.12)',
          background: 'linear-gradient(135deg, rgba(15,23,42,0.9), rgba(15,23,42,0.55))',
          boxShadow: '0 18px 40px rgba(0,0,0,0.20)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <div>
              <div style={{ color: '#38bdf8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Route Intel</div>
              <div style={{ color: '#f8fafc', fontSize: '18px', fontWeight: 800 }}>Best current route</div>
            </div>
            <button className="btn-pro secondary" onClick={() => void refresh(true)} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh routes'}
            </button>
          </div>

          {error && <div style={{ color: '#f87171', fontSize: '12px', marginBottom: '10px' }}>{error}</div>}

          {bestRoute ? (
            <div style={{
              display: 'grid',
              gap: '8px',
              padding: '14px',
              borderRadius: '14px',
              background: 'rgba(2,6,23,0.45)',
              border: '1px solid rgba(148,163,184,0.10)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '22px', fontWeight: 800 }}>{bestRoute.label}</div>
                  <div style={{ color: '#94a3b8', fontSize: '12px' }}>{bestRoute.bestSource} to NiceHash / MRR mapping</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#34d399', fontSize: '18px', fontWeight: 800 }}>{btcValue(bestRoute.miningDutchBtcPerDay)}</div>
                  <div style={{ color: '#94a3b8', fontSize: '11px' }}>BTC/day</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', color: '#cbd5e1', fontSize: '12px' }}>
                <span>NiceHash: {bestRoute.nicehashAlgo}</span>
                <span>MRR: {bestRoute.mrrAlgo}</span>
                <span>Spread: {bestRoute.spread === null ? 'N/A' : percentValue(bestRoute.spread)}</span>
                <span>Hero miners: {compactNumber(bestRoute.heroMiners, 0)}</span>
              </div>
            </div>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: '12px', padding: '8px 0' }}>
              No route data yet. Refresh once the pool stats finish loading.
            </div>
          )}

          <div style={{ marginTop: '10px', color: '#64748b', fontSize: '11px' }}>
            {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : 'Waiting for initial mining sync...'}
          </div>
        </div>

        <div style={{
          padding: '18px',
          borderRadius: '18px',
          border: '1px solid rgba(148,163,184,0.12)',
          background: 'linear-gradient(135deg, rgba(15,23,42,0.82), rgba(2,6,23,0.78))',
          boxShadow: '0 18px 40px rgba(0,0,0,0.20)',
        }}>
          <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: 800, marginBottom: '10px' }}>
            Top Route Candidates
          </div>
          <div style={{ display: 'grid', gap: '8px', maxHeight: '170px', overflow: 'auto' }}>
            {routes.slice(0, 5).map((route) => (
              <div key={route.nicehashAlgo} style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '10px 12px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(148,163,184,0.08)',
              }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{route.label}</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>{route.nicehashAlgo} • {route.mrrAlgo}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: route.spread > 0 ? '#34d399' : '#94a3b8', fontWeight: 800 }}>{btcValue(route.miningDutchBtcPerDay)}</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>{route.spread === null ? 'N/A' : percentValue(route.spread)}</div>
                </div>
              </div>
            ))}
            {routes.length === 0 && (
              <div style={{ color: '#94a3b8', fontSize: '12px' }}>No route candidates available.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MiningWorkspaceShell({ onNavigateHome, onCall, nhClient }) {
  return (
    <div
      className="app-shell mining-shell"
      style={{
        padding: '0 20px 40px',
        maxWidth: '1600px',
        margin: '0 auto',
        background: 'radial-gradient(circle at top left, rgba(56,189,248,0.16), transparent 32%), radial-gradient(circle at top right, rgba(16,185,129,0.14), transparent 28%), linear-gradient(180deg, rgba(2,6,23,0.95), rgba(15,23,42,0.96))',
        minHeight: '100vh',
      }}
    >
      <header style={{
        padding: '36px 0 18px',
        marginBottom: '18px',
        borderBottom: '1px solid rgba(148,163,184,0.10)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: '260px' }}>
          <div style={{ color: '#38bdf8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: '8px' }}>
            Mining Workspace
          </div>
          <h2 style={{ margin: 0, fontSize: '34px', lineHeight: 1.05, color: '#f8fafc' }}>
            HeroMiners + Mining-Dutch
          </h2>
          <p className="subtitle" style={{ margin: '8px 0 0', maxWidth: '760px' }}>
            Dedicated profitability routing view with live route intelligence, current pool stats, and profitability comparison.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn-pro secondary" onClick={onNavigateHome}>
            Back to Dashboard
          </button>
          <button className="btn-pro secondary" onClick={() => window.location.reload()}>
            Refresh
          </button>
        </div>
      </header>

      <MiningRouteHero />

      <section style={{
        display: 'grid',
        gridTemplateColumns: '1.15fr 0.85fr',
        gap: '18px',
        alignItems: 'start',
      }}>
        <article style={{
          padding: '18px',
          background: 'rgba(15,23,42,0.72)',
          border: '1px solid rgba(148,163,184,0.12)',
          borderRadius: '18px',
          boxShadow: '0 18px 40px rgba(0,0,0,0.20)',
        }}>
          <HeroMinersCard onCall={onCall} />
        </article>

        <aside style={{
          padding: '18px',
          background: 'rgba(15,23,42,0.72)',
          border: '1px solid rgba(148,163,184,0.12)',
          borderRadius: '18px',
          boxShadow: '0 18px 40px rgba(0,0,0,0.20)',
        }}>
          <MiningCoin onCall={onCall} nhClient={nhClient} />
        </aside>
      </section>
    </div>
  );
}

export default function MiningPage({ onCall, nhClient = 'BT', onNavigateHome }) {
  return (
    <RentedRigProvider callApi={onCall}>
      <MiningWorkspaceProvider onCall={onCall} nhClient={nhClient}>
        <MiningWorkspaceShell onNavigateHome={onNavigateHome} onCall={onCall} nhClient={nhClient} />
      </MiningWorkspaceProvider>
    </RentedRigProvider>
  );
}
