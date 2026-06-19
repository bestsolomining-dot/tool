import HeroMinersCard from './HeroMinersCard';
import MiningCoin, { HeaderCell, BodyCell } from './MiningCoin.jsx';
import TelegramManager from './TelegramManager.jsx';
import { RentedRigProvider } from './RentedRigContext.jsx';
import { MiningWorkspaceProvider, useMiningWorkspace } from './MiningWorkspaceProvider';
import { btcValue, compactNumber, percentValue } from './miningWorkspaceData';

function StatCard({ label, value, accent }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: '12px',
      border: '1px solid rgba(148,163,184,0.12)',
      background: 'rgba(15,23,42,0.74)',
      boxShadow: '0 12px 24px rgba(0,0,0,0.15)',
    }}>
      <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color: accent, fontSize: '22px', lineHeight: 1.1, fontWeight: 900, marginTop: '5px' }}>{value}</div>
    </div>
  );
}

function MiningRouteHero() {
  const { routes, opportunities, heroRows, miningDutchRows, loading, error, lastUpdated, refresh } = useMiningWorkspace();
  const bestRoute = routes[0] || null;
  const activeRouteCount = routes.filter((route) => route.miningDutchBtcPerDay > 0 || route.heroMiners > 0).length;
  const profitableCount = routes.filter((route) => route.spread > 0).length;
  const bestOpportunity = opportunities[0] || null;

  return (
    <section style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
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
        gap: '12px',
      }}>
        <div style={{
          padding: '16px',
          borderRadius: '16px',
          border: '1px solid rgba(148,163,184,0.12)',
          background: 'linear-gradient(135deg, rgba(15,23,42,0.9), rgba(15,23,42,0.55))',
          boxShadow: '0 18px 40px rgba(0,0,0,0.20)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <div>
              <div style={{ color: '#38bdf8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Route Intel</div>
              <div style={{ color: '#f8fafc', fontSize: '16px', fontWeight: 800 }}>Best current route</div>
            </div>
            <button className="btn-pro secondary" onClick={() => void refresh(true)} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh routes'}
            </button>
          </div>

          {error && <div style={{ color: '#f87171', fontSize: '12px', marginBottom: '10px' }}>{error}</div>}

          {bestRoute ? (
            <div style={{
              display: 'grid',
              gap: '6px',
              padding: '12px',
              borderRadius: '12px',
              background: 'rgba(2,6,23,0.45)',
              border: '1px solid rgba(148,163,184,0.10)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '20px', fontWeight: 800 }}>{bestRoute.label}</div>
                  <div style={{ color: '#94a3b8', fontSize: '11px' }}>{bestRoute.bestSource} to NiceHash / MRR mapping</div>
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
          padding: '16px',
          borderRadius: '16px',
          border: '1px solid rgba(148,163,184,0.12)',
          background: 'linear-gradient(135deg, rgba(15,23,42,0.82), rgba(2,6,23,0.78))',
          boxShadow: '0 18px 40px rgba(0,0,0,0.20)',
        }}>
          <div style={{ color: '#f8fafc', fontSize: '14px', fontWeight: 800, marginBottom: '8px' }}>
            Top Route Candidates
          </div>
          <div style={{ display: 'grid', gap: '8px', maxHeight: '170px', overflow: 'auto' }}>
            {routes.slice(0, 5).map((route) => (
              <div key={route.nicehashAlgo} style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '8px 10px',
                borderRadius: '10px',
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

      <div style={{
        padding: '16px',
        borderRadius: '16px',
        border: '1px solid rgba(148,163,184,0.12)',
        background: 'rgba(15,23,42,0.72)',
        boxShadow: '0 18px 40px rgba(0,0,0,0.20)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <div>
            <div style={{ color: '#38bdf8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Opportunity Finder</div>
            <div style={{ color: '#f8fafc', fontSize: '16px', fontWeight: 800 }}>Pool revenue vs NiceHash / MRR market price</div>
          </div>
          <div style={{ color: '#94a3b8', fontSize: '12px' }}>
            Compare the same algo/day across all three sources
          </div>
        </div>

        {bestOpportunity ? (
          <div style={{
            display: 'grid',
            gap: '8px',
            marginBottom: '12px',
            padding: '12px',
            borderRadius: '12px',
            border: '1px solid rgba(148,163,184,0.10)',
            background: 'linear-gradient(135deg, rgba(2,6,23,0.45), rgba(15,23,42,0.88))',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: '20px', fontWeight: 900 }}>{bestOpportunity.label}</div>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>
                  Winner: {bestOpportunity.winner} · NiceHash {bestOpportunity.nicehashAlgo} · MRR {bestOpportunity.mrrAlgo}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: bestOpportunity.opportunityScore >= 0 ? '#34d399' : '#f87171', fontSize: '16px', fontWeight: 900 }}>
                  {btcValue(bestOpportunity.opportunityScore)}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Opportunity BTC/day</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
              <MiniStat label="Pool revenue" value={btcValue(bestOpportunity.poolRevenue)} tone="#34d399" />
              <MiniStat label="NiceHash buy/day" value={btcValue(bestOpportunity.niceHashPrice)} tone="#60a5fa" />
              <MiniStat label="MRR market/day" value={btcValue(bestOpportunity.mrrMarketPrice)} tone="#fbbf24" />
              <MiniStat label="Spread vs NH" value={bestOpportunity.spreadVsNh === null ? 'N/A' : percentValue(bestOpportunity.spreadVsNh)} tone="#a78bfa" />
            </div>
          </div>
        ) : (
          <div style={{ color: '#94a3b8', fontSize: '12px' }}>No opportunity rows yet.</div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1100px' }}>
            <thead>
              <tr style={{ color: '#94a3b8', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
                <HeaderCell align="left">Algo</HeaderCell>
                <HeaderCell align="left">Winner</HeaderCell>
                <HeaderCell>Pool BTC/day</HeaderCell>
                <HeaderCell>NH Buy/day</HeaderCell>
                <HeaderCell>MRR Market/day</HeaderCell>
                <HeaderCell>Spread NH</HeaderCell>
                <HeaderCell>Spread MRR</HeaderCell>
                <HeaderCell>Hero Coins</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {opportunities.slice(0, 10).map((row) => (
                <tr key={row.nicehashAlgo} style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                  <BodyCell align="left">
                    <strong style={{ color: '#e2e8f0' }}>{row.label}</strong>
                    <div style={{ color: '#64748b', fontSize: '11px', marginTop: '2px' }}>{row.nicehashAlgo} • {row.mrrAlgo}</div>
                  </BodyCell>
                  <BodyCell align="left">{row.winner}</BodyCell>
                  <BodyCell><strong style={{ color: '#34d399' }}>{btcValue(row.poolRevenue)}</strong></BodyCell>
                  <BodyCell><strong style={{ color: '#60a5fa' }}>{btcValue(row.niceHashPrice)}</strong></BodyCell>
                  <BodyCell><strong style={{ color: '#fbbf24' }}>{btcValue(row.mrrMarketPrice)}</strong></BodyCell>
                  <BodyCell>
                    <span style={{ color: row.spreadVsNh > 0 ? '#34d399' : row.spreadVsNh < 0 ? '#f87171' : '#94a3b8', fontWeight: 700 }}>
                      {row.spreadVsNh === null ? 'N/A' : percentValue(row.spreadVsNh)}
                    </span>
                  </BodyCell>
                  <BodyCell>
                    <span style={{ color: row.spreadVsMrr > 0 ? '#34d399' : row.spreadVsMrr < 0 ? '#f87171' : '#94a3b8', fontWeight: 700 }}>
                      {row.spreadVsMrr === null ? 'N/A' : percentValue(row.spreadVsMrr)}
                    </span>
                  </BodyCell>
                  <BodyCell align="left">
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {row.heroCoins.slice(0, 4).map((coin) => (
                        <span key={coin} style={{
                          border: '1px solid rgba(96,165,250,0.22)',
                          color: '#bfdbfe',
                          background: 'rgba(37,99,235,0.12)',
                          borderRadius: '999px',
                          padding: '2px 6px',
                          fontSize: '10px',
                        }}>
                          {coin}
                        </span>
                      ))}
                    </div>
                  </BodyCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value, tone }) {
  return (
    <div style={{
      padding: '10px',
      borderRadius: '10px',
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(148,163,184,0.08)',
    }}>
      <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color: tone, fontSize: '16px', fontWeight: 900, marginTop: '4px' }}>{value}</div>
    </div>
  );
}

function MiningWorkspaceShell({ onNavigateHome, onCall, nhClient }) {
  return (
    <div
      className="app-shell mining-shell"
      style={{
        padding: '0 16px 32px',
        maxWidth: '1600px',
        margin: '0 auto',
        background: 'radial-gradient(circle at top left, rgba(56,189,248,0.16), transparent 32%), radial-gradient(circle at top right, rgba(16,185,129,0.14), transparent 28%), linear-gradient(180deg, rgba(2,6,23,0.95), rgba(15,23,42,0.96))',
        minHeight: '100vh',
      }}
    >
      <header style={{
        padding: '24px 0 16px',
        marginBottom: '16px',
        borderBottom: '1px solid rgba(148,163,184,0.10)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: '260px' }}>
          <div style={{ color: '#38bdf8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: '6px' }}>
            Mining Workspace
          </div>
          <h2 style={{ margin: 0, fontSize: '28px', lineHeight: 1.05, color: '#f8fafc' }}>
            HeroMiners + Mining-Dutch
          </h2>
          <p className="subtitle" style={{ margin: '6px 0 0', maxWidth: '760px', fontSize: '13px' }}>
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
        gap: '16px',
        alignItems: 'start',
      }}>
        <article style={{
          padding: '16px',
          background: 'rgba(15,23,42,0.72)',
          border: '1px solid rgba(148,163,184,0.12)',
          borderRadius: '16px',
          boxShadow: '0 18px 40px rgba(0,0,0,0.20)',
        }}>
          <HeroMinersCard onCall={onCall} />
        </article>

        <aside style={{
          padding: '16px',
          background: 'rgba(15,23,42,0.72)',
          border: '1px solid rgba(148,163,184,0.12)',
          borderRadius: '16px',
          boxShadow: '0 18px 40px rgba(0,0,0,0.20)',
        }}>
          <MiningCoin onCall={onCall} nhClient={nhClient} />
        </aside>
      </section>

      <section style={{ marginTop: '16px' }}>
        <TelegramManager onCall={onCall} mrrClient="VN" />
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
