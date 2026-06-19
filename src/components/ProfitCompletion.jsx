import React, { useState, useMemo, useEffect } from "react";
import {
  getPriceData,
  getBtcPriceData,
  parsePriceValue,
} from "../core/priceUtils.js";
import { HASHRATE_SUFFIXES, getAlgorithmUnit } from "../core/mapping.js";

function resolveUnit(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value; // Already a numeric factor
  if (!value) return HASHRATE_SUFFIXES["TH"]; // Default to TH
  const normalized = String(value)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\/S$/, "");
  const matchedSuffix = Object.keys(HASHRATE_SUFFIXES).find((suffix) =>
    normalized.includes(suffix),
  );
  return matchedSuffix
    ? HASHRATE_SUFFIXES[matchedSuffix]
    : HASHRATE_SUFFIXES["TH"];
}

function normalizeToDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function parseHashrateValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? String(parsed) : "";
  }
  if (typeof value === "object") {
    return parseHashrateValue(
      value.hash ||
        value.advertised ||
        value.nice ||
        value.value ||
        Object.values(value)[0],
    );
  }
  return "";
}

export default function HashCompletionCalculator({
  initialAlgo = "",
  initialUnit = 1e12,
  initialAdsHashrate = "",
  initialAvgHashrate = "",
  initialStartTime = "",
  initialEndTime = "",
  initialPriceSource = null,
  initialBtcPriceSource = null,
  initialNhPriceData = null,
  initialPriceUnit = "TH",
}) {
  const [algo, setAlgo] = useState(initialAlgo);
  const [startTime, setStartTime] = useState(
    normalizeToDateTimeLocal(initialStartTime),
  );
  const [endTime, setEndTime] = useState(
    normalizeToDateTimeLocal(initialEndTime),
  );
  const [adsHashrate, setAdsHashrate] = useState(initialAdsHashrate);
  const [avgHashrate, setAvgHashrate] = useState(initialAvgHashrate);
  const [unit, setUnit] = useState(resolveUnit(initialUnit));
  const [nhPriceData, setNhPriceData] = useState(initialNhPriceData);

  const units = [
    { label: "EH/s", value: HASHRATE_SUFFIXES["EH"] },
    { label: "PH/s", value: HASHRATE_SUFFIXES["PH"] },
    { label: "TH/s", value: HASHRATE_SUFFIXES["TH"] },
    { label: "GH/s", value: HASHRATE_SUFFIXES["GH"] },
    { label: "MH/s", value: HASHRATE_SUFFIXES["MH"] },
    { label: "KH/s", value: HASHRATE_SUFFIXES["KH"] },
    { label: "H/s", value: HASHRATE_SUFFIXES["H"] },
  ];

  useEffect(() => {
    setAlgo(initialAlgo || "");
  }, [initialAlgo]);

  useEffect(() => {
    setUnit(resolveUnit(initialUnit));
  }, [initialUnit]);

  useEffect(() => {
    setStartTime(normalizeToDateTimeLocal(initialStartTime));
  }, [initialStartTime]);

  useEffect(() => {
    setEndTime(normalizeToDateTimeLocal(initialEndTime));
  }, [initialEndTime]);

  useEffect(() => {
    setAdsHashrate(initialAdsHashrate || "");
  }, [initialAdsHashrate]);

  useEffect(() => {
    setAvgHashrate(initialAvgHashrate || "");
  }, [initialAvgHashrate]);

  useEffect(() => {
    setNhPriceData(initialNhPriceData);
  }, [initialNhPriceData]);

  const results = useMemo(() => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const now = new Date();
    const adsValue = parseFloat(adsHashrate);
    const avgValue = parseFloat(avgHashrate);

    if (
      isNaN(start.getTime()) ||
      isNaN(end.getTime()) ||
      isNaN(adsValue) ||
      adsValue <= 0
    ) {
      return null;
    }

    const totalDurationMs = end - start;
    if (totalDurationMs <= 0)
      return { error: "End time must be after start time." };

    const elapsedMs = Math.max(0, Math.min(now - start, totalDurationMs));
    const remainingMs = Math.max(0, totalDurationMs - elapsedMs);

    const ads = adsValue * unit;
    const avg = (isNaN(avgValue) ? 0 : avgValue) * unit;

    const totalExpectedHashes = ads * (totalDurationMs / 1000);
    const actualHashesDone = avg * (elapsedMs / 1000);
    const remainingHashesNeeded = Math.max(
      0,
      totalExpectedHashes - actualHashesDone,
    );

    const priceData = getPriceData(initialPriceSource);
    const btcPriceData = getBtcPriceData(
      initialBtcPriceSource || initialPriceSource,
    );
    const adsValueTh = adsValue * (unit / 1e12);
    const durationDays = totalDurationMs / 86400000;

    const btcPriceUnitFactor = resolveUnit(
      btcPriceData.unit || initialPriceUnit || "TH",
    );
    const btcPerThPerDay = btcPriceData.isPerHashRate
      ? btcPriceData.value * (1e12 / btcPriceUnitFactor)
      : 0;

    const totalBtcCost = btcPriceData.isTotalCost
      ? btcPriceData.value
      : btcPriceData.isPerHashRate && adsValueTh > 0 && durationDays > 0
        ? btcPerThPerDay * adsValueTh * durationDays
        : 0;
    const rentalBtcPerThPerDay = btcPriceData.isPerHashRate
      ? btcPerThPerDay
      : adsValueTh > 0 && durationDays > 0
        ? totalBtcCost / (adsValueTh * durationDays)
        : 0;
    const rentalBtcPerHash =
      totalExpectedHashes > 0 ? totalBtcCost / totalExpectedHashes : 0;

    const currentOverallCompletion =
      totalExpectedHashes > 0
        ? (actualHashesDone / totalExpectedHashes) * 100
        : 0;
    const timeProgress = (elapsedMs / totalDurationMs) * 100;

    // NiceHash Comparison logic
    const nhMarketInfo = (() => {
      const raw = nhPriceData?.price || nhPriceData || {};
      const val =
        raw.fixedPrice ??
        raw.standardPrice?.fast ??
        raw.standardPrice ??
        raw.price ??
        0;
      const rate = typeof val === "string" ? parseFloat(val) : val;
      const unitStr = (raw.speedUnit || raw.unit || "TH").toUpperCase();

      // Normalize BTC/Unit/Day to BTC/TH/Day for consistent math
      const normalizationMap = {
        EH: 1e6,
        PH: 1000,
        TH: 1,
        GH: 0.001,
        MH: 0.000001,
      };
      const factor = normalizationMap[unitStr] || 1;

      return { rate: rate / factor, displayRate: rate, unit: unitStr };
    })();

    const nhMarketRate = nhMarketInfo.rate;
    const nhEstimatedCost = nhMarketRate * adsValueTh * durationDays;
    const savingsBtc = nhEstimatedCost > 0 ? nhEstimatedCost - totalBtcCost : 0;
    const savingsPercent =
      nhEstimatedCost > 0 && totalBtcCost > 0
        ? (savingsBtc / nhEstimatedCost) * 100
        : 0;

    const remainingSeconds = remainingMs / 1000;
    const requiredHashrateRaw =
      remainingSeconds > 0 ? remainingHashesNeeded / remainingSeconds : 0;
    const requiredHashrateFormatted =
      (requiredHashrateRaw > 0 ? requiredHashrateRaw : 0) / unit;

    return {
      durationHrs: (totalDurationMs / 3600000).toFixed(2),
      elapsedHrs: (elapsedMs / 3600000).toFixed(2),
      remainingHrs: (remainingMs / 3600000).toFixed(2),
      totalExpectedHashes,
      actualHashesDone,
      remainingHashesNeeded,
      currentOverallCompletion: currentOverallCompletion.toFixed(2),
      timeProgress: timeProgress.toFixed(2),
      requiredHashrateFormatted: requiredHashrateFormatted.toFixed(2),
      rentalPriceData: priceData,
      rentalBtcCost: totalBtcCost,
      rentalBtcPerThPerDay,
      rentalBtcPerHash,
      nhMarketRate,
      nhMarketInfo,
      nhEstimatedCost,
      savingsBtc,
      savingsPercent,
      priceUnit: initialPriceUnit || "TH",
      isBehind: currentOverallCompletion < timeProgress && elapsedMs > 0,
    };
  }, [
    startTime,
    endTime,
    adsHashrate,
    avgHashrate,
    unit,
    nhPriceData,
    initialPriceSource,
    initialBtcPriceSource,
    initialPriceUnit,
  ]);

  return (
    <div
      className="hash-completion-calculator nh-theme"
      style={{ padding: "15px" }}
    >
      <h2 className="section-title" style={{ marginBottom: "10px" }}>
        Rental Completion Calculator
      </h2>
      {algo && (
        <div
          style={{ marginBottom: "16px", color: "#94a3b8", fontSize: "13px" }}
        >
          Rented algorithm: <strong>{algo}</strong>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "15px",
          marginBottom: "20px",
        }}
      >
        <div className="field">
          <label className="label" style={{ fontSize: "10px" }}>
            START TIME (LOCAL)
          </label>
          <input
            type="datetime-local"
            className="input-pro"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" style={{ fontSize: "10px" }}>
            END TIME (LOCAL)
          </label>
          <input
            type="datetime-local"
            className="input-pro"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" style={{ fontSize: "10px" }}>
            ADS HASHRATE
          </label>
          <input
            type="number"
            className="input-pro"
            placeholder="e.g. 500"
            value={adsHashrate}
            onChange={(e) => setAdsHashrate(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" style={{ fontSize: "10px" }}>
            AVG HASHRATE
          </label>
          <input
            type="number"
            className="input-pro"
            placeholder="e.g. 450"
            value={avgHashrate}
            onChange={(e) => setAvgHashrate(e.target.value)}
          />
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label className="label" style={{ fontSize: "10px" }}>
            HASHRATE UNIT
          </label>
          <select
            className="select-pro"
            value={unit}
            onChange={(e) => setUnit(Number(e.target.value))}
          >
            {units.map((u) => (
              <option key={u.label} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {results && !results.error && (
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            padding: "20px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "15px",
            }}
          >
            <div className="stat-box">
              <div
                style={{
                  fontSize: "9px",
                  opacity: 0.5,
                  textTransform: "uppercase",
                }}
              >
                Total Duration
              </div>
              <div style={{ fontWeight: "bold", fontSize: "14px" }}>
                {results.durationHrs} Hours
              </div>
            </div>
            <div className="stat-box">
              <div
                style={{
                  fontSize: "9px",
                  opacity: 0.5,
                  textTransform: "uppercase",
                }}
              >
                Time Elapsed
              </div>
              <div
                style={{
                  fontWeight: "bold",
                  color: "#60a5fa",
                  fontSize: "14px",
                }}
              >
                {results.elapsedHrs}h ({results.timeProgress}%)
              </div>
            </div>
            <div className="stat-box">
              <div
                style={{
                  fontSize: "9px",
                  opacity: 0.5,
                  textTransform: "uppercase",
                }}
              >
                Total Hash Delivered
              </div>
              <div
                style={{
                  fontWeight: "bold",
                  color: results.isBehind ? "#f87171" : "#34d399",
                  fontSize: "14px",
                }}
              >
                {results.currentOverallCompletion}%
              </div>
            </div>
            <div
              className="stat-box"
              style={{
                background:
                  results.savingsBtc >= 0
                    ? "rgba(16, 185, 129, 0.1)"
                    : "rgba(239, 68, 68, 0.1)",
                padding: "10px",
                borderRadius: "6px",
                border: `1px solid ${results.savingsBtc >= 0 ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  color: results.savingsBtc >= 0 ? "#34d399" : "#f87171",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                }}
              >
                {results.savingsBtc >= 0 ? "Potential Savings" : "Cost Overage"}
              </div>
              <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
                {Math.abs(results.savingsPercent).toFixed(2)}%
              </div>
              <div style={{ fontSize: "9px", opacity: 0.7 }}>
                {results.savingsBtc >= 0
                  ? "Cheaper than NiceHash"
                  : "More expensive than NH"}
              </div>
            </div>
            <div
              className="stat-box"
              style={{
                background: "rgba(59, 130, 246, 0.1)",
                padding: "10px",
                borderRadius: "6px",
                border: "1px solid rgba(59, 130, 246, 0.2)",
                gridColumn: "span 2",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  color: "#60a5fa",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                }}
              >
                Target Required Hashrate
              </div>
              <div
                style={{
                  fontSize: "1.2rem",
                  fontWeight: "bold",
                  color: "#fff",
                }}
              >
                {results.requiredHashrateFormatted}{" "}
                <span style={{ fontSize: "0.8rem" }}>
                  {units.find((u) => u.value === unit).label}
                </span>
              </div>
              <div style={{ fontSize: "9px", opacity: 0.7 }}>
                Needed for remaining {results.remainingHrs}h to reach 100% total
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: "20px",
              fontSize: "11px",
              borderTop: "1px solid rgba(255,255,255,0.1)",
              paddingTop: "15px",
            }}
          >
            <h4
              style={{
                margin: "0 0 10px 0",
                fontSize: "10px",
                opacity: 0.5,
                textTransform: "uppercase",
              }}
            >
              NiceHash vs MRR Comparison
            </h4>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "5px",
              }}
            >
              <span style={{ opacity: 0.6 }}>NH Market Rate:</span>
              <span style={{ fontFamily: "monospace" }}>
                {results.nhMarketInfo.displayRate.toFixed(8)} BTC/
                {results.nhMarketInfo.unit}/day
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "12px",
              }}
            >
              <span style={{ opacity: 0.6 }}>NH Estimated Cost:</span>
              <span style={{ fontFamily: "monospace" }}>
                {results.nhEstimatedCost.toFixed(8)} BTC
              </span>
            </div>
            <h4
              style={{
                margin: "0 0 10px 0",
                fontSize: "10px",
                opacity: 0.5,
                textTransform: "uppercase",
              }}
            >
              Rental Cost Breakdown
            </h4>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "5px",
              }}
            >
              <span style={{ opacity: 0.6 }}>Hashes Delivered:</span>
              <span style={{ fontFamily: "monospace" }}>
                {(results.actualHashesDone / 1e12).toFixed(6)} T-Hashes
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "5px",
              }}
            >
              <span style={{ opacity: 0.6 }}>Total Expected Hashes:</span>
              <span style={{ fontFamily: "monospace" }}>
                {(results.totalExpectedHashes / 1e12).toFixed(6)} T-Hashes
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "5px",
              }}
            >
              <span style={{ opacity: 0.6 }}>Rental Price</span>
              <span style={{ fontFamily: "monospace" }}>
                {results.rentalPriceData.value.toFixed(8)}{" "}
                {results.rentalPriceData.currency}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "5px",
              }}
            >
              <span style={{ opacity: 0.6 }}>BTC Equivalent</span>
              <span style={{ fontFamily: "monospace" }}>
                {results.rentalBtcCost.toFixed(8)} BTC
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "5px",
              }}
            >
              <span style={{ opacity: 0.6 }}>Rental Rate</span>
              <span style={{ fontFamily: "monospace" }}>
                {results.rentalBtcPerThPerDay.toFixed(8)} BTC/
                {results.priceUnit}/day
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ opacity: 0.6 }}>Work Deficit:</span>
              <span style={{ color: "#f87171", fontFamily: "monospace" }}>
                {(results.remainingHashesNeeded / 1e12).toFixed(6)} T-Hashes
              </span>
            </div>
          </div>
        </div>
      )}

      {results?.error && (
        <div
          className="error-message"
          style={{ color: "#f87171", textAlign: "center", marginTop: "10px" }}
        >
          {results.error}
        </div>
      )}

      <div
        style={{
          marginTop: "20px",
          fontSize: "10px",
          opacity: 0.4,
          fontStyle: "italic",
          textAlign: "center",
        }}
      >
        Formula: Required = ( (Ads * TotalTime) - (Avg * Elapsed) ) /
        RemainingTime
      </div>
    </div>
  );
}
