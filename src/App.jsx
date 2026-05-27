import Pools from './components/Pools';
import './App.css';

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <h1>NiceHash Pool Manager</h1>
          <p className="subtitle">
            Stratum pool verification and monitoring for mining operations.
          </p>
        </div>
      </header>

      <main className="dashboard">
        <section className="pools-section">
          <Pools />
        </section>
      </main>
    </div>
  );
}
