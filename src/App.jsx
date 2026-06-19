import { useCallback, useEffect, useMemo, useState } from "react";
import Pools from "./components/Pools";
import Modal from "./components/Modal";
import HashCompletionCalculator from "./components/HashCompletionCalculator";
import HashpowerBot from "./components/HashpowerBot";
import NiceHash from "./components/NiceHash";
import MiningRigRental from "./components/MiningRigRental";
import CryptoRatePage from "./components/CryptoRatePage";
import MiningPage from "./components/MiningPage.jsx";
import { createApiClient } from "./core/apiClient";
import "./App.css";

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [algorithm, setAlgorithm] = useState("");
  const [market, setMarket] = useState("");
  const [mrrClient, setMrrClient] = useState("BT");
  const [completionCalculatorContext, setCompletionCalculatorContext] =
    useState(null);
  const [, setRouteTick] = useState(0);

  const toDateTimeLocal = (value) => {
    if (!value) return "";
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return "";
    const offsetMs = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  };

  const parseHashrateValue = (value) => {
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
  };

  const inferUnitValue = (source) => {
    const unitMap = {
      EH: 1e18,
      PH: 1e15,
      TH: 1e12,
      GH: 1e9,
      MH: 1e6,
      KH: 1e3,
      H: 1,
    };
    if (source === undefined || source === null) return 1e12;
    if (typeof source === "number" && Number.isFinite(source)) return source;
    const normalized = String(source).toUpperCase().replace(/\s+/g, "");
    const match =
      normalized.match(/(EH|PH|TH|GH|MH|KH|H)(?:\/S)?$/) ||
      normalized.match(/(EH|PH|TH|GH|MH|KH|H)/);
    if (match && match[1]) return unitMap[match[1]] || 1e12;
    return 1e12;
  };

  const openCompletionCalculator = useCallback((rig, info = {}) => {
    const algo = info?.algo || rig?.algo || rig?.algorithm || rig?.type || "";
    const start = toDateTimeLocal(
      info?.startTime ||
        rig?.start ||
        (typeof rig?.status === "object" ? rig.status.start : "") ||
        "",
    );
    const end = toDateTimeLocal(
      info?.endTime ||
        rig?.end ||
        (typeof rig?.status === "object" ? rig.status.end : "") ||
        "",
    );
    const adsHashrate = parseHashrateValue(
      info?.advertised ||
        rig?.hashrate?.advertised ||
        rig?.advertised ||
        rig?.hashrate?.hash ||
        rig?.hash ||
        "",
    );
    const avgHashrate = parseHashrateValue(
      info?.average ||
        rig?.hashrate?.average ||
        rig?.average ||
        rig?.hash ||
        "",
    );
    const unit = inferUnitValue(
      info?.advertised ||
        info?.average ||
        rig?.hashrate?.advertised ||
        rig?.hashrate?.average ||
        rig?.hashrate?.suffix ||
        rig?.hashrate_unit ||
        rig?.hashrate?.type ||
        "",
    );
    const nhPriceData = info?.nicehashPrice || rig?.nicehashPrice;
    const rawPrice = info?.price || rig?.price || rig?.min_price || null;
    const priceSource =
      rawPrice?.paid !== undefined
        ? {
            paid: rawPrice.paid,
            currency: rawPrice.currency || rawPrice.price_unit || "BTC",
          }
        : rawPrice;
    const btcPriceSource =
      info?.price_converted ||
      rig?.price_converted ||
      info?.price?.BTC ||
      rig?.price?.BTC ||
      priceSource;
    const priceUnit =
      rig?.hashrate_unit ||
      rig?.hashrate?.advertised?.type ||
      rig?.hashrate?.suffix ||
      rig?.hashrate?.type ||
      "TH";

    setCompletionCalculatorContext({
      initialAlgo: algo,
      initialStartTime: start,
      initialEndTime: end,
      initialAdsHashrate: adsHashrate,
      initialAvgHashrate: avgHashrate,
      initialUnit: unit,
      initialPriceSource: priceSource,
      initialBtcPriceSource: btcPriceSource,
      initialPriceUnit: priceUnit,
      initialNhPriceData: nhPriceData,
    });
    setCompletionModalOpen(true);
  }, []);

  const callApi = useMemo(
    () =>
      createApiClient({
        onState: ({ type, payload }) => {
          if (type === "request-start") {
            setLoading(true);
            setError("");
            setLastCall({
              method: payload.method,
              path: payload.path,
              status: "Pending",
              durationMs: null,
            });
            return;
          }
          if (type === "request-finish") {
            setLastCall(payload);
            return;
          }
          if (type === "request-success") {
            setError("");
            if (payload.status === 304) {
              setModalContent({
                status: payload.status,
                message: payload.statusText,
                note: "Content not modified. Displaying previously fetched data if available.",
              });
            } else {
              setOutput(payload.data);
              setModalContent(payload.data || { success: true });
            }
            setResponseModalOpen(true);
            return;
          }
          if (type === "request-error") {
            setError(payload.errorMsg);
            if (payload.showModal) {
              setModalContent(
                payload.data || {
                  error: payload.errorMsg,
                  status: payload.status,
                },
              );
              setResponseModalOpen(true);
            } else {
              setOutput(null);
              setModalContent(null);
              setResponseModalOpen(false);
            }
            return;
          }
          if (type === "request-failed") {
            setError(payload.error);
            setLastCall((prev) => ({
              ...(prev || {}),
              status: "Failed",
              durationMs: payload.durationMs,
            }));
            return;
          }
          if (type === "request-end") {
            setLoading(false);
          }
        },
      }),
    [],
  );

  const handleMiningCall = useCallback(
    (path, opts = {}) => {
      return callApi(path, { ...opts, section: "mining" });
    },
    [callApi],
  );

  const handleHashpowerCall = useCallback(
    (path, opts = {}) => {
      return callApi(path, { ...opts, section: "hashpower" });
    },
    [callApi],
  );

  const navigate = useCallback((to) => {
    const nextPath = String(to || "/").startsWith("/")
      ? String(to || "/")
      : `/${String(to || "")}`;
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setRouteTick((value) => value + 1);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const isMiningRoute = (window.location.pathname || "/").startsWith("/mining");

  return (
    <div className="app-shell">
      {!isMiningRoute && (
        <header className="app-header">
          <div className="brand-block">
            {/* <h2>Ben Tre Mining Tool</h2> */}
            <p className="subtitle">
              A powerful desktop tool for Nicehash miners. Manage rigs, monitor
              stats, and automate hashpower purchases with ease.
            </p>
          </div>
          <div
            className="status-card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <div className="status-item">
              <span>Status:</span>
              <span
                className={`status-value ${loading ? "status-ready" : error ? "status-error" : "status-success"}`}
                style={{ color: "green" }}
              >
                {loading ? "Loading..." : error ? "Error" : "Ready"}
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                className="btn-pro secondary"
                onClick={() => navigate("/")}
              >
                Dashboard
              </button>
              <button
                className="btn-pro secondary"
                onClick={() => navigate("/mining")}
              >
                Mining
              </button>
            </div>
          </div>
        </header>
      )}

      {isMiningRoute ? (
        <MiningPage
          onCall={callApi}
          nhClient="BT"
          onNavigateHome={() => navigate("/")}
        />
      ) : (
        <main
          className="dashboard"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "24px",
            alignItems: "start",
          }}
        >
          <section className="quick-actions">
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
                  Open the hashrate calculator in a popup modal.
                </p>
              </div>
              <button
                className="btn-pro secondary"
                onClick={() => {
                  setCompletionCalculatorContext(null);
                  setCompletionModalOpen(true);
                }}
                style={{ whiteSpace: "nowrap" }}
              >
                Completion Calc
              </button>
            </div>
            <div
              className="column-stack"
              style={{ display: "flex", flexDirection: "column", gap: "24px" }}
            >
              <article className="panel">
                <NiceHash
                  output={output}
                  onCall={handleMiningCall}
                  algorithm={algorithm}
                  market={market}
                />
              </article>
            </div>
            <article className="panel">
              <MiningRigRental
                onCall={handleMiningCall}
                mrrClient={mrrClient}
                setMrrClient={setMrrClient}
                onOpenCompletionCalculator={openCompletionCalculator}
              />
            </article>
            <section className="pools-section">
              <Pools
                onCall={callApi}
                niceHashData={output}
                mrrClient={mrrClient}
                setMrrClient={setMrrClient}
              />
            </section>
          </section>
          <CryptoRatePage onCall={callApi} />
        </main>
      )}
      <Modal
        isOpen={responseModalOpen}
        onClose={() => setResponseModalOpen(false)}
        title="API Response Details"
        maxWidth="1100px"
      >
        {lastCall && (
          <div
            className="response-meta"
            style={{ marginBottom: "15px", opacity: 0.8, fontSize: "12px" }}
          >
            <span>
              {lastCall.method} {lastCall.path} — {lastCall.status} (
              {lastCall.durationMs}ms)
            </span>
          </div>
        )}
        <pre
          className="response-body modal"
          style={{ maxHeight: "60vh", overflow: "auto" }}
        >
          {JSON.stringify(modalContent || output, null, 2)}
        </pre>
      </Modal>

      <Modal
        isOpen={completionModalOpen}
        onClose={() => setCompletionModalOpen(false)}
        title="Rental Completion Calculator"
        maxWidth="750px"
      >
        <HashCompletionCalculator {...completionCalculatorContext} />
      </Modal>
    </div>
  );
}
