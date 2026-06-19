import React from "react";

export default function NiceHashOrderCard({ order }) {
  return (
    <div
      className="rented-rig-card"
      style={{
        background: "rgba(92, 71, 4, 0.18)",
        border: "1px solid rgba(219, 131, 16, 0.26)",
        borderRadius: "12px",
        padding: "10px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        minWidth: "170px",
        maxHeight: "200px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{ fontSize: "10px", color: "#60a5fa", fontWeight: "bold" }}
        >
          {order.algo}
        </span>
        <span
          style={{ fontSize: "14px", fontWeight: "bold", color: "#60a5fa" }}
        >
          {order.account}
        </span>
      </div>
      <div style={{ marginTop: "-4px" }}>
        {/* <div style={{ fontSize: '0.7rem', opacity: 0.5 }}>Pool</div> */}
        <div
          style={{
            fontSize: "11px",
            color: "var(--muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {order.poolName}
        </div>
      </div>

      <div style={{ margin: "2px 0" }}>
        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Paid</div>
        <div
          style={{ fontSize: "0.6rem", fontWeight: "600", color: "#f3ba2f" }}
        >
          {order.paid} <small>BTC</small>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.8rem",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          paddingTop: "8px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>
            My Order Price
          </span>
          <span style={{ fontWeight: "bold" }}>
            {parseFloat(order.price).toFixed(8)}
          </span>
          {order.orderDiff && (
            <span
              style={{
                color: parseFloat(order.orderDiff) >= 0 ? "#10b981" : "#f87171",
                fontSize: "0.7rem",
              }}
            >
              ({parseFloat(order.orderDiff) > 0 ? "+" : ""}
              {order.orderDiff}%)
            </span>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
          }}
        >
          <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>Speed</span>
          <span style={{ fontWeight: "bold", color: "#10b981" }}>
            {parseFloat(order.speed || 0).toFixed(7)}
          </span>
        </div>
      </div>
    </div>
  );
}
