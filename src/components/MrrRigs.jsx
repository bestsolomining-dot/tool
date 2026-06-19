import { useState, useEffect, useMemo, useContext } from "react";
import { poolApi } from "../core/poolUtils";
import { normalizeAlgoForNiceHash, getAlgoDisplayName } from "../core/mapping";
import { getBtcPriceData as getBtcPriceDataUtils } from "../core/priceUtils";
import { NiceHashOrderContext } from "./NiceHashContext";
import MrrRigCard from "./MrrRigCard";
import { TelegramTemplates } from "../core/telegram.js";
import { calculateRemainingTime } from "../core/time";
import {
  findRigArray,
  getNiceHashPriceValue,
  getRawHashrate,
  getRentalAlgorithm,
  getRentalAdvertisedHashrate,
  getRentalAverageHashrate,
  getPriceDataLocal,
  getRentalEfficiency,
  getStatusClass,
  parsePriceValueLocal,
} from "../core/mrrUtils";

export default function MrrRigs({
  onCall,
  mrrClient,
  onOpenPool,
  onOpenCompletionCalculator,
  onInfo,
  endpoint = "/rig/mine",
  algo,
  initialStatus = "available",
  onSummaryUpdate,
}) {
  const nhContext = useContext(NiceHashOrderContext);
  const nhOrders = nhContext?.nicehashOrders || [];
  const [rigs, setRigs] = useState([]);
  const [userRigIds, setUserRigIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [enrichedInfo, setEnrichedInfo] = useState({}); // rigId -> details object
  const [loadingInfoIds, setLoadingInfoIds] = useState(new Set());
  const [algoMarketPrices, setAlgoMarketPrices] = useState({}); // algoName -> priceData
  const [coinPrices, setCoinPrices] = useState({}); // coinId -> CoinGecko price data

  const [expandedPools, setExpandedPools] = useState(new Set());
  const togglePoolInfo = (rigId) => {
    setExpandedPools((prev) => {
      const next = new Set(prev);
      if (next.has(rigId)) next.delete(rigId);
      else next.add(rigId);
      return next;
    });
  };

  const [expandedAlgos, setExpandedAlgos] = useState({}); // algoKey -> boolean
  // More granular status filtering: 'available', 'rented', or 'all'
  const [statusFilter, setStatusFilter] = useState(
    endpoint === "/rig" ? initialStatus : "rented",
  );

  const filteredRigs = useMemo(() => {
    return rigs.filter((rig) => {
      // Hide rigs that do not have a designated client handle to prevent signature errors,
      // unless we are specifically browsing the public Marketplace.
      if (endpoint !== "/rig" && !rig.mrrClient && !rig.client) return false;

      if (statusFilter === "all") return true;
      const statusValue =
        typeof rig.status === "object" ? rig.status.status : rig.status;
      return String(statusValue || "")
        .toLowerCase()
        .includes(statusFilter);
    });
  }, [rigs, statusFilter]);

  const groupedRigs = useMemo(() => {
    const groups = {};
    filteredRigs.forEach((rig) => {
      const info = enrichedInfo[rig.id];
      const algoKey = (
        info?.algo ||
        rig.algo ||
        rig.algorithm ||
        rig.type ||
        "N/A"
      ).toUpperCase();
      if (!groups[algoKey]) groups[algoKey] = [];
      groups[algoKey].push(rig);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRigs, enrichedInfo]);

  const stats = useMemo(() => {
    return {
      total: rigs.length,
      available: rigs.filter((r) =>
        String(typeof r.status === "object" ? r.status.status : r.status || "")
          .toLowerCase()
          .includes("available"),
      ).length,
      rented: rigs.filter((r) =>
        String(typeof r.status === "object" ? r.status.status : r.status || "")
          .toLowerCase()
          .includes("rented"),
      ).length,
      offline: rigs.filter((r) =>
        String(typeof r.status === "object" ? r.status.status : r.status || "")
          .toLowerCase()
          .includes("offline"),
      ).length,
      disabled: rigs.filter((r) =>
        String(typeof r.status === "object" ? r.status.status : r.status || "")
          .toLowerCase()
          .includes("disabled"),
      ).length,
      online: rigs.filter((r) => {
        const s = String(
          typeof r.status === "object" ? r.status.status : r.status || "",
        ).toLowerCase();
        return !s.includes("offline") && !s.includes("disabled");
      }).length,
    };
  }, [rigs]);

  const fullSummaryData = useMemo(() => {
    // Generate summary from full rig list, ignoring current UI status filters
    const onlineRigs = rigs.filter((r) => {
      const s = String(
        typeof r.status === "object" ? r.status.status : r.status || "",
      ).toLowerCase();
      return !s.includes("offline") && !s.includes("disabled");
    });

    const activeRentalLines = rigs
      .filter((rig) => {
        const info = enrichedInfo[rig.id] || {};
        const rawAds =
          info?.rawAds ||
          getRawHashrate(rig.hashrate?.advertised || rig.advertised) ||
          0;
        if (!info || rawAds <= 0) return false; // Ensure we have details and valid hashrate before including
        const endT = rig.end
          ? new Date(
              rig.end + (String(rig.end).endsWith("UTC") ? "" : " UTC"),
            ).getTime()
          : 0;
        const hasFutureEnd = endT > Date.now();
        const s = String(
          typeof rig.status === "object" ? rig.status.status : rig.status || "",
        ).toLowerCase();
        const isActiveStatus = s.includes("rented") || s.includes("active");
        return isActiveStatus && hasFutureEnd;
      })
      .map((rig) => {
        const info = enrichedInfo[rig.id];
        // Provide fallbacks if enriched info is still loading
        const algo =
          info?.algo || rig.algo || rig.algorithm || rig.type || "N/A";
        const rawEffNum =
          info?.percent || rig.hashrate?.average?.percent || rig.percent || 0;
        const effNum = Number.isFinite(parseFloat(rawEffNum))
          ? parseFloat(rawEffNum)
          : 0;

        const efficiency = effNum; // Pass as number to avoid .toFixed errors in template
        const rawRoi = 100 - effNum;
        const roi = Number.isFinite(rawRoi) ? rawRoi : 0;

        const rawAvg =
          info?.rawAvg ||
          getRawHashrate(rig.hashrate?.average || rig.average || rig.hash) ||
          0;
        const avg = Number.isFinite(parseFloat(rawAvg))
          ? parseFloat(rawAvg)
          : 0;
        const rawAds =
          info?.rawAds ||
          getRawHashrate(rig.hashrate?.advertised || rig.advertised) ||
          0;
        const ads = Number.isFinite(parseFloat(rawAds))
          ? parseFloat(rawAds)
          : 0;
        const rawCur = info?.rawCur || rig.hashrate?.current || 0;
        const cur = Number.isFinite(parseFloat(rawCur))
          ? parseFloat(rawCur)
          : 0;

        // Improved target hashrate calculation with manual fallback for summary accuracy
        const startT = rig.start
          ? new Date(
              rig.start + (String(rig.start).endsWith("UTC") ? "" : " UTC"),
            ).getTime()
          : 0;
        const endT = rig.end
          ? new Date(
              rig.end + (String(rig.end).endsWith("UTC") ? "" : " UTC"),
            ).getTime()
          : 0;
        const totalMs = endT - startT;
        const remainingMs = Math.max(0, endT - Date.now());
        const elapsedMs = Math.max(0, Math.min(Date.now() - startT, totalMs));
        const rawCalcTarget =
          remainingMs > 0 && totalMs > 0
            ? (ads * (totalMs / 1000) - avg * (elapsedMs / 1000)) /
              (remainingMs / 1000)
            : 0;
        const rawTarget = info?.targetHashrate || rawCalcTarget || 0;
        const target = Number.isFinite(parseFloat(rawTarget))
          ? parseFloat(rawTarget)
          : 0; // Ensure target is always a number

        const remaining =
          info?.remainingTimeStr ||
          (info?.endTime
            ? calculateRemainingTime(info.endTime)
            : rig.end
              ? calculateRemainingTime(rig.end)
              : "");
        const account = rig.mrrClient || rig.client || mrrClient || "ALL";

        // Ensure rig.price exists before calling the template function
        let perfEmoji = "⚪";
        if (effNum >= 100) perfEmoji = "💯";
        else if (effNum >= 95) perfEmoji = "🟢";
        else if (effNum >= 70) perfEmoji = "🔵";
        else if (effNum < 50) perfEmoji = "🔴";

        return TelegramTemplates.activeRentalLine(
          perfEmoji,
          algo,
          rig.name || rig.id,
          remaining,
          efficiency,
          roi,
          avg,
          ads,
          cur,
          target,
          "", // extra
          account, // client
          {
            price: {
              paid: (rig.price?.paid || 0).toFixed(8),
              currency: rig.price?.currency || "BTC",
            },
          }, // info
        );
      })
      .filter(Boolean);

    const algoGroups = {};
    onlineRigs.forEach((rig) => {
      const algo = (
        rig.algo ||
        rig.algorithm ||
        rig.type ||
        "N/A"
      ).toUpperCase();
      algoGroups[algo] = (algoGroups[algo] || 0) + 1;
    });

    const onlineAlgoLines = Object.entries(algoGroups)
      .sort(([, countA], [, countB]) => countB - countA)
      .map(([name, count]) => `• ${getAlgoDisplayName(name)}: ${count}`);

    return {
      onlineAll: stats.online,
      offlineAll: stats.offline,
      totalAll: stats.total,
      disabledAll: stats.disabled,
      rentedAll: stats.rented,
      onlineAlgoLines,
      activeRentalLines,
      monitorTime: new Date().toLocaleTimeString(),
    };
  }, [stats, rigs, enrichedInfo, mrrClient]);

  useEffect(() => {
    if (onSummaryUpdate) onSummaryUpdate(fullSummaryData);
  }, [fullSummaryData, onSummaryUpdate]);

  // Debug count to see if items are being filtered out
  const totalFetchedCount = rigs.length;

  // Fetch CoinGecko prices for mining coins periodically
  useEffect(() => {
    const fetchCoinPrices = async () => {
      try {
        const res = await onCall("/api/v2/prices/coingecko", {
          query: {
            ids: "bitcoin,ethereum,ethereum-classic,litecoin,dogecoin,ravencoin,monero,kaspa,iron-fish,zephyr-protocol,clore-ai,dynex,conflux,ergo",
            vs_currencies: "usd,btc",
          },
          silent: true,
        });
        if (res?.success) setCoinPrices(res.data);
      } catch (err) {
        console.warn("[CoinGecko] Price fetch failed:", err.message);
      }
    };
    fetchCoinPrices();
  }, [onCall]);

  const toggleAlgoGroup = (algo) => {
    setExpandedAlgos((prev) => ({
      ...prev,
      [algo]: !prev[algo],
    }));
  };

  const exportToCsv = () => {
    if (filteredRigs.length === 0) return;

    const headers = [
      "ID",
      "Name",
      "Algorithm",
      "Status",
      "Advertised",
      "Average",
      "Efficiency",
      "Price",
      "Currency",
      "Price BTC",
      "Started",
      "Remaining",
    ];
    const rows = filteredRigs.map((rig) => {
      const info = enrichedInfo[rig.id];
      const statusValue =
        typeof rig.status === "object" ? rig.status.status : rig.status;
      const algo = info?.algo || rig.algo || rig.algorithm || rig.type || "N/A";
      const advertised = info?.advertised || getRentalAdvertisedHashrate(rig);
      const average = info?.average || getRentalAverageHashrate(rig);
      const efficiency =
        info?.percent || rig.hashrate?.average?.percent || rig.percent || 0;
      const priceData = getPriceDataLocal(
        rig.price || info?.price || rig.min_price,
      );

      const btcPriceData = getBtcPriceDataUtils(
        rig.price || info?.price || rig.min_price,
      );

      const BASE_UNIT_FACTOR = 1000;
      const isEquihash = algo.toLowerCase() === "equihash";
      const priceBtcRate = isEquihash
        ? btcPriceData.value
        : btcPriceData.value * BASE_UNIT_FACTOR;

      const startTime = info?.startTime || rig.start;
      const endTime =
        info?.endTime ||
        rig.end ||
        (typeof rig.status === "object" ? rig.status.end : null);

      return [
        rig.id,
        `"${(rig.name || "").replace(/"/g, '""')}"`,
        algo,
        statusValue,
        advertised,
        average,
        `${efficiency}%`,
        priceData.value,
        priceData.currency,
        priceBtcRate.toFixed(8),
        startTime || "N/A",
        endTime || "N/A",
      ];
    });
    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `rigs_${mrrClient}_${new Date().toISOString().slice(0, 10)}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchRigs = async () => {
    setLoading(true);
    setError("");
    try {
      // 1. Prepare parameters for Marketplace
      const params = { endpoint };

      if (endpoint === "/rig") {
        if (algo) params.algo = String(algo).trim();

        // Server-side status filtering for the Marketplace
        if (statusFilter !== "all") {
          params.status = statusFilter;
        }
      }

      const result = await poolApi.mrrRigs(mrrClient, endpoint, params);

      if (result.ok) {
        const rigList = findRigArray(result.data);

        // Ensure rigs are tagged with the current client handle in non-aggregate views
        if (mrrClient && mrrClient !== "VN" && mrrClient !== "ALL") {
          rigList.forEach((r) => {
            if (!r.mrrClient) r.mrrClient = mrrClient;
          });
        }

        // 2. Identify "My Rigs" if in Marketplace view
        if (endpoint === "/rig") {
          const myRigsResult = await poolApi.mrrRigs(mrrClient, "/rig/mine");
          if (myRigsResult.ok) {
            const myRigsPayload =
              myRigsResult.data?.data || myRigsResult.data || [];
            const myRigsArray = Array.isArray(myRigsPayload)
              ? myRigsPayload
              : myRigsPayload.rigs || [];
            const myIds = new Set(
              myRigsArray
                .map((r) => String(r.id || r.rigid || r.rig_id || "").trim())
                .filter(Boolean),
            );
            setUserRigIds(myIds);
          }
        } else {
          setUserRigIds(new Set(rigList.map((r) => String(r.id))));
        }

        setRigs(rigList);
      } else {
        setError(result.data?.message || "Failed to fetch MRR rigs");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRigDetailInfo = async (rig) => {
    const statusStr = String(
      typeof rig.status === "object" ? rig.status.status : rig.status || "",
    ).toLowerCase();
    const isRented =
      statusStr.includes("rented") || statusStr.includes("active");

    // Extract physical Rig ID and Rental ID correctly for fetching detailed info
    const rigId =
      rig.rigid || rig.rig_id || rig.rig?.id || (isRented ? "" : rig.id);
    const rentalId =
      rig.rentalid ||
      rig.current_rental_id ||
      rig.rental_id ||
      (isRented ? rig.id : "");

    const effectiveClient = rig.mrrClient || rig.client || mrrClient;

    if (typeof onCall !== "function") {
      console.error(
        "fetchRigDetailInfo: onCall is not a function. Check prop passing in parent component.",
      );
      return;
    }

    setLoadingInfoIds((prev) => new Set(prev).add(rig.id));
    try {
      const path =
        isRented && rentalId
          ? `/api/v2/mrr/rental/${encodeURIComponent(rentalId)}`
          : `/api/v2/mrr/rig/${encodeURIComponent(rigId || rig.id)}/info`;

      const data = await onCall(path, {
        query: { client: rig.mrrClient || mrrClient },
        silent: true,
        background: true, // Use background mode to avoid interrupting the user
      });

      if (data && !data.error) {
        let infoBoxData;
        if (isRented && rentalId) {
          const rental = data.data || data;
          const pools = rental.pools || [];
          const firstPool = pools[0];
          const normalized = rental.normalized;

          // Normalize NH data if present in rental info
          const nhPriceData =
            rental.nicehashPrice?.price || rental.nicehashPrice;

          infoBoxData = {
            stratumHost:
              firstPool?.host ||
              firstPool?.stratumHost ||
              firstPool?.stratumHostname ||
              rental.rig?.stratumHost ||
              rental.rig?.host ||
              rental.rig?.stratumHostname ||
              "N/A",
            stratumPort:
              firstPool?.port ||
              firstPool?.stratumPort ||
              rental.rig?.stratumPort ||
              rental.rig?.port ||
              "",
            username:
              firstPool?.user ||
              firstPool?.username ||
              rental.rig?.username ||
              rental.rig?.user ||
              "N/A",
            algo: normalized?.algo || getRentalAlgorithm(rental),
            percent: normalized?.percent || getRentalEfficiency(rental),
            startTime:
              normalized?.startTime || rental.start || rental.start_time || "",
            endTime: normalized?.endTime || rental.end || rental.end_time || "",
            advertised:
              normalized?.niceAdvertisedHashrate ||
              getRentalAdvertisedHashrate(rental), // For display
            average:
              normalized?.niceAverageHashrate ||
              getRentalAverageHashrate(rental), // For display
            current: normalized?.niceHashrate || "0 N/A",
            last5m: normalized?.nice5mHashrate || "0 N/A",
            last15m: normalized?.nice15mHashrate || "0 N/A",
            rawAds: normalized?.hashrate?.advertised || 0,
            rawAvg: normalized?.hashrate?.average || 0,
            rawCur: normalized?.hashrate?.current || 0,
            targetHashrate: normalized?.hashrate?.target || 0,
            hashrate: { suffix: normalized?.hashrate?.suffix || "" },
            pools: pools.map((p) => ({
              host:
                p.host ||
                p.stratumHost ||
                p.stratumHostname ||
                rental.rig?.stratumHost ||
                rental.rig?.host ||
                "N/A",
              port:
                p.port ||
                p.stratumPort ||
                rental.rig?.stratumPort ||
                rental.rig?.port ||
                "N/A",
              username:
                p.user ||
                p.username ||
                rental.rig?.username ||
                rental.rig?.user ||
                "N/A",
            })),
            isRental: true,
            nicehashPrice: nhPriceData,
            price: rental.price, // Add rental price from the API response
            currency: rental.currency || "", // Add rental currency from the API response
            duration: rental.hours || rental.length || rental.duration || 0,
          };
        } else {
          // For rig info, the data is already structured correctly by the backend's extractRigInfo
          infoBoxData = data;
        }
        setEnrichedInfo((prev) => ({ ...prev, [rig.id]: infoBoxData }));
      }
    } catch (err) {
      console.error("Failed to fetch rig info:", err);
    } finally {
      setLoadingInfoIds((prev) => {
        const next = new Set(prev);
        next.delete(rig.id);
        return next;
      });
    }
  };

  useEffect(() => {
    if (mrrClient && endpoint) {
      setEnrichedInfo({}); // Always clear cache when context (client/endpoint) actually changes
      fetchRigs();
    }
  }, [mrrClient, endpoint]);

  // Auto-fetch details for rented rigs so "Started X ago" and "Eff" show up automatically
  useEffect(() => {
    if (loading || typeof onCall !== "function") return;

    let isSubscribed = true;
    let syncTimer = null;

    const syncRentedDetails = async () => {
      const rentedWithoutInfo = filteredRigs.filter((r) => {
        const s = String(
          typeof r.status === "object" ? r.status.status : r.status || "",
        ).toLowerCase();
        return (
          (s.includes("rented") || s.includes("active")) &&
          !enrichedInfo[r.id] &&
          !loadingInfoIds.has(r.id)
        );
      });

      if (isSubscribed && rentedWithoutInfo.length > 0) {
        // Process only one at a time per effect cycle.
        // This staggers requests and prevents nonce collision in the backend.
        await fetchRigDetailInfo(rentedWithoutInfo[0]);
      }
    };

    // Delay the start of background syncing to avoid clashing with the primary rig list fetch
    syncTimer = setTimeout(() => {
      if (isSubscribed) syncRentedDetails();
    }, 1500);

    return () => {
      isSubscribed = false;
      if (syncTimer) clearTimeout(syncTimer);
    };
  }, [filteredRigs, enrichedInfo, loading, loadingInfoIds, onCall]);

  const handleRigStatus = async (rig, targetStatus) => {
    await onCall(`/api/v2/mrr/rig/${rig.id}`, {
      method: "PUT",
      body: { status: targetStatus, name: rig.name },
      query: { client: rig.mrrClient || mrrClient },
      showModal: true,
    });
    // Clear cached details for this rig to force a fresh sync
    setEnrichedInfo((prev) => {
      const next = { ...prev };
      delete next[rig.id];
      return next;
    });
    fetchRigs();
  };

  const handlePriceChange = async (rig) => {
    const currentPrice = rig.price || rig.min_price || "0";
    const newPrice = window.prompt(
      `Enter new price for rig "${rig.name}" (BTC/Unit/Day):`,
      currentPrice,
    );
    if (newPrice === null || newPrice === "" || newPrice === currentPrice)
      return;

    await onCall(`/api/v2/mrr/rig/${rig.id}`, {
      method: "PUT",
      body: {
        price: newPrice,
        name: rig.name,
      },
      query: { client: rig.mrrClient || mrrClient },
      showModal: true,
    });
    // Clear cached details for this rig to force a fresh sync
    setEnrichedInfo((prev) => {
      const next = { ...prev };
      delete next[rig.id];
      return next;
    });
    fetchRigs();
  };

  const handleBulkRigStatus = async (rigsToUpdate, targetStatus) => {
    const ownedRigs = rigsToUpdate.filter((r) => userRigIds.has(String(r.id)));
    if (ownedRigs.length === 0) return;

    const rigIds = ownedRigs.map((r) => r.id).join(";");
    await onCall(`/api/v2/mrr/rig/${rigIds}`, {
      method: "PUT",
      body: { status: targetStatus },
      query: { client: ownedRigs[0].mrrClient || mrrClient },
      showModal: true,
    });
    fetchRigs();
  };

  return (
    <div className="mrr-rigs-dashboard">
      <div
        className="panel-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: "15px",
        }}
      >
        <h2 style={{ margin: 5 }}>
          {endpoint === "/rig" ? "MRR Marketplace" : "RIGS  "} ({mrrClient})
          <small style={{ opacity: 0.3 }}>
            : {filteredRigs.length} / {totalFetchedCount} rigs{" "}
            {algo && `for ${algo}`}
          </small>
          <select
            className="select-pro"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              fontSize: "11px",
              padding: "5px 5px 3px 6px",
              height: "30px",
              minWidth: "100px",
              marginTop: "5px",
            }}
          >
            <option value="all">All Statuses</option>
            <option value="available">Available</option>
            <option value="offline">Offline</option>
            <option value="rented">Rented</option>
            <option value="disabled">Disabled</option>
          </select>
        </h2>
        <button
          className="btn-pro secondary"
          onClick={fetchRigs}
          disabled={loading}
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
            padding: "6px 12px",
            fontSize: "11px",
            height: "30px",
            color: loading ? "#9ca3af" : "#f87171",
            borderColor: loading ? "#9ca3af" : "#f87171",
            background: "transparent",
            transition: "all 0.2s ease",
            borderRadius: "6px",
            opacity: loading ? 0.5 : 1,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          className="error-message"
          style={{
            margin: "15px 0",
            padding: "12px",
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid #ef4444",
            borderRadius: "6px",
            color: "#f87171",
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Status Dashboard */}
      <div
        className="rigs-summary-bar"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(20px, 1fr))",
          gap: "10px",
          marginBottom: "3px",
        }}
      >
        <div
          className="stat-card-mini"
          style={{
            maxWidth: "120px",
            background: "rgba(255,255,255,0.03)",
            padding: "12px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              opacity: 0.5,
              textTransform: "uppercase",
            }}
          >
            Total
          </div>
          <div style={{ fontSize: "18px", fontWeight: "bold" }}>
            {stats.total}
          </div>
        </div>
        <div
          className="stat-card-mini"
          style={{
            maxWidth: "120px",
            background: "rgba(255,255,255,0.03)",
            padding: "12px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#10b981",
              textTransform: "uppercase",
            }}
          >
            Available
          </div>
          <div
            style={{ fontSize: "18px", fontWeight: "bold", color: "#10b981" }}
          >
            {stats.available}
          </div>
        </div>
        <div
          className="stat-card-mini"
          style={{
            maxWidth: "120px",
            background: "rgba(167, 139, 250, 0.05)",
            padding: "12px",
            borderRadius: "8px",
            border: "1px solid rgba(167, 139, 250, 0.2)",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#a78bfa",
              textTransform: "uppercase",
            }}
          >
            Rented
          </div>
          <div
            style={{ fontSize: "18px", fontWeight: "bold", color: "#a78bfa" }}
          >
            {stats.rented}
          </div>
        </div>
        <div
          className="stat-card-mini"
          style={{
            maxWidth: "120px",
            background: "rgba(255, 255, 255, 0.03)",
            padding: "12px",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.05)",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#f87171",
              textTransform: "uppercase",
            }}
          >
            Offline
          </div>
          <div
            style={{ fontSize: "18px", fontWeight: "bold", color: "#f87171" }}
          >
            {stats.offline}
          </div>
        </div>
        <div
          className="stat-card-mini"
          style={{
            maxWidth: "120px",
            background: "rgba(255, 255, 255, 0.03)",
            padding: "12px",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.05)",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#861504",
              textTransform: "uppercase",
            }}
          >
            Disabled
          </div>
          <div
            style={{ fontSize: "18px", fontWeight: "bold", color: "#8f0202" }}
          >
            {stats.disabled}
          </div>
        </div>
      </div>

      <div
        className="rig-list"
        style={{
          marginTop: "5px",
          position: "relative",
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          maxHeight: "auto",
          paddingRight: "2px",
        }}
      >
        {filteredRigs.length === 0 && !loading && !error && (
          <div style={{ opacity: 0.5, textAlign: "center", padding: "20px" }}>
            No rigs found for this account.
          </div>
        )}

        <div
          className="rig-grid-container"
          style={{
            // minHeight: '1200px',
            // maxHeight: 'auto',
            overflowY: "auto",
            paddingRight: "6px",
            // overscrollBehavior: 'contain',
          }}
        >
          {groupedRigs.map(([algoName, rigsInGroup]) => {
            const isExpanded = expandedAlgos[algoName];
            return (
              <div
                key={algoName}
                className="algo-group-container"
                style={{ marginBottom: "10px" }}
              >
                <div
                  className="algo-group-header"
                  onClick={() => toggleAlgoGroup(algoName)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 15px",
                    background: isExpanded
                      ? "rgba(59, 130, 246, 0.15)"
                      : "rgba(255,255,255,0.03)",
                    borderRadius: "6px",
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.05)",
                    transition: "all 0.2s ease",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "14px",
                        color: isExpanded ? "#60a5fa" : "#94a3b8",
                        fontWeight: "bold",
                      }}
                    >
                      {getAlgoDisplayName(algoName)}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        background: "rgba(0,0,0,0.3)",
                        padding: "2px 8px",
                        borderRadius: "10px",
                        opacity: 0.7,
                      }}
                    >
                      {rigsInGroup.length} Rigs
                    </span>
                    {rigsInGroup.some((r) => userRigIds.has(String(r.id))) && (
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          marginLeft: "10px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="btn-pro secondary"
                          style={{
                            fontSize: "10px",
                            color: "#10b981",
                            fontWeight: "bold",
                          }}
                          onClick={() =>
                            handleBulkRigStatus(rigsInGroup, "available")
                          }
                        >
                          Enable All
                        </button>
                        {/* <button className="btn-pro secondary" style={{ fontSize: '10px', color: '#f87171', fontWeight: 'bold' }} onClick={() => handleBulkRigStatus(rigsInGroup, 'disabled')}>
                          Disable All
                        </button> */}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: "12px", opacity: 0.5 }}>
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>

                {isExpanded && (
                  <div
                    className="rig-grid"
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(280px, 1fr))",
                      gap: "12px",
                      padding: "10px 5px",
                    }}
                  >
                    {rigsInGroup.map((rig) => (
                      <MrrRigCard
                        key={rig.id}
                        rig={rig}
                        algoName={algoName}
                        info={enrichedInfo[rig.id]}
                        isMine={rig.id && userRigIds.has(String(rig.id))}
                        mrrClient={mrrClient}
                        nhOrders={nhOrders}
                        coinPrices={coinPrices}
                        onOpenPool={onOpenPool}
                        fetchRigDetailInfo={fetchRigDetailInfo}
                        loadingInfoIds={loadingInfoIds}
                        handleRigStatus={handleRigStatus}
                        handlePriceChange={handlePriceChange}
                        expandedPools={expandedPools}
                        togglePoolInfo={togglePoolInfo}
                        setEnrichedInfo={setEnrichedInfo}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
