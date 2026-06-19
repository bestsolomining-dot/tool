import { useEffect, useRef, useState, useCallback } from "react";
import Modal from "./Modal"; // Import the new Modal component
import { poolHelpers as ph, poolApi, apiFetch } from "../core/poolUtils";
import { getAlgoDisplayName } from "../core/mapping";

export default function Pools({
  onCall,
  poolData,
  niceHashData,
  mrrClient,
  setMrrClient,
  nhClient,
  setNhClient,
}) {
  const [pools, setPools] = useState(() => ph.normalizeList(poolData || []));
  const [selected, setSelected] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [response, setResponse] = useState(null);
  const [verifyResults, setVerifyResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [running, setRunning] = useState(false);
  const [verificationDelay, setVerificationDelay] = useState(2345); // Delay between individual pool verifications in bulk run
  const [automationInterval, setAutomationInterval] = useState(3); // 30 seconds
  const [lastRunTime, setLastRunTime] = useState(null);
  const [rateLimitStatus, setRateLimitStatus] = useState(null);
  const [nextRunCountdown, setNextRunCountdown] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [runCount, setRunCount] = useState(0);
  const [currentRunStartTime, setCurrentRunStartTime] = useState(null);
  const [currentRunElapsed, setCurrentRunElapsed] = useState(0);
  const [mrrRigs, setMrrRigs] = useState(null);
  const [inspectData, setInspectData] = useState(null);
  const [filePools, setFilePools] = useState([]);
  const [verifyFromFile, setVerifyFromFile] = useState(false);
  const [extractedPools, setExtractedPools] = useState([]); // New state for extracted pools
  const [useExtractedPools, setUseExtractedPools] = useState(false); // New toggle for extracted pools
  const [useBrowser, setUseBrowser] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false); // State for the error detail modal
  const [inventoryModalOpen, setInventoryModalOpen] = useState(false);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [lastRunSummary, setLastRunSummary] = useState(null);

  const [selectorOpen, setSelectorOpen] = useState(false);
  const didAutoStartRef = useRef(false);
  const runTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const stopRef = useRef(false);
  const activeRequestRef = useRef(null);
  const dropdownRef = useRef(null); // Kept for legacy or cleanup
  const fileInputRef = useRef(null);

  const handleImportXlsx = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await ph.parseXlsx(file);
      const mapped = data.map((row) => ({
        name: row["Pool Name"] || row.name || "Imported Pool",
        miningAlgorithm:
          row["Algorithm"] || row.algorithm || row.miningAlgorithm || "",
        stratumHost:
          row["Stratum Host"] ||
          row.stratumHost ||
          row.stratumHostname ||
          row.host ||
          "",
        stratumPort: Number(row["Port"] || row.stratumPort || row.port || 0),
        username: row["Username"] || row.username || "",
        password: row["Password"] || row.password || "x",
        poolVerificationServiceLocation: row["Market"] || row.location || "ANY",
      }));
      const normalized = ph.normalizeList(mapped);
      setFilePools(normalized);
      setVerifyFromFile(true);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  };

  const loadExtractedPools = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Use onCall to ensure authentication token is sent
      const data = await onCall("/api/v2/extracted-pools", { silent: true });
      const result = { ok: !!data, data };

      if (result.ok && Array.isArray(result.data)) {
        const mapped = result.data.map((p) => {
          // Re-map handles to ensure they target correct NiceHash accounts (BT, PH, KIMLOAN, NHATLINH)
          let nhHandle = p.nhClient || p.client || "BT";
          const u = String(p.username || "").toLowerCase();
          if (u.includes("solomining")) nhHandle = "PH";
          else if (u.includes("luckymining")) nhHandle = "NHATLINH";
          else if (u.includes("lona")) nhHandle = "KIMLOAN";

          return {
            ...p,
            name: p.name || "Extracted Pool",
            miningAlgorithm: p.miningAlgorithm || p.algorithm || "Unknown",
            stratumHost: p.stratumHost || p.stratumHostname || "",
            stratumPort: Number(p.stratumPort || p.port || 0),
            username: p.username || "",
            password: p.password || "x",
            client: nhHandle,
            nhClient: nhHandle,
          };
        });

        const normalized = ph.normalizeList(mapped);
        setExtractedPools(normalized);
        setPools(normalized); // Populate the main selection list
        setUseExtractedPools(true); // Enable toggle to prioritize these for bulk actions
      } else if (result.ok) {
        setError("Invalid data format received from extracted pools API.");
      } else {
        setError(
          result.data?.error ||
            `Failed to load extracted pools: ${result.status}`,
        );
      }
    } catch (err) {
      setError(`Failed to load extracted pools: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Function to load NiceHash pools for the selected client
  const loadPools = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Use onCall instead of direct poolApi which may lack credentials
      const result = await onCall("/api/v2/pools", {
        query: { client: nhClient },
        silent: true,
        section: "pools",
      });

      // Robustly extract the pool list from the result envelope or direct array
      const rawData =
        result?.data || (Array.isArray(result) ? result : result?.list || []);
      const normalized = ph.normalizeList(rawData);

      setPools(normalized);
      return normalized;
    } catch (err) {
      setError(err.message || String(err));
      setPools([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [nhClient, onCall]);

  // Initialize pools on mount
  useEffect(() => {
    loadPools();
  }, [loadPools]); // Re-fetch pools when loadPools (or nhClient) changes

  // Keep local pools state in sync with parent poolData prop
  useEffect(() => {
    if (poolData) {
      setPools(ph.normalizeList(poolData));
    }
  }, [poolData]);

  // Update the elapsed time counter every second while automation is running
  useEffect(() => {
    let interval;
    if (running && currentRunStartTime) {
      interval = setInterval(() => {
        setCurrentRunElapsed(
          Math.floor((Date.now() - currentRunStartTime) / 1000),
        );
      }, 1000);
    } else {
      setCurrentRunElapsed(0);
    }
    return () => clearInterval(interval);
  }, [running, currentRunStartTime]);

  // Automatically update the last run summary when a cycle completes during automation
  useEffect(() => {
    if (!playing && running && verifyResults.length > 0) {
      const completed = verifyResults.filter((item) => !item.result?.pending);
      if (completed.length > 0) {
        const skipped = completed.filter((item) =>
          item.result?.data?.message?.includes("Skipped"),
        ).length;
        const success = completed.filter(
          (item) =>
            ph.isVerifySuccess(item.result) &&
            !item.result?.data?.message?.includes("Skipped"),
        ).length;
        const failed = completed.length - success - skipped;

        setLastRunSummary({
          verified: completed.length,
          success,
          failed,
          skipped,
        });
      }
    }
  }, [playing, running, verifyResults]);

  // Automatically clear MRR results when client changes to prevent data mixing
  useEffect(() => {
    setMrrRigs(null);
  }, [mrrClient]);

  async function fetchMrrRigs(clientName = mrrClient) {
    setLoading(true);
    setMrrRigs(null);
    setError("");
    try {
      const response = await onCall("/api/v2/mrr/rigs", {
        query: { client: clientName },
        silent: true,
      });
      if (response && response.success) {
        setMrrRigs(response.data);
      } else {
        if (response?.status === 401) {
          throw new Error(
            "Unauthorized: MRR API Key/Secret is invalid or missing for this client.",
          );
        }
        const message =
          response?.error || response?.message || "Request failed";
        throw new Error(message);
      }
    } catch (err) {
      setError(
        err.message.includes("MRR Error")
          ? err.message
          : `MRR Error: ${err.message}`,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function onPointerDown(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setSelectorOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    return () => {
      stopRef.current = true; // Signal any running loops to stop immediately
      if (runTimerRef.current) clearInterval(runTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (activeRequestRef.current) activeRequestRef.current.abort();
    };
  }, []);

  async function onSelect(id) {
    const key = String(id);
    const pool =
      pools.find((item, index) => ph.getKey(item, index) === key) || null;
    const poolId = ph.getId(pool);

    setSelectedId(key);
    setSelected(pool);
    setResponse(null);
    setVerifyResults([]);
    setError("");
    setSelectorOpen(false); // Close selector on pick

    if (!pool) return;
    if (!poolId) {
      setError("Selected pool does not include an id for pool details.");
      return;
    }

    setDetailsLoading(true);
    try {
      const targetClient = pool.client || pool.nhClient || nhClient;
      const result = await poolApi.get(poolId, targetClient);

      if (!result.ok) {
        const message =
          typeof result.data === "string"
            ? `${result.status}: ${result.data.slice(0, 140)}`
            : result.data?.error || result.data?.message || result.status;
        throw new Error(message);
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setDetailsLoading(false);
    }
  }

  async function verify() {
    if (!selected) {
      setError("Select a pool first.");
      return;
    }

    if (selected.name?.toLowerCase() === "active") {
      return;
    }

    setLoading(true);
    setResponse(null);
    setVerifyResults([]);
    setError("");

    const payload = ph.buildVerifyBody(selected);
    const missingFields = ph.getMissingVerifyFields(payload);
    if (missingFields.length > 0) {
      const poolId = ph.getId(selected);
      if (poolId) {
        try {
          const targetClient = selected.client || selected.nhClient || nhClient;
          const details = (await poolApi.get(poolId, targetClient)).data;
          const fullPayload = ph.buildVerifyBody(details);
          return await performVerification(fullPayload, details);
        } catch (e) {
          setError(`Details Error: ${e.message}`);
          setLoading(false);
          return;
        }
      }
      setError(`Missing required verify fields: ${missingFields.join(", ")}`);
      setLoading(false);
      return;
    }
    await performVerification(payload, selected);
  }

  async function performVerification(payload, poolDetails) {
    try {
      const targetClient =
        poolDetails.client || poolDetails.nhClient || nhClient;
      let result = await poolApi.verify(payload, targetClient); // Pass nhClient

      if (result.status === 429) {
        const retryAfter =
          result.headers?.get("Retry-After") ||
          result.data?.headers?.["retry-after"];
        const seconds = parseInt(retryAfter, 10) || 30;
        setRateLimitStatus(`Rate limit hit. Retrying in ${seconds}s...`);
        try {
          await new Promise((r) => setTimeout(r, seconds * 1000));
          result = await poolApi.verify(payload, targetClient); // Pass nhClient
        } finally {
          setRateLimitStatus(null);
        }
      }

      const enrichedResult = { ...result, poolDetails, requestBody: payload };
      setResponse(enrichedResult);
      setVerifyResults([
        {
          key: selectedId,
          label: selected ? ph.getLabel(selected) : selectedId,
          algorithm: ph.getAlgo(selected),
          result: enrichedResult,
        },
      ]);
      if (!result.ok) {
        setError(result.data?.error || result.data?.message || result.status);
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function verifyPoolBody(poolDetails, signal, overrideClient) {
    const payload = ph.buildVerifyBody(poolDetails);
    const missingFields = ph.getMissingVerifyFields(payload);

    if (missingFields.length > 0) {
      return {
        ok: false,
        data: {
          error: `Missing required verify fields: ${missingFields.join(", ")}`,
          requestBody: payload,
        },
      };
    }

    try {
      const targetClient =
        overrideClient ||
        poolDetails.client ||
        poolDetails.nhClient ||
        nhClient;
      let result;
      if (useBrowser) {
        // Gọi endpoint Chromedriver mới
        const res = await apiFetch(
          `/api/v2/pools/verify-browser?client=${targetClient}&headless=${!showBrowser}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal,
          },
        );
        result = { ok: res.ok, data: res.data, status: res.status };
      } else {
        // Sử dụng API truyền thống
        result = await poolApi.verify(payload, targetClient, signal);
      }
      return { ...result, poolDetails, requestBody: payload };
    } catch (err) {
      if (err.name === "AbortError") {
        return {
          ok: false,
          requestBody: payload,
          data: { stopped: true, message: "Stopped by user" },
        };
      }
      return {
        ok: false,
        requestBody: payload,
        data: { error: err.message || String(err) },
      };
    }
  }

  async function verifyAllOnce({
    resetStop = true,
    keepRunning = false,
    targetPools = null,
  } = {}) {
    const source =
      targetPools ||
      (verifyFromFile ? filePools : useExtractedPools ? extractedPools : pools);
    if (!Array.isArray(source) || source.length === 0 || playing) return;
    setPlaying(true);
    setError("");
    setResponse(null);
    setVerifyResults([]);
    setProgress({ current: 0, total: source.length });
    if (resetStop) stopRef.current = false;

    // Identify active pool IDs from NiceHash orders to avoid interrupting them
    const activeOrdersList =
      niceHashData?.list ||
      niceHashData?.myOrders ||
      (Array.isArray(niceHashData) ? niceHashData : []);
    const activePoolIds = new Set(
      (Array.isArray(activeOrdersList) ? activeOrdersList : [])
        .filter((o) => (o.status?.code || o.status) === "ACTIVE")
        .map((o) => String(o.pool?.id || o.pool?.poolId || ""))
        .filter(Boolean),
    );
    const seenPoolAlgos = new Set();

    try {
      for (let i = 0; i < source.length; i++) {
        if (stopRef.current) break;

        const pool = source[i];
        const poolId = ph.getId(pool);
        const poolName = (pool.name || "").trim();
        const poolAlgo = ph.getAlgo(pool);
        const nameAlgoKey = `${poolName}|${poolAlgo}`;
        const key = ph.getKey(pool, i);
        const poolClient = pool.client || pool.nhClient || nhClient;

        let skipReason = "";
        if (pool.name?.toLowerCase() === "active")
          skipReason = "Skipped: Active Pool";
        else if (poolId && activePoolIds.has(String(poolId)))
          skipReason = "Skipped: Active Order";
        else if (poolName && seenPoolAlgos.has(nameAlgoKey))
          skipReason = "Skipped: Duplicate Pool Name & Algo";

        if (skipReason) {
          setVerifyResults((prev) => [
            ...prev.filter((item) => item.key !== key),
            {
              key,
              label: ph.getLabel(pool, i),
              result: { ok: true, data: { message: skipReason } },
              algorithm: poolAlgo,
            },
          ]);
          setProgress({ current: i + 1, total: source.length });
          // Mark as seen so duplicates are skipped even if the first occurrence was skipped for other reasons
          if (skipReason !== "Skipped: Duplicate Pool Name & Algo" && poolName)
            seenPoolAlgos.add(nameAlgoKey);
          continue;
        }

        if (poolName) seenPoolAlgos.add(nameAlgoKey);
        const controller = new AbortController();
        activeRequestRef.current = controller;

        setResponse((prev) => ({ ...(prev || {}), [key]: "verifying" }));
        setVerifyResults((prev) => [
          ...prev.filter((item) => item.key !== key),
          {
            key,
            label: ph.getLabel(pool, i),
            result: { pending: true },
            algorithm: poolAlgo,
          },
        ]);

        let result;
        try {
          let details = pool;
          if (poolId) {
            // Assuming poolApi.get accepts a signal or you use onCall directly
            let resDetails = await poolApi.get(
              poolId,
              poolClient,
              controller.signal,
            );
            if (resDetails.status === 429) {
              const seconds =
                parseInt(
                  resDetails.headers?.get("Retry-After") ||
                    resDetails.data?.headers?.["retry-after"],
                  10,
                ) || 30;
              setRateLimitStatus(
                `Rate limit hit on details. Waiting ${seconds}s...`,
              );
              try {
                await new Promise((r) => setTimeout(r, seconds * 1000));
                resDetails = await poolApi.get(poolId, poolClient);
              } finally {
                setRateLimitStatus(null);
              }
            }
            // Normalize keys after fetching fresh details from API
            const d = resDetails.data;
            details = {
              ...d,
              miningAlgorithm: d.algorithm || d.miningAlgorithm || "",
              stratumHost: d.stratumHostname || d.stratumHost || "",
              stratumPort: Number(d.port || d.stratumPort || 0),
              username: d.username || "",
              password: d.password || "x",
            };
          }

          const bodyToSend =
            typeof details === "string" ? JSON.parse(details) : details;
          result = await verifyPoolBody(
            bodyToSend,
            controller.signal,
            poolClient,
          );

          if (result.status === 429) {
            const retryAfter =
              result.headers?.get("Retry-After") ||
              result.data?.headers?.["retry-after"];
            const seconds = parseInt(retryAfter, 3) || 5;
            setRateLimitStatus(
              `Rate limit hit on verify. Waiting ${seconds}s...`,
            );
            try {
              await new Promise((r) => setTimeout(r, seconds * 1000));
              // Retry once for this pool
              result = await verifyPoolBody(bodyToSend, controller.signal);
            } finally {
              setRateLimitStatus(null);
            }
          }
        } catch (err) {
          result =
            err.name === "AbortError"
              ? {
                  ok: false,
                  data: { stopped: true, message: "Stopped by user" },
                }
              : { ok: false, data: { error: err.message || String(err) } };
        } finally {
          activeRequestRef.current = null;
        }

        setResponse((prev) => ({ ...(prev || {}), [key]: result }));
        setVerifyResults((prev) => [
          ...prev.filter((item) => item.key !== key),
          {
            key,
            label: ph.getLabel(pool, i),
            result,
            algorithm: poolAlgo,
          },
        ]);
        setProgress({ current: i + 1, total: source.length });

        if (stopRef.current || i >= source.length - 1) break;
        await new Promise((resolve) => {
          const startedAt = Date.now();
          const timer = setInterval(() => {
            if (
              stopRef.current ||
              Date.now() - startedAt >= verificationDelay
            ) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      }
    } finally {
      setPlaying(false);
      if (!keepRunning && stopRef.current) setRunning(false);
    }
  }

  async function startRun() {
    if (running || playing) return;
    setRunning(true);
    setRunCount(0);
    setCurrentRunStartTime(Date.now());
    stopRef.current = false;

    const intervalMs = automationInterval * 1000; // Convert seconds to milliseconds

    const scheduleNextCycle = async () => {
      if (stopRef.current) {
        setRunning(false);
        return;
      }

      // Check if a verification cycle is still active before starting a new one
      if (playing) {
        runTimerRef.current = setTimeout(scheduleNextCycle, 1000);
        return;
      }

      setRunCount((prev) => prev + 1);
      setNextRunCountdown(null); // Clear previous countdown display before a new cycle starts
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

      await verifyAllOnce({ resetStop: false, keepRunning: true });

      const finishedAt = new Date();
      setLastRunTime(finishedAt.toLocaleTimeString());

      if (stopRef.current) {
        // Check stopRef again after verifyAllOnce completes
        setRunning(false);
        return;
      }

      let remaining = intervalMs / 1000; // Total seconds for the next countdown display
      setNextRunCountdown(remaining);

      countdownTimerRef.current = setInterval(() => {
        remaining -= 1;
        setNextRunCountdown(remaining > 0 ? remaining : 0);
        if (remaining <= 0) {
          clearInterval(countdownTimerRef.current);
          scheduleNextCycle(); // Start the next cycle immediately after the countdown finishes
        }
      }, 1000);
    };

    // Start the first cycle immediately
    scheduleNextCycle();
  }

  function verifyAlgorithm(algorithm) {
    const base = verifyFromFile ? filePools : pools;
    const targetPools = base.filter((pool) => ph.getAlgo(pool) === algorithm);
    verifyAllOnce({ targetPools });
  }

  // Auto-run automation logic if requested via URL parameter (?start=true) after 5s delay
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get("start") === "true" &&
      !didAutoStartRef.current &&
      !loading &&
      !playing &&
      !running
    ) {
      didAutoStartRef.current = true;
      console.log(
        "[Pools] Auto-start parameter detected. Initializing automation in 5s...",
      );
      const timer = setTimeout(() => {
        console.log("[Pools] Auto-starting automation loop...");
        startRun();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [loading, playing, running]);

  function stopAutomation() {
    stopRef.current = true;
    setRunning(false); // Set running to false immediately when stop is requested
    if (runTimerRef.current) {
      clearInterval(runTimerRef.current);
      runTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
      setNextRunCountdown(null);
    }
    if (activeRequestRef.current) {
      activeRequestRef.current.abort(); // Abort any ongoing fetch requests
      activeRequestRef.current = null;
    }
    setCurrentRunStartTime(null);
    setRunCount(0);
    setLastRunTime(null); // Clear the last run time when automation is stopped
  }

  const handleExportResults = () => {
    const resultsToExport = verifyResults.filter(
      (item) => !item.result?.pending,
    );

    // 1. Export Pool Verification Results
    const poolData = resultsToExport.map((item) => {
      const p = item.result?.poolDetails || item.result?.requestBody || {};
      const success = ph.isVerifySuccess(item.result);

      const vAlgo = ph.getVerifyAlgo(item.result);
      const algo =
        vAlgo && vAlgo !== "N/A" && vAlgo !== "Unknown"
          ? vAlgo
          : p.miningAlgorithm || p.algorithm || "N/A";

      return {
        "Pool Name": item.label,
        Algorithm: algo,
        Status: success ? "VERIFIED" : "ERROR",
        "Stratum Host": p.stratumHost || p.stratumHostname || p.host || "",
        Port: p.stratumPort || p.port || "",
        Username: p.username || "",
        Message: ph.getVerifyMessage(item.result),
        "Verified At": new Date().toLocaleString() + " (Local)", // Explicitly state local time
      };
    });
    if (poolData.length > 0) {
      ph.exportToXlsx(poolData, `pool_verification_${Date.now()}.xlsx`);
    }

    // 2. Export MRR Rigs (from local state)
    if (mrrRigs) {
      const rigs =
        mrrRigs.rigs || mrrRigs.data || (Array.isArray(mrrRigs) ? mrrRigs : []);
      const rigData = (Array.isArray(rigs) ? rigs : []).map((r) => ({
        ID: r.id,
        Name: r.name,
        Status: r.status,
        Algorithm: r.algo,
        Hashrate: r.hashrate,
        Price: r.price,
      }));
      if (rigData.length > 0)
        ph.exportToXlsx(rigData, `mrr_rigs_${Date.now()}.xlsx`);
    }

    // 3. Export NiceHash Orders (from props)
    const rawOrders =
      niceHashData?.list ||
      niceHashData?.myOrders ||
      (Array.isArray(niceHashData) ? niceHashData : []);
    const orderData = (Array.isArray(rawOrders) ? rawOrders : []).map((o) => ({
      "Order ID": o.id || o.orderId,
      Algorithm:
        typeof o.algorithm === "object" ? o.algorithm.algorithm : o.algorithm,
      Market: typeof o.market === "object" ? o.market.id : o.market,
      Price: o.price,
      Limit: o.limit,
      Status: typeof o.status === "object" ? o.status.code : o.status,
    }));
    if (orderData.length > 0) ph.exportToXlsx(orderData, "orders.xlsx");
  };

  const selectedLabel = selected ? ph.getLabel(selected) : "Select a pool";
  const completedResults = verifyResults.filter(
    (item) => !item.result?.pending,
  );

  const getAlgoCountsSummary = (results) => {
    const counts = results.reduce((acc, item) => {
      const algorithm = item.algorithm || ph.getVerifyAlgo(item.result);
      acc[algorithm] = (acc[algorithm] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .map(([algo, count]) => `${getAlgoDisplayName(algo)}: ${count}`)
      .join(", ");
  };

  const skippedResults = completedResults.filter((item) =>
    item.result?.data?.message?.includes("Skipped"),
  );
  const successResults = completedResults.filter(
    (item) =>
      ph.isVerifySuccess(item.result) &&
      !item.result?.data?.message?.includes("Skipped"),
  );
  const failResults = completedResults.filter(
    (item) =>
      !ph.isVerifySuccess(item.result) &&
      !item.result?.data?.message?.includes("Skipped"),
  );

  const successCount = successResults.length;
  const failCount = failResults.length;
  const skippedCount = skippedResults.length;

  const verifiedSummary = getAlgoCountsSummary(completedResults);
  const successSummary = getAlgoCountsSummary(successResults);
  const failSummary = getAlgoCountsSummary(failResults);
  const skippedSummary = getAlgoCountsSummary(skippedResults);

  const lastRunVerified = lastRunSummary
    ? ` (Last: ${lastRunSummary.verified})`
    : "";
  const lastRunSuccess = lastRunSummary
    ? ` (Last: ${lastRunSummary.success})`
    : "";
  const lastRunFailed = lastRunSummary
    ? ` (Last: ${lastRunSummary.failed})`
    : "";
  const lastRunSkipped = lastRunSummary
    ? ` (Last: ${lastRunSummary.skipped})`
    : "";

  const activePoolSource = verifyFromFile
    ? filePools
    : useExtractedPools
      ? extractedPools
      : pools;
  const poolAlgorithmGroups = Object.entries(
    activePoolSource.reduce((groups, pool) => {
      const algorithm = ph.getAlgo(pool);
      groups[algorithm] = (groups[algorithm] || 0) + 1;
      return groups;
    }, {}),
  ).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="card pools-manager">
      <div className="market-inputs" style={{ marginBottom: "15px" }}>
        <small style={{ opacity: 0.8, fontSize: "13px", marginLeft: "10px" }}>
          ACTIVE NICEHASH CLIENT
        </small>
        <select
          className="select-pro"
          value={nhClient}
          onChange={(e) => setNhClient(e.target.value)}
        >
          <option value="BT">NiceHash Client: BT</option>
          <option value="PH">NiceHash Client: PH</option>
          <option value="KIMLOAN">NiceHash Client: KIMLOAN</option>
          <option value="NHATLINH">NiceHash Client: NHATLINH</option>
          <option value="VN">NiceHash Client: VN (all NH Pools)</option>
        </select>
        <div
          className="pool-automation-main"
          style={{
            flex: 1,
            minWidth: "600px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          {/* Integrated Pool Automation & Bulk Verification Section */}
          <div
            className="panel-header"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            {/* <h3 style={{ margin: 0 }}>Automation & Bulk Verify</h3> */}
            {rateLimitStatus && (
              <div
                style={{
                  color: "#fbbf24",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                ⚠️ {rateLimitStatus}
              </div>
            )}
          </div>
          {/* Controls Section */}
          {progress.total > 0 && (
            <div
              className="verify-progress-wrapper"
              style={{ marginBottom: "15px" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "10px",
                  marginBottom: "5px",
                  opacity: 0.8,
                  fontWeight: "bold",
                }}
              >
                <span>VERIFYING POOLS...</span>
                <span>
                  {progress.current} / {progress.total} (
                  {Math.round((progress.current / progress.total) * 100)}%)
                </span>
              </div>
              <div
                className="verify-progress-bar-container"
                style={{
                  width: "100%",
                  height: "12px",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: "10px",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  className="verify-progress-bar-fill"
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                    height: "100%",
                    background: "#073681",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "15px",
              background: "rgba(255,255,255,0.03)",
              padding: "15px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                }}
              >
                <div className="field">
                  <label className="label" style={{ fontSize: "10px" }}>
                    DELAY (ms)
                  </label>
                  <input
                    type="number"
                    className="input-pro"
                    value={verificationDelay}
                    onChange={(e) =>
                      setVerificationDelay(Number(e.target.value))
                    }
                  />
                </div>
                <div className="field">
                  <label className="label" style={{ fontSize: "10px" }}>
                    INTERVAL (s)
                  </label>
                  <input
                    type="number"
                    className="input-pro"
                    value={automationInterval}
                    onChange={(e) =>
                      setAutomationInterval(Number(e.target.value))
                    }
                  />
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  fontSize: "12px",
                  fontWeight: "bold",
                  alignItems: "center",
                  minHeight: "40px",
                }}
              >
                <button
                  className="btn-pro primary"
                  style={{ flex: 2 }}
                  onClick={startRun}
                  disabled={playing || running}
                >
                  {running ? "Running..." : "Start Auto Run"}
                </button>
                {(playing || running) && (
                  <button
                    className="btn-pro"
                    onClick={stopAutomation}
                    style={{ flex: 1, background: "#ef4444" }}
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  height: "32px",
                }}
              >
                <input
                  type="checkbox"
                  id="mainVerifySourceToggle"
                  checked={verifyFromFile}
                  onChange={(e) => setVerifyFromFile(e.target.checked)}
                />
                <label
                  htmlFor="mainVerifySourceToggle"
                  style={{
                    fontSize: "12px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                >
                  VERIFY FROM FILE ({filePools.length})
                </label>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                }}
              >
                <button
                  className="btn-pro secondary"
                  onClick={loadExtractedPools}
                  disabled={loading || playing || running}
                >
                  Load Extracted
                </button>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "10px" }}
                >
                  <input
                    type="checkbox"
                    id="useExtractedPoolsToggle"
                    checked={useExtractedPools}
                    onChange={(e) => setUseExtractedPools(e.target.checked)}
                  />
                  <label
                    htmlFor="useExtractedPoolsToggle"
                    style={{
                      fontSize: "12px",
                      fontWeight: "bold",
                      cursor: "pointer",
                    }}
                  >
                    USE EXTRACTED ({extractedPools.length})
                  </label>
                </div>
              </div>
              <div
                style={{
                  fontSize: "8px",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(60px, 1fr))",
                  gap: "6px",
                }}
              >
                <button
                  className="btn-pro secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Import XLSX
                </button>
                <button
                  className="btn-pro secondary"
                  onClick={() => setInventoryModalOpen(true)}
                >
                  Inventory
                </button>
                <button
                  className="btn-pro secondary"
                  onClick={() => setConnectionModalOpen(true)}
                >
                  Connect Manager
                </button>
                <button
                  className="btn-pro secondary"
                  onClick={handleExportResults}
                  disabled={completedResults.length === 0}
                >
                  Export Results ({completedResults.length})
                </button>
              </div>
              <button
                className="btn-pro secondary"
                onClick={() => verifyAllOnce()}
                disabled={playing || running}
              >
                Verify All
              </button>
            </div>
            <div
              style={{
                fontSize: "12px",
                background: "rgba(0,0,0,0.2)",
                padding: "12px",
                borderRadius: "6px",
                border: "1px solid rgba(59, 130, 246, 0.3)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div
                style={{
                  color: running ? "#3b82f6" : "#94a3b8",
                  fontWeight: "bold",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>Cycle Status:</span>
                <span>{running ? `Active (Cycle #${runCount})` : "Idle"}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  opacity: 0.8,
                }}
              >
                <span>Total Time Run:</span>
                <span>
                  {Math.floor(currentRunElapsed / 60)}m {currentRunElapsed % 60}
                  s
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  opacity: 0.8,
                  color: "#10b981",
                }}
              >
                <span>Last Cycle End:</span>
                <span>
                  {lastRunTime ? `${lastRunTime} (Local)` : "N/A"}
                </span>{" "}
                {/* Clarify local time */}
              </div>
              {nextRunCountdown !== null && running && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    color: "#fbbf24",
                    borderTop: "1px solid rgba(255,255,255,0.05)",
                    paddingTop: "4px",
                    marginTop: "2px",
                  }}
                >
                  <span>Next cycle in:</span>
                  <span>{nextRunCountdown}s</span>
                </div>
              )}
            </div>
          </div>
          {/* Results Section */}
          {verifyResults.length > 0 ? (
            <div
              className="results-wrapper"
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                minHeight: 0,
                overflow: "hidden",
                gap: "15px",
              }}
            >
              <div
                className="verify-summary"
                style={{
                  flexShrink: 0,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
                  gap: "10px",
                  paddingBottom: "10px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div>
                  <span style={{ fontSize: "10px", opacity: 0.6 }}>Total:</span>{" "}
                  <strong>
                    {verifyFromFile ? filePools.length : pools.length}
                  </strong>
                </div>
                <div>
                  <span style={{ fontSize: "10px", opacity: 0.6 }}>
                    Verified:
                  </span>{" "}
                  <strong>{completedResults.length}</strong>
                  <span style={{ fontSize: "10px", opacity: 0.6 }}>
                    {" "}
                    ({verifiedSummary}){lastRunVerified}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: "10px", color: "#34d399" }}>
                    Success:
                  </span>{" "}
                  <strong>{successCount}</strong>
                  <span style={{ fontSize: "10px", opacity: 0.6 }}>
                    {" "}
                    ({successSummary}){lastRunSuccess}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: "10px", color: "#f87171" }}>
                    Error:
                  </span>{" "}
                  <strong
                    style={{
                      cursor: failCount > 0 ? "pointer" : "default",
                      textDecoration: failCount > 0 ? "underline" : "none",
                    }}
                    onClick={() => failCount > 0 && setErrorModalOpen(true)}
                  >
                    {failCount}
                  </strong>
                  <span style={{ fontSize: "10px", opacity: 0.6 }}>
                    {" "}
                    ({failSummary}){lastRunFailed}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: "10px", color: "#f87171" }}>
                    Skipped:
                  </span>{" "}
                  <strong>{skippedCount}</strong>
                  <span style={{ fontSize: "10px", opacity: 0.6 }}>
                    {" "}
                    ({skippedSummary}){lastRunSkipped}
                  </span>
                </div>
              </div>

              <div
                className="verify-list"
                style={{
                  flex: 1,
                  minHeight: "240px",
                  maxHeight: "240px",
                  overflowY: "auto",
                  overflowX: "hidden",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.015)",
                  scrollbarWidth: "thin",
                  scrollbarColor: "rgba(255,255,255,0.15) transparent",
                }}
              >
                {verifyResults.map((item) => {
                  const pending = item.result?.pending;
                  const success = !pending && ph.isVerifySuccess(item.result);
                  const algorithm =
                    item.algorithm || ph.getVerifyAlgo(item.result);
                  return (
                    <div
                      key={item.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "5px 5px",
                        borderBottom: "2px solid rgba(102, 86, 104, 0.07)",
                        fontSize: "10px",
                      }}
                    >
                      <div
                        style={{
                          width: "80px",
                          textAlign: "center",
                          padding: "4px 0",
                          borderRadius: "4px",
                          fontWeight: 700,
                          fontSize: "10px",
                          flexShrink: 0,
                          background: pending
                            ? "rgba(59,130,246,.1)"
                            : success
                              ? "rgba(52,211,153,.1)"
                              : "rgba(248,113,113,.1)",
                          color: pending
                            ? "#3b82f6"
                            : success
                              ? "#34d399"
                              : "#f87171",
                          border: `1px solid ${
                            pending
                              ? "#3b82f644"
                              : success
                                ? "#34d39944"
                                : "#f8717144"
                          }`,
                        }}
                      >
                        {pending ? "PENDING" : success ? "SUCCESS" : "ERROR"}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontWeight: 600,
                        }}
                      >
                        {item.label}
                      </div>
                      <div
                        style={{
                          width: "60px",
                          flexShrink: 0,
                          opacity: 0.6,
                          fontFamily: "monospace",
                        }}
                      >
                        {algorithm}
                      </div>
                      <div
                        style={{
                          flex: 2,
                          minWidth: 0,
                          opacity: 0.8,
                          fontSize: "11px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {pending
                          ? "Waiting..."
                          : ph.getVerifyMessage(item.result)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: "40px",
                opacity: 0.5,
              }}
            >
              No verification results yet. Start a manual "Verify All" or "Auto
              Run" to begin monitoring.
            </div>
          )}
        </div>
      </div>
      <div
        className="pools-dashboard-layout"
        style={{
          display: "flex",
          gap: "1.5rem",
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        {sidebarVisible && (
          <div
            className="pool-sidebar"
            style={{
              width: "100%",
              maxWidth: "380px",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: "1.5rem",
            }}
          >
            <div className="pool-algorithm-summary" style={{ marginTop: 0 }}>
              <div className="response-header compact">
                <h3>Algorithm Summary</h3>
                <span>
                  {poolAlgorithmGroups.length} types / {activePoolSource.length}{" "}
                  pools
                </span>
              </div>
              {poolAlgorithmGroups.length > 0 ? (
                <div
                  className="algorithm-grid"
                  style={{
                    maxHeight: "650px",
                    overflowY: "auto",
                    scrollbarWidth: "thin",
                    scrollbarColor: "rgba(255,255,255,0.1) transparent",
                  }}
                >
                  {poolAlgorithmGroups.map(([algorithm, count]) => (
                    <div className="algorithm-row" key={algorithm}>
                      <span>{getAlgoDisplayName(algorithm)}</span>
                      <strong style={{ marginLeft: 3 }}>{count}</strong>
                      <button
                        type="button"
                        className="btn-pro secondary"
                        onClick={() => verifyAlgorithm(algorithm)}
                        disabled={playing || running}
                      >
                        Verify
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="response-body compact">No pools loaded.</pre>
              )}
            </div>
          </div>
        )}
      </div>
      {error && <pre className="error-message">{error}</pre>}
      {/* Pool Selector Modal */}
      <Modal
        isOpen={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        title="Select a Stratum Pool"
        maxWidth="600px"
      >
        <div
          className="select-dropdown-pro"
          style={{
            position: "static",
            boxShadow: "none",
            border: "none",
            padding: 0,
          }}
        >
          {pools.map((pool, index) => {
            const key = ph.getKey(pool, index);
            const label = ph.getLabel(pool, index);
            const isActive = selectedId === key;
            return (
              <div
                key={key}
                className={`dropdown-item-pro ${isActive ? "active" : ""}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
                onClick={() => onSelect(key)}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <strong style={{ color: isActive ? "#3b82f6" : "inherit" }}>
                    {label}
                  </strong>
                  <code style={{ fontSize: "11px", opacity: 0.7 }}>
                    {getAlgoDisplayName(ph.getAlgo(pool))}
                  </code>
                  {(pool.client || pool.nhClient) && (
                    <span
                      style={{
                        fontSize: "9px",
                        color: "#10b981",
                        marginTop: "2px",
                      }}
                    >
                      Account: {pool.client || pool.nhClient}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
      {/* Pool Inventory Modal */}
      <Modal
        isOpen={inventoryModalOpen}
        onClose={() => setInventoryModalOpen(false)}
        title="Pool Inventory"
        maxWidth="1200px"
      >
        <div style={{ maxHeight: "75vh", overflowY: "auto", padding: "10px" }}>
          <table className="pro-table">
            <thead>
              <tr style={{ fontSize: "11px", opacity: 0.6 }}>
                <th>NAME</th>
                <th>ALGORITHM</th>
                <th>STRATUM HOST</th>
                <th>PORT</th>
                <th>USERNAME</th>
                <th>ACCOUNT</th>
                <th style={{ textAlign: "right" }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {activePoolSource.map((pool, idx) => {
                const key = ph.getKey(pool, idx);
                const label = ph.getLabel(pool, idx);
                const algo = ph.getAlgo(pool);
                return (
                  <tr
                    key={key}
                    style={{
                      fontSize: "11px",
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                    }}
                  >
                    <td style={{ fontWeight: "bold", color: "#f8fafc" }}>
                      {label}
                    </td>
                    <td style={{ color: "#60a5fa" }}>
                      {getAlgoDisplayName(algo)}
                    </td>
                    <td style={{ fontFamily: "monospace", opacity: 0.8 }}>
                      {pool.stratumHost ||
                        pool.stratumHostname ||
                        pool.host ||
                        "N/A"}
                    </td>
                    <td style={{ fontFamily: "monospace" }}>
                      {pool.stratumPort || pool.port || "N/A"}
                    </td>
                    <td style={{ fontFamily: "monospace", opacity: 0.8 }}>
                      {pool.username || pool.user || "N/A"}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: "9px",
                          background: "rgba(255,255,255,0.05)",
                          padding: "2px 6px",
                          borderRadius: "4px",
                        }}
                      >
                        {pool.client || pool.nhClient || nhClient}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          className="btn-pro secondary"
                          style={{ color: "#10b981" }}
                          onClick={() => {
                            setSelected(pool);
                            setSelectedId(key);
                            setInventoryModalOpen(false);
                          }}
                        >
                          Select
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {activePoolSource.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px", opacity: 0.5 }}>
              No pools found.
            </div>
          )}
        </div>
        <div
          className="modal-actions"
          style={{ justifyContent: "flex-end", marginTop: "15px" }}
        >
          <button
            className="btn-pro secondary"
            onClick={() => setInventoryModalOpen(false)}
          >
            Close
          </button>
        </div>
      </Modal>
      {/* Pool Connection Manager Modal (Same style as MRR) */}
      <Modal
        isOpen={connectionModalOpen}
        onClose={() => setConnectionModalOpen(false)}
        title="Pool Connection Manager"
        maxWidth="1000px"
      >
        <div style={{ padding: "10px" }}>
          <div
            className="pool-list"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              maxHeight: "70vh",
              overflowY: "auto",
              paddingRight: "5px",
            }}
          >
            {activePoolSource.map((pool, idx) => {
              const key = ph.getKey(pool, idx);
              const label = ph.getLabel(pool, idx);
              const algo = ph.getAlgo(pool);
              const isSelected = selectedId === key;

              return (
                <div
                  key={key}
                  className="pool-item"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "45px 1.2fr 1.5fr 1fr 80px",
                    gap: "15px",
                    alignItems: "center",
                    fontSize: "11px",
                    background: isSelected
                      ? "rgba(59, 130, 246, 0.08)"
                      : "rgba(255,255,255,0.02)",
                    padding: "12px 16px",
                    borderRadius: "8px",
                    border: isSelected
                      ? "1px solid rgba(59, 130, 246, 0.4)"
                      : "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div
                    style={{
                      fontWeight: "bold",
                      textAlign: "center",
                      opacity: 0.5,
                    }}
                  >
                    #{idx + 1}
                  </div>
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
                        color: isSelected ? "#60a5fa" : "#f8fafc",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: "9px",
                        textTransform: "uppercase",
                        color: "#60a5fa",
                        opacity: 0.8,
                      }}
                    >
                      {getAlgoDisplayName(algo)}
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
                    <span style={{ opacity: 0.4 }}>host:</span>{" "}
                    {pool.stratumHost || pool.stratumHostname || pool.host}:
                    {pool.stratumPort || pool.port}
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
                    <span style={{ opacity: 0.4 }}>user:</span>{" "}
                    {pool.username || pool.user}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <button
                      className="btn-pro secondary"
                      style={{
                        fontSize: "10px",
                        padding: "4px 8px",
                        borderColor: isSelected ? "#34d399" : "",
                      }}
                      onClick={() => onSelect(key)}
                    >
                      {isSelected ? "Selected" : "Select"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {activePoolSource.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px", opacity: 0.5 }}>
              No pools found.
            </div>
          )}
        </div>
        <div
          className="modal-actions"
          style={{ justifyContent: "flex-end", marginTop: "15px" }}
        >
          <button
            className="btn-pro secondary"
            onClick={() => setConnectionModalOpen(false)}
          >
            Close
          </button>
        </div>
      </Modal>
      {/* Error Details Modal */}
      <Modal
        isOpen={errorModalOpen}
        onClose={() => setErrorModalOpen(false)}
        title="Failed Pool Verifications"
        maxWidth="900px"
      >
        <div style={{ maxHeight: "70vh", overflowY: "auto", padding: "5px" }}>
          {failResults.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", opacity: 0.5 }}>
              No errors to show.
            </div>
          ) : (
            <table
              className="pro-table"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
              }}
            >
              <thead>
                <tr
                  style={{
                    opacity: 0.6,
                    fontSize: "11px",
                    borderBottom: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <th style={{ padding: "12px 10px" }}>Pool Name</th>
                  <th style={{ padding: "12px 10px" }}>Algorithm</th>
                  <th style={{ padding: "12px 10px" }}>Error Message</th>
                </tr>
              </thead>
              <tbody>
                {failResults.map((item, idx) => {
                  const algo = item.algorithm || ph.getVerifyAlgo(item.result);
                  return (
                    <tr
                      key={item.key || idx}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        fontSize: "11px",
                      }}
                    >
                      <td
                        style={{
                          padding: "10px",
                          fontWeight: "bold",
                          color: "#f8fafc",
                        }}
                      >
                        {item.label}
                      </td>
                      <td
                        style={{
                          padding: "10px",
                          color: "#60a5fa",
                          fontFamily: "monospace",
                        }}
                      >
                        {getAlgoDisplayName(algo)}
                      </td>
                      <td style={{ padding: "10px", color: "#f87171" }}>
                        {ph.getVerifyMessage(item.result)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div
          className="modal-actions"
          style={{ marginTop: "20px", justifyContent: "flex-end" }}
        >
          <button
            className="btn-pro secondary"
            onClick={() => setErrorModalOpen(false)}
          >
            Close Summary
          </button>
        </div>
      </Modal>
      {/* Inspection Modal */}
      <Modal
        isOpen={!!inspectData}
        onClose={() => setInspectData(null)}
        title="Verification Details"
        maxWidth="900px"
      >
        <pre
          className="response-body"
          style={{ maxHeight: "70vh", overflow: "auto" }}
        >
          {JSON.stringify(inspectData, null, 2)}
        </pre>
      </Modal>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        accept=".xlsx"
        onChange={handleImportXlsx}
      />
    </div>
  );
}