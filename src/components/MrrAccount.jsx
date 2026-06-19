import React, { useState, useEffect, useCallback } from "react";

/**
 * UI component for Mining Rig Rentals account actions.
 * Provides a client selector and the Balance check functionality.
 */
export default function MrrAccount({ onCall }) {
  const [mrrClient, setMrrClient] = useState("VN");
  const [mrrBalance, setMrrBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const availableClients = ["BT", "SL", "LN", "LUCKY", "VN"];

  const fetchBalance = useCallback(
    async (isSilent = true) => {
      if (!mrrClient || mrrClient === "VN") {
        setMrrBalance(null);
        return;
      }
      setLoading(true);
      try {
        const result = await onCall("/api/v2/mrr/balance", {
          query: { client: mrrClient },
          silent: isSilent,
        });
        if (result?.success) {
          setMrrBalance(result.data);
        }
      } finally {
        setLoading(false);
      }
    },
    [mrrClient, onCall],
  );

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
        <div
          className="field-row"
          style={{ display: "flex", gap: "1rem", alignItems: "flex-end" }}
        >
          <div className="field" style={{ flex: 1 }}>
            <label className="label">MRR Sub-Account Client</label>
            <select
              className="select-pro"
              value={mrrClient}
              onChange={(e) => setMrrClient(e.target.value)}
            >
              {availableClients.map((client) => (
                <option key={client} value={client}>
                  {client}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn-pro secondary"
            disabled={loading}
            onClick={async () => {
              const result = await onCall("/api/v2/mrr/balance", {
                query: { client: mrrClient },
                showModal: true,
              });
              if (result?.success) {
                setMrrBalance(result.data);
              }
            }}
          >
            {loading && !mrrBalance ? "..." : "Refresh Balance"}
          </button>
        </div>

        {mrrBalance && (
          <div
            className="balance-summary-pro"
            style={{
              marginTop: "15px",
              padding: "15px",
              background: "rgba(255,255,255,0.03)",
              borderRadius: "8px",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: "15px",
              }}
            >
              <div>
                <small
                  style={{
                    opacity: 0.6,
                    display: "block",
                    fontSize: "10px",
                    textTransform: "uppercase",
                  }}
                >
                  Available
                </small>
                <strong style={{ fontSize: "16px", color: "#10b981" }}>
                  {mrrBalance.confirmed} BTC
                </strong>
              </div>
              <div>
                <small
                  style={{
                    opacity: 0.6,
                    display: "block",
                    fontSize: "10px",
                    textTransform: "uppercase",
                  }}
                >
                  Pending
                </small>
                <strong style={{ fontSize: "16px", color: "#f59e0b" }}>
                  {mrrBalance.pending} BTC
                </strong>
              </div>
              <div>
                <small
                  style={{
                    opacity: 0.6,
                    display: "block",
                    fontSize: "10px",
                    textTransform: "uppercase",
                  }}
                >
                  Total Balance
                </small>
                <strong style={{ fontSize: "16px" }}>
                  {mrrBalance.btc} BTC
                </strong>
              </div>
            </div>
          </div>
        )}

        <p
          className="help-text"
          style={{ marginTop: "0.75rem", opacity: 0.6, fontSize: "0.8rem" }}
        >
          Queries the Mining Rig Rentals API for current BTC and
          algorithm-specific balances for the selected client.
        </p>
      </div>
    </div>
  );
}
