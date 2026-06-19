import Pools from "./Pools";
import Modal from "./Modal";
import NiceHash from "./NiceHash";
import MiningRigSection from "./MiningRigSection";
import { NiceHashOrderProvider } from "./NiceHashContext.jsx";
import HashrateCalculator from "./HashrateCalculator";

export default function Dashboard({
  state,
  dispatch,
  callApi,
  handleLogout,
  forceCheckStatus,
  handleMiningCall,
  handleOpenMrrPools,
  setNhOrderClient,
  setNhPoolClient,
  setMrrClient,
}) {
  return (
    <div
      className="app-shell"
      style={{ padding: "0 20px 40px", maxWidth: "1600px", margin: "0 auto" }}
    >
      {/* HEADER */}
      <header
        className="app-header"
        style={{
          padding: "40px 0",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          marginBottom: "30px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <div className="brand-block" style={{ flex: 1 }}>
          <div className="status-card" style={{ marginBottom: "2px" }}>
            <div className="status-item">
              <span style={{ opacity: 0.5, marginRight: "10px" }}>SYSTEM:</span>
              <span
                className={`status-value ${state.loading ? "status-ready" : state.error ? "status-error" : "status-success"}`}
              >
                {state.loading ? "Loading..." : state.error ? "Error" : "Ready"}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                gap: "8px",
                marginTop: "8px",
                flexWrap: "wrap",
              }}
            >
              <button
                className="btn-pro secondary"
                onClick={forceCheckStatus}
                style={{ fontSize: "10px" }}
              >
                Force Check
              </button>
              <button
                className="btn-pro secondary"
                onClick={() =>
                  dispatch({ type: "SET_DEBUG_MODAL", payload: true })
                }
                style={{ fontSize: "10px" }}
              >
                Debug Logs
              </button>
              <button
                className="btn-pro secondary"
                onClick={handleLogout}
                style={{ fontSize: "10px" }}
              >
                Logout
              </button>
              <button
                className="btn-pro secondary"
                onClick={() =>
                  dispatch({ type: "SET_CALCULATOR_MODAL", payload: true })
                }
                style={{ fontSize: "10px" }}
              >
                Calculator
              </button>
              <button
                className="btn-pro secondary"
                onClick={() => {
                  window.history.pushState({}, "", "/cryptorate");
                  dispatch({ type: "SET_VIEW", payload: "cryptorate" });
                }}
                style={{ fontSize: "10px" }}
              >
                Live Rates
              </button>
              <button
                className="btn-pro secondary"
                onClick={() => {
                  window.history.pushState({}, "", "/mining");
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }}
                style={{ fontSize: "10px" }}
              >
                Mining
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* POOLS SECTION */}
      <section
        className="pools-section"
        style={{
          marginBottom: "15px",
          marginTop: "0px",
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          borderRadius: "16px",
          padding: "24px",
          height: "850px",
          minHeight: "200px",
          overflow: "auto",
        }}
      >
        <Pools
          onCall={callApi}
          poolData={state.poolData}
          niceHashData={state.niceHashData}
          mrrClient={state.mrrClient}
          setMrrClient={setMrrClient}
          nhClient={state.nhPoolClient}
          setNhClient={setNhPoolClient}
        />
      </section>

      {/* MAIN DASHBOARD */}
      <main className="dashboard">
        <div
          className="column-stack"
          style={{ display: "flex", flexDirection: "column", gap: "24px" }}
        >
          <NiceHashOrderProvider
            nhClient={state.nhOrderClient}
            callApi={callApi}
          >
            {/* NICEHASH SECTION */}
            <article className="panel">
              <NiceHash
                key={state.nhOrderClient}
                onCall={handleMiningCall}
                output={state.niceHashData}
                algorithm={state.algorithm}
                market={state.market}
                nhClient={state.nhOrderClient}
                setNhClient={setNhOrderClient}
              />
            </article>

            {/* QUICK ACTIONS */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>Quick Actions</h3>
                <p
                  style={{
                    margin: "4px 0 0",
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                  }}
                >
                  Open the hashrate calculator or view live rates.
                </p>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  className="btn-pro secondary"
                  onClick={() =>
                    dispatch({ type: "SET_CALCULATOR_MODAL", payload: true })
                  }
                >
                  Open Calculator
                </button>
                <button
                  className="btn-pro secondary"
                  onClick={() => {
                    window.history.pushState({}, "", "/cryptorate");
                    dispatch({ type: "SET_VIEW", payload: "cryptorate" });
                  }}
                >
                  Live Rates
                </button>
              </div>
            </div>

            {/* MINING RIG SECTION */}
            <article className="panel">
              <MiningRigSection
                onCall={handleMiningCall}
                rigsData={state.rigsData}
                mrrClient={state.mrrClient}
                setMrrClient={setMrrClient}
                onOpenMrrPools={handleOpenMrrPools}
              />
            </article>
          </NiceHashOrderProvider>

          {/* HERO MINERS CARD */}
        </div>
      </main>

      {/* MODALS */}
      <Modal
        isOpen={state.responseModalOpen}
        onClose={() =>
          dispatch({
            type: "SET_MODAL",
            payload: { content: null, open: false },
          })
        }
        title="API Operation Result"
        maxWidth="800px"
      >
        {state.lastCall && (
          <div
            style={{
              marginBottom: "15px",
              opacity: 0.7,
              fontSize: "11px",
              fontFamily: "monospace",
            }}
          >
            {state.lastCall.method} {state.lastCall.path} —{" "}
            {state.lastCall.status} ({state.lastCall.durationMs}ms)
          </div>
        )}
        <pre
          className="response-body"
          style={{
            maxHeight: "50vh",
            overflow: "auto",
            background: "rgba(0,0,0,0.3)",
            padding: "12px",
            borderRadius: "6px",
          }}
        >
          {JSON.stringify(state.modalContent, null, 2)}
        </pre>
      </Modal>

      <Modal
        isOpen={state.debugModalOpen}
        onClose={() => dispatch({ type: "SET_DEBUG_MODAL", payload: false })}
        title="System Debug Logs"
        maxWidth="800px"
      >
        <div
          className="code-block-content"
          style={{
            maxHeight: "60vh",
            overflow: "auto",
            fontSize: "11px",
            fontFamily: "monospace",
          }}
        >
          {state.debugLogs.length === 0 && (
            <div style={{ opacity: 0.5 }}>No logs captured yet.</div>
          )}
          {state.debugLogs.map((log, i) => (
            <div
              key={i}
              style={{
                padding: "2px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              {log}
            </div>
          ))}
        </div>
        <div className="modal-actions" style={{ marginTop: "12px" }}>
          <button
            className="btn-pro secondary"
            onClick={() => dispatch({ type: "CLEAR_DEBUG_LOGS" })}
          >
            Clear Logs
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={state.calculatorModalOpen}
        onClose={() =>
          dispatch({ type: "SET_CALCULATOR_MODAL", payload: false })
        }
        title="Hashrate Calculator"
        maxWidth="600px"
      >
        <HashrateCalculator />
      </Modal>
    </div>
  );
}
