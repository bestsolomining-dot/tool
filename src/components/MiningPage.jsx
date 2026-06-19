import HeroMinersCard from './HeroMinersCard';
import MiningCoin from './MiningCoin.jsx';
import { RentedRigProvider } from './RentedRigContext.jsx';

export default function MiningPage({ onCall, nhClient = 'BT', onNavigateHome }) {
  return (
    <RentedRigProvider callApi={onCall}>
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
          marginBottom: '24px',
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
              Dedicated profitability routing view for mining pools and algorithm matching.
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
    </RentedRigProvider>
  );
}
