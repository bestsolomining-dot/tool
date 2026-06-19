import React, { useState, useEffect } from "react";
import Modal from "./Modal";
import CryptoRatePage from "./CryptoRatePage";

import { fetchMiningStats } from "./miningStatsFetcher";

/**
 * MrrPoolManager Component
 *
 * A popup modal used to manage stratum pools for Mining Rig Rentals (MRR).
 * Handles both external data passed from App.jsx or fetching by rentalIds.
 */
export default function MrrPoolManager({
  onCall,
  mrrClient,
  externalPoolData,
  externalRigId,
  externalRentalId,
  rentalIds,
  onClose,
}) {
  const [rigs, setRigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [heroMinersStats, setHeroMinersStats] = useState(null); // New state for HeroMiners statistics
  const [activeRigId, setActiveRigId] = useState(null);
  const [draggedItemIndex, setDraggedItemIndex] = useState(null);

  /** Helper to merge new rig data into existing state to preserve metadata */
  const updateRigsState = (newData) => {
    setRigs((prev) => {
      const incoming = Array.isArray(newData) ? newData : [newData];
      const existingMap = new Map(
        prev.map((r) => [String(r.rigid || r.id), r]),
      );

      incoming.forEach((item) => {
        if (!item) return;
        const id = String(item.rigid || item.id);
        if (existingMap.has(id)) {
          // Merge: new data overwrites, existing data is preserved if not in update
          existingMap.set(id, { ...existingMap.get(id), ...item });
        } else {
          existingMap.set(id, item);
        }
      });

      return Array.from(existingMap.values());
    });
  };

  // Synchronize activeRigId with external selection or pick the first available
  useEffect(() => {
    if (externalRigId) {
      setActiveRigId(externalRigId);
    } else if (
      rigs.length > 0 &&
      (!activeRigId ||
        !rigs.some((r) => String(r.rigid || r.id) === String(activeRigId)))
    ) {
      setActiveRigId(rigs[0].rigid || rigs[0].id);
    }
  }, [rigs, activeRigId, externalRigId]);

  const fetchPools = async (ids = null) => {
    const targetIds =
      ids ||
      externalRigId ||
      (Array.isArray(rentalIds) ? rentalIds.join(";") : rentalIds);
    setLoading(true);
    setError(null);
    try {
      // If we are fetching for a specific rig, use the rig endpoint.
      // Otherwise, use the account-level pool profile endpoint.
      const isSingleRig =
        targetIds && !Array.isArray(rentalIds) && !targetIds.includes(";");
      const path = isSingleRig
        ? `/api/v2/mrr/rig/${encodeURIComponent(targetIds)}/pool`
        : `/api/v2/mrr/account/pool/${targetIds ? encodeURIComponent(targetIds) : ""}`;

      const query = { client: mrrClient };

      const response = await onCall(path, {
        method: "GET",
        query,
        silent: true,
      });
      if (response?.success) {
        const rawData = Array.isArray(response.data)
          ? response.data
          : [response.data];
        // Normalize flat pool configurations (profiles) to the rig/pools structure used by the UI
        const normalized = rawData.map((item) => {
          // A Profile specifically has host/port info and lacks rig-specific 'status'
          const isActualProfile = item && !item.pools && item.host && item.port;
          if (isActualProfile) {
            return {
              ...item,
              rigid: item.rigid || item.id,
              pools: [item],
              isProfile: true,
            };
          }
          return item;
        });
        updateRigsState(normalized);
      } else {
        setError(response?.message || "API responded with failure");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRigs = async () => {
    setLoading(true);
    setError(null);
    try {
      // Refactored to use the new general rig listing endpoint
      const response = await onCall("/api/v2/mrr/rig", {
        method: "GET",
        query: { client: mrrClient },
        silent: true,
      });
      if (response?.success) {
        updateRigsState(Array.isArray(response.data) ? response.data : []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Clear current rigs when switching client context to ensure clean state
    setRigs([]);
    setActiveRigId(null);
  }, [mrrClient]);

  useEffect(() => {
    if (externalPoolData) {
      const rawData = Array.isArray(externalPoolData.data)
        ? externalPoolData.data
        : [externalPoolData.data || externalPoolData];
      // Normalize external data if it's a flat pool list
      const normalized = rawData.map((item) => {
        if (item && !item.pools && (item.host || item.name)) {
          return {
            ...item,
            rigid: item.rigid || item.id,
            pools: [item],
            isProfile: true,
          };
        }
        return item;
      });
      const validData = normalized.filter((r) => r && (r.rigid || r.pools));
      if (validData.length > 0) updateRigsState(validData);
    } else {
      externalRigId || rentalIds ? fetchPools() : fetchRigs();
    }
  }, [rentalIds, externalPoolData, externalRigId, onCall, mrrClient]);

  const updateRigConfig = async (rigId, config) => {
    setLoading(true);
    try {
      const rig = rigs.find((r) => String(r.rigid || r.id) === String(rigId));
      const response = await onCall(`/api/v2/mrr/rig/${rigId}`, {
        method: "PUT",
        body: { ...config, name: rig?.name },
        query: { client: mrrClient },
        showModal: true,
      });
      if (response?.success) {
        externalRigId || rentalIds ? fetchPools() : fetchRigs();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updatePools = async (rig, pools) => {
    setLoading(true);
    try {
      const rigId = rig.rigid || rig.id;
      const endpoint = rig.isProfile
        ? `/api/v2/mrr/account/pool/${rigId}`
        : `/api/v2/mrr/rig/${rigId}/pool`;
      // For account profiles, send the pool object directly. For rigs, send the wrapped pools array.
      const body = rig.isProfile ? pools[0] || {} : { pools };

      const response = await onCall(endpoint, {
        method: "PUT",
        body,
        query: { client: mrrClient },
        showModal: true,
      });
      if (response?.success) {
        fetchPools();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runWebSocketFetch = async (type, rig) => {
    setLoading(true);
    setError(null);

    // Resolve the specific sub-account client (BT/SL/PH) from rig metadata if the global context is 'VN' (aggregate).
    // This ensures we use valid API credentials for the account owning the rig when fetching pool configurations.
    const targetClient =
      mrrClient === "VN" && rig.mrrClient ? rig.mrrClient : mrrClient;

    try {
      const data = await fetchMiningStats(
        type,
        targetClient,
        rig.rigid || rig.id,
      );
      if (data.pools) {
        // "Paste" the fetched pools directly into the rig's live configuration
        await updatePools(rig, data.pools);
      }
      // Handle global stats if returned
      if (data.herominers) {
        setHeroMinersStats(data.herominers);
      } else if (data.stats) {
        setHeroMinersStats(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedItemIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e, index, rig) => {
    e.preventDefault();
    if (draggedItemIndex === null || draggedItemIndex === index) return;
    const updatedPools = [...rig.pools];
    const [movedItem] = updatedPools.splice(draggedItemIndex, 1);
    updatedPools.splice(index, 0, movedItem);
    const prioritized = updatedPools.map((p, i) => ({ ...p, priority: i }));
    await updatePools(rig, prioritized);
    setDraggedItemIndex(null);
  };

  const handlePriorityChange = async (rig, poolIndex, newPriority) => {
    const updatedPools = [...rig.pools];
    updatedPools[poolIndex] = {
      ...updatedPools[poolIndex],
      priority: parseInt(newPriority, 10) || 0,
    };
    await updatePools(rig, updatedPools);
  };

  const content = (
    <div className="mrr-pool-manager-inner">
      <div
        className="panel-header"
        style={{
          marginBottom: "10px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
          <h3
            style={{
              margin: 0,
              fontSize: "1.25rem",
              whiteSpace: "nowrap",
              padding: "10px",
            }}
          >
            Pool Configuration
          </h3>
          {rigs.length > 1 && (
            <select
              className="select-pro"
              style={{
                minWidth: "150px",
                fontSize: "12px",
                padding: "2px 8px",
                height: "32px",
              }}
              value={activeRigId || ""}
              onChange={(e) => setActiveRigId(e.target.value)}
            >
              {rigs.map((r) => (
                <option key={r.rigid || r.id} value={r.rigid || r.id}>
                  {r.name || (r.isProfile ? "Pool" : "Rig")} (ID:{" "}
                  {r.rigid || r.id})
                </option>
              ))}
            </select>
          )}
        </div>
        {onClose && (
          <button className="close-button" onClick={onClose}>
            &times;
          </button>
        )}
      </div>
      <div className="panel-body" style={{ padding: "5px 0" }}>
        {loading && (
          <div style={{ textAlign: "center", opacity: 0.6, padding: "1rem" }}>
            Loading rig pool data...
          </div>
        )}
        {!loading && !error && rigs.length === 0 && (
          <div
            style={{
              opacity: 0.4,
              fontSize: "12px",
              textAlign: "center",
              padding: "20px",
            }}
          >
            No rig selected. Click "Pools" on a rig to manage.
          </div>
        )}
        {error && (
          <div
            style={{
              color: "#f87171",
              padding: "0.5rem",
              textAlign: "center",
              fontSize: "12px",
            }}
          >
            {error}
          </div>
        )}

        {!loading &&
          !error &&
          rigs
            .filter(
              (r) =>
                !activeRigId || String(r.rigid || r.id) === String(activeRigId),
            )
            .map((rig) => (
              <div
                key={rig.rigid}
                style={{
                  marginBottom: "2rem",
                  background: "rgba(255,255,255,0.02)",
                  padding: "1rem",
                  borderRadius: "8px",
                }}
              >
                <div
                  style={{
                    marginBottom: "1rem",
                    borderBottom: "1px solid rgba(255,255,255,0.1)",
                    paddingBottom: "0.5rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1rem", color: "#60a5fa" }}>
                    {rig.name || (rig.isProfile ? "Pool Profile" : "Rig")} (ID:{" "}
                    {rig.rigid || rig.id})
                  </h3>
                  {!rig.isProfile && (
                    <div
                      style={{
                        display: "flex",
                        gap: "10px",
                        alignItems: "center",
                      }}
                    >
                      <button
                        className="btn-pro secondary"
                        style={{
                          fontSize: "10px",
                          color: "#60a5fa",
                          fontWeight: "bold",
                        }}
                        onClick={() => runWebSocketFetch("all", rig)}
                      >
                        Fetch All
                      </button>
                      <button
                        className="btn-pro secondary"
                        style={{ fontSize: "10px", color: "#fbbf24" }}
                        onClick={() => runWebSocketFetch("herominers", rig)}
                      >
                        HM Stats
                      </button>
                      <button
                        className="btn-pro secondary"
                        style={{ fontSize: "10px", color: "#34d399" }}
                        onClick={() => runWebSocketFetch("herominers", rig)}
                      >
                        HM Global
                      </button>
                      <button
                        className="btn-pro secondary"
                        style={{ fontSize: "10px", color: "#fbbf24" }}
                        onClick={() =>
                          runWebSocketFetch("miningpooldutch", rig)
                        }
                      >
                        Fetch MiningPoolDutch
                      </button>
                      <div
                        style={{
                          width: "1px",
                          height: "16px",
                          background: "rgba(255,255,255,0.1)",
                          margin: "0 5px",
                        }}
                      ></div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        <label style={{ fontSize: "10px", opacity: 0.6 }}>
                          Price:
                        </label>
                        <input
                          type="number"
                          className="input-pro"
                          style={{
                            width: "100px",
                            height: "24px",
                            fontSize: "11px",
                          }}
                          defaultValue={rig.price || rig.min_price}
                          onBlur={(e) =>
                            updateRigConfig(rig.rigid || rig.id, {
                              price: e.target.value,
                            })
                          }
                        />
                      </div>
                      <button
                        className="btn-pro secondary"
                        style={{
                          color:
                            rig.status === "disabled" ? "#10b981" : "#f87171",
                          fontSize: "11px",
                        }}
                        onClick={() =>
                          updateRigConfig(rig.rigid || rig.id, {
                            status:
                              rig.status === "disabled"
                                ? "available"
                                : "disabled",
                          })
                        }
                      >
                        {rig.status === "disabled"
                          ? "Enable Rig"
                          : "Disable Rig"}
                      </button>
                    </div>
                  )}
                </div>

                <div
                  className="pool-list"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  {rig.pools?.map((pool, idx) => (
                    <div
                      key={idx}
                      className="pool-item"
                      draggable
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, idx, rig)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "24px 45px 1.2fr 1.5fr 1fr 60px",
                        gap: "12px",
                        alignItems: "center",
                        fontSize: "11px",
                        background: "rgba(255,255,255,0.02)",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        cursor: "grab",
                        border: "1px solid rgba(255,255,255,0.03)",
                        marginBottom: "2px",
                      }}
                    >
                      <div
                        style={{
                          opacity: 0.2,
                          cursor: "grab",
                          fontSize: "14px",
                        }}
                      >
                        ⋮⋮
                      </div>
                      <input
                        type="number"
                        className="input-pro"
                        style={{
                          width: "100%",
                          height: "26px",
                          padding: "2px",
                          fontSize: "10px",
                          textAlign: "center",
                          background: "rgba(0,0,0,0.2)",
                        }}
                        value={pool.priority}
                        onChange={(e) =>
                          handlePriorityChange(rig, idx, e.target.value)
                        }
                      />
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            fontWeight: "600",
                            color: "#f8fafc",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {pool.name || "Unnamed Pool"}
                          {pool.nhPoolName && (
                            <span
                              style={{
                                color: "#10b981",
                                marginLeft: "6px",
                                fontSize: "9px",
                                fontWeight: "normal",
                              }}
                            >
                              ({pool.nhPoolName})
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: "9px",
                            textTransform: "uppercase",
                            color: "#60a5fa",
                            opacity: 0.8,
                            letterSpacing: "0.02em",
                          }}
                        >
                          {pool.type || "N/A"}
                        </div>
                      </div>

                      <div
                        style={{
                          opacity: 0.7,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: "monospace",
                          fontSize: "10px",
                        }}
                      >
                        <span style={{ opacity: 0.4 }}>host:</span> {pool.host}:
                        {pool.port}
                      </div>
                      <div
                        style={{
                          opacity: 0.7,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: "monospace",
                          fontSize: "10px",
                        }}
                      >
                        <span style={{ opacity: 0.4 }}>user:</span> {pool.user}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

        {/* HeroMiners Statistics Display */}
        {heroMinersStats && (
          <div
            style={{
              marginTop: "2rem",
              background: "rgba(255,255,255,0.02)",
              padding: "1rem",
              borderRadius: "8px",
            }}
          >
            <h3
              style={{
                margin: "0 0 1rem 0",
                fontSize: "1rem",
                color: "#60a5fa",
              }}
            >
              HeroMiners Statistics
            </h3>

            {heroMinersStats.globalHashrates && (
              <div
                style={{
                  marginBottom: "1rem",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                  paddingBottom: "0.5rem",
                }}
              >
                <h4
                  style={{
                    margin: "0 0 0.5rem 0",
                    fontSize: "0.9rem",
                    color: "#fbbf24",
                  }}
                >
                  Global Hashrates
                </h4>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "10px",
                    fontSize: "11px",
                  }}
                >
                  {Object.entries(heroMinersStats.globalHashrates).map(
                    ([algo, rate]) => (
                      <div
                        key={algo}
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: "5px 8px",
                          borderRadius: "4px",
                        }}
                      >
                        <span style={{ opacity: 0.7 }}>{algo}:</span>{" "}
                        <strong style={{ color: "#f8fafc" }}>{rate}</strong>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}

            {heroMinersStats.coinStats &&
              heroMinersStats.coinStats.length > 0 && (
                <div
                  style={{
                    maxHeight: "400px",
                    overflowY: "auto",
                    scrollbarWidth: "thin",
                    scrollbarColor: "rgba(255,255,255,0.15) transparent",
                  }}
                >
                  <table
                    className="pro-table"
                    style={{ width: "100%", borderCollapse: "collapse" }}
                  >
                    <thead>
                      <tr
                        style={{
                          fontSize: "10px",
                          opacity: 0.7,
                          textTransform: "uppercase",
                        }}
                      >
                        <th style={{ padding: "8px", textAlign: "left" }}>
                          Coin
                        </th>
                        <th style={{ padding: "8px", textAlign: "left" }}>
                          Algo
                        </th>
                        <th style={{ padding: "8px", textAlign: "right" }}>
                          Net Hash
                        </th>
                        <th style={{ padding: "8px", textAlign: "right" }}>
                          Pool Hash
                        </th>
                        <th style={{ padding: "8px", textAlign: "right" }}>
                          Height
                        </th>
                        <th style={{ padding: "8px", textAlign: "right" }}>
                          Blocks
                        </th>
                        <th style={{ padding: "8px", textAlign: "right" }}>
                          Miners
                        </th>
                        <th style={{ padding: "8px", textAlign: "right" }}>
                          Workers
                        </th>
                        <th style={{ padding: "8px", textAlign: "right" }}>
                          USD/day
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {heroMinersStats.coinStats.map((coin, idx) => (
                        <tr
                          key={idx}
                          style={{
                            fontSize: "11px",
                            borderBottom: "1px solid rgba(255,255,255,0.03)",
                          }}
                        >
                          <td
                            style={{
                              padding: "8px",
                              fontWeight: "bold",
                              color: "#f8fafc",
                            }}
                          >
                            {coin.coin}
                          </td>
                          <td style={{ padding: "8px", color: "#60a5fa" }}>
                            {coin.algorithm}
                          </td>
                          <td
                            style={{
                              padding: "8px",
                              textAlign: "right",
                              fontFamily: "monospace",
                            }}
                          >
                            {coin.networkHashrate}
                          </td>
                          <td
                            style={{
                              padding: "8px",
                              textAlign: "right",
                              fontFamily: "monospace",
                            }}
                          >
                            {coin.poolHashrate}
                          </td>
                          <td style={{ padding: "8px", textAlign: "right" }}>
                            {coin.blockHeight}
                          </td>
                          <td style={{ padding: "8px", textAlign: "right" }}>
                            {coin.blocksFound}
                          </td>
                          <td style={{ padding: "8px", textAlign: "right" }}>
                            {coin.miners}
                          </td>
                          <td style={{ padding: "8px", textAlign: "right" }}>
                            {coin.workers}
                          </td>
                          <td
                            style={{
                              padding: "8px",
                              textAlign: "right",
                              color: "#10b981",
                              fontWeight: "bold",
                            }}
                          >
                            {coin.usdPerDay}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            {!heroMinersStats.globalHashrates && !heroMinersStats.coinStats && (
              <div
                style={{
                  opacity: 0.5,
                  fontSize: "12px",
                  textAlign: "center",
                  padding: "10px",
                }}
              >
                No HeroMiners statistics available.
              </div>
            )}
          </div>
        )}
      </div>
      <CryptoRatePage onCall={onCall} />
    </div>
  );

  if (onClose && (rentalIds || externalPoolData || externalRigId)) {
    return (
      <Modal
        isOpen={true}
        onClose={onClose}
        title="Pool Configuration"
        maxWidth="1000px"
      >
        {content}
      </Modal>
    );
  }

  return content;
}
