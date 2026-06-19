import React, { useState, useEffect, useCallback } from "react";
import Modal from "./Modal";

/**
 * MonitorDbEditor Component
 * Allows viewing and editing the internal SQLite monitoring database.
 */
export default function MonitorDbEditor({ onCall, isOpen, onClose }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const res = await onCall("/api/v2/mrr/monitor/snapshot");
      if (res && res.success) {
        setData(res.data || []);
      }
    } catch (err) {
      console.error("[db-editor] Failed to fetch snapshot:", err);
    } finally {
      setLoading(false);
    }
  }, [onCall]);

  useEffect(() => {
    if (isOpen) fetchSnapshot();
  }, [isOpen, fetchSnapshot]);

  const handleDelete = async (id) => {
    if (
      !window.confirm(
        `Are you sure you want to remove rental #${id} from the monitor?`,
      )
    )
      return;
    try {
      const res = await onCall(`/api/v2/mrr/monitor/snapshot/${id}`, {
        method: "DELETE",
      });
      if (res.success) fetchSnapshot();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditForm(row);
  };

  const handleResetAlerts = async (id) => {
    try {
      const res = await onCall(`/api/v2/mrr/monitor/snapshot/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          low_hashrate_start: 0,
          zero_hashrate_start: 0,
          last_notified: 0,
        }),
        headers: { "Content-Type": "application/json" },
      });
      if (res.success) fetchSnapshot();
    } catch (err) {
      alert("Reset failed: " + err.message);
    }
  };

  const handleUpdate = async () => {
    try {
      const res = await onCall(`/api/v2/mrr/monitor/snapshot/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
        headers: { "Content-Type": "application/json" },
      });
      if (res.success) {
        setEditingId(null);
        fetchSnapshot();
      }
    } catch (err) {
      alert("Update failed: " + err.message);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Monitoring Database Manager"
      maxWidth="1200px"
    >
      <div
        className="panel-body"
        style={{ padding: "1rem", overflowX: "auto", minHeight: "400px" }}
      >
        {loading && (
          <div style={{ textAlign: "center", opacity: 0.6 }}>
            Loading database...
          </div>
        )}
        {!loading && data.length === 0 && (
          <div style={{ textAlign: "center", opacity: 0.4, padding: "2rem" }}>
            No active monitoring records found.
          </div>
        )}

        {data.length > 0 && (
          <table
            className="select-dropdown-pro"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "11px",
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                  opacity: 0.6,
                }}
              >
                <th style={{ padding: "10px" }}>ID</th>
                <th style={{ padding: "10px" }}>Name</th>
                <th style={{ padding: "10px" }}>Account</th>
                <th style={{ padding: "10px" }}>Last Notified</th>
                <th style={{ padding: "10px" }}>Low Hash</th>
                <th style={{ padding: "10px" }}>Zero Hash</th>
                <th style={{ padding: "10px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr
                  key={row.id}
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    background:
                      editingId === row.id
                        ? "rgba(59, 130, 246, 0.05)"
                        : "transparent",
                  }}
                >
                  <td style={{ padding: "10px", fontFamily: "monospace" }}>
                    {row.id}
                  </td>
                  <td style={{ padding: "10px", fontWeight: "bold" }}>
                    {editingId === row.id ? (
                      <input
                        className="input-pro"
                        value={editForm.name}
                        onChange={(e) =>
                          setEditForm({ ...editForm, name: e.target.value })
                        }
                      />
                    ) : (
                      row.name
                    )}
                  </td>
                  <td style={{ padding: "10px" }}>{row.client}</td>
                  <td style={{ padding: "10px" }}>
                    {editingId === row.id ? (
                      <input
                        type="number"
                        className="input-pro"
                        value={editForm.last_notified}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            last_notified: Number(e.target.value),
                          })
                        }
                        title="Epoch MS"
                      />
                    ) : row.last_notified > 0 ? (
                      new Date(row.last_notified).toLocaleTimeString()
                    ) : (
                      "Never"
                    )}
                  </td>
                  <td style={{ padding: "10px" }}>
                    <span
                      style={{
                        color:
                          row.low_hashrate_start > 0 ? "#f87171" : "inherit",
                      }}
                    >
                      {row.low_hashrate_start > 0 ? "⚠️ Active" : "OK"}
                    </span>
                  </td>
                  <td style={{ padding: "10px" }}>
                    <span
                      style={{
                        color:
                          row.zero_hashrate_start > 0 ? "#f87171" : "inherit",
                      }}
                    >
                      {row.zero_hashrate_start > 0 ? "🚫 Zero" : "OK"}
                    </span>
                  </td>
                  <td style={{ padding: "10px" }}>
                    <div style={{ display: "flex", gap: "8px" }}>
                      {editingId === row.id ? (
                        <>
                          <button
                            className="btn-pro secondary"
                            style={{ color: "#34d399" }}
                            onClick={handleUpdate}
                          >
                            Save
                          </button>
                          <button
                            className="btn-pro secondary"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn-pro secondary"
                            onClick={() => startEdit(row)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-pro secondary"
                            style={{ color: "#fbbf24" }}
                            onClick={() => handleResetAlerts(row.id)}
                            title="Reset alert timers"
                          >
                            Reset
                          </button>
                          <button
                            className="btn-pro secondary"
                            style={{ color: "#f87171" }}
                            onClick={() => handleDelete(row.id)}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
