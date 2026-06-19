const { useEffect, useMemo, useState } = React;
const HASH_UNITS = ["H", "KH", "MH", "GH", "TH", "PH", "EH", "ZH"];
const SOL_UNITS = ["Sol", "KSol", "MSol", "GSol", "TSol", "PSol", "ESol"];
const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatHashrate = (value, algo) => {
  if (!value || isNaN(value)) {
    return {
      display: "0.00 H/s",
    };
  }
  const isSol =
    algo &&
    (algo.toUpperCase().includes("SOL") ||
      ["EQUIHASH", "ZHASH", "BEAMV3", "BEAM"].includes(algo.toUpperCase()));
  const units = isSol ? SOL_UNITS : HASH_UNITS;
  let idx = 0;
  let scaled = parseFloat(value);
  while (scaled >= 1000 && idx < units.length - 1) {
    scaled /= 1000;
    idx += 1;
  }
  return {
    display: `${scaled.toFixed(2)} ${units[idx]}/s`,
  };
};
const formatDecimal = (value, digits = 8) => {
  const num = toNumber(value);
  if (!num) return `0.${"0".repeat(digits)}`;
  if (Math.abs(num) >= 1) return num.toFixed(Math.min(4, digits));
  return num.toFixed(digits);
};
const formatMoney = (value) => {
  const num = toNumber(value);
  if (!num) return "$0.00";
  if (num >= 1)
    return `$${num.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}`;
  return `$${num.toFixed(8)}`;
};
const formatRoi = (value) => {
  const num = toNumber(String(value).replace("%", ""));
  return `${num.toFixed(2)}%`;
};
const cleanText = (value) => String(value || "").trim();
const safeClass = (...classes) => classes.filter(Boolean).join(" ");
const Card = ({ className = "", children }) =>
  /*#__PURE__*/ React.createElement(
    "div",
    {
      className: safeClass(
        "rounded-[1.5rem] border border-slate-800/70 bg-slate-950/50 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-2xl",
        className,
      ),
    },
    children,
  );
const Badge = ({ children, className = "", title }) =>
  /*#__PURE__*/ React.createElement(
    "span",
    {
      title: title,
      className: safeClass(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] backdrop-blur-sm",
        className,
      ),
    },
    children,
  );
const MetricCard = ({
  label,
  value,
  hint,
  accent = "text-cyan-300",
  border = "border-slate-800/70",
}) =>
  /*#__PURE__*/ React.createElement(
    Card,
    {
      className: safeClass(
        "p-4 transition-transform duration-200 hover:-translate-y-0.5",
        border,
      ),
    },
    /*#__PURE__*/ React.createElement(
      "p",
      {
        className:
          "text-[10px] font-semibold uppercase tracking-[0.34em] text-slate-500",
      },
      label,
    ),
    /*#__PURE__*/ React.createElement(
      "div",
      {
        className: "mt-3 flex items-end justify-between gap-3",
      },
      /*#__PURE__*/ React.createElement(
        "div",
        null,
        /*#__PURE__*/ React.createElement(
          "p",
          {
            className: safeClass(
              "text-2xl font-black tracking-tight md:text-[2rem]",
              accent,
            ),
          },
          value,
        ),
        /*#__PURE__*/ React.createElement(
          "p",
          {
            className: "mt-1 text-xs leading-5 text-slate-400",
          },
          hint,
        ),
      ),
    ),
  );
const PriceCard = ({ symbol, price }) =>
  /*#__PURE__*/ React.createElement(
    "div",
    {
      className:
        "rounded-2xl border border-slate-800/70 bg-slate-950/60 p-3 transition-colors hover:border-emerald-500/30",
    },
    /*#__PURE__*/ React.createElement(
      "p",
      {
        className:
          "truncate text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500",
      },
      symbol,
    ),
    /*#__PURE__*/ React.createElement(
      "p",
      {
        className: "mt-2 font-mono text-sm text-emerald-300",
      },
      formatMoney(price),
    ),
  );
const PoolSection = ({ title, tone = "cyan", rates, label = "BTC/day" }) => {
  const entries = Object.entries(rates || {});
  if (!entries.length) return null;
  const toneMap = {
    cyan: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/30",
    violet: "bg-violet-500/10 text-violet-300 border-violet-500/30",
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    rose: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  };
  return /*#__PURE__*/ React.createElement(
    Card,
    {
      className: "p-5",
    },
    /*#__PURE__*/ React.createElement(
      "div",
      {
        className: "mb-4 flex items-center justify-between gap-3",
      },
      /*#__PURE__*/ React.createElement(
        "div",
        null,
        /*#__PURE__*/ React.createElement(
          "p",
          {
            className:
              "text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500",
          },
          "Provider benchmark",
        ),
        /*#__PURE__*/ React.createElement(
          "h3",
          {
            className:
              "mt-1 text-sm font-bold uppercase tracking-[0.22em] text-slate-200",
          },
          title,
        ),
      ),
      /*#__PURE__*/ React.createElement(
        Badge,
        {
          className: toneMap[tone] || toneMap.cyan,
        },
        label,
      ),
    ),
    /*#__PURE__*/ React.createElement(
      "div",
      {
        className: "grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4",
      },
      entries.map(([symbol, rate]) =>
        /*#__PURE__*/ React.createElement(
          "div",
          {
            key: symbol,
            className:
              "rounded-2xl border border-slate-800/70 bg-slate-950/55 p-3",
          },
          /*#__PURE__*/ React.createElement(
            "p",
            {
              className:
                "text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500",
            },
            symbol,
          ),
          /*#__PURE__*/ React.createElement(
            "p",
            {
              className: "mt-2 font-mono text-sm text-slate-200",
            },
            formatDecimal(rate),
          ),
        ),
      ),
    ),
  );
};
function App() {
  const [data, setData] = useState({
    opportunities: [],
    aiModel: {
      ready: false,
      trained: false,
      samples: 0,
      trainAccuracy: 0,
      validationAccuracy: 0,
      lastTrainedAt: null,
      featureImportance: [],
    },
    btcPrice: 0,
    coinPrices: {},
    coingeckoRates: {},
    coinpaprikaRates: {},
    mexcRates: {},
    xeggexRates: {},
    k1PoolRates: {},
    zpoolRates: {},
    whattomineRates: {},
    minerstatRates: {},
    hashrateNoRates: {},
    algoMap: {},
    symbolMap: {},
    coinCatalog: [],
    coverageSummary: {
      totalCoins: 0,
      withNiceHash: 0,
      withMinerstat: 0,
      withK1Pool: 0,
      withHashrateNo: 0,
      withWhatToMine: 0,
      withZpool: 0,
    },
    sourceStatus: {},
    timestamp: null,
  });
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAlgo, setSelectedAlgo] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const fetchData = async (forceRefresh = false) => {
    setRefreshing(true);
    try {
      const url = forceRefresh
        ? "/api/opportunities?refresh=1"
        : "/api/opportunities";
      const response = await fetch(url);
      const json = await response.json();
      setData(json);
      setInitializing(Boolean(json.initializing));
      setExpandedRows(new Set());
    } catch (error) {
      console.error("API Error:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);
  const toggleRow = (idx) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };
  const sourceStatusEntries = useMemo(
    () => Object.entries(data.sourceStatus || {}),
    [data.sourceStatus],
  );
  const uniqueAlgos = useMemo(() => {
    return Array.from(
      new Set((data.opportunities || []).map((opp) => opp.Algorithm)),
    ).sort();
  }, [data.opportunities]);
  const filteredOpportunities = useMemo(() => {
    let filtered = [...(data.opportunities || [])];
    if (selectedAlgo) {
      filtered = filtered.filter((opp) => opp.Algorithm === selectedAlgo);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (opp) =>
          cleanText(opp.Algorithm).toLowerCase().includes(term) ||
          cleanText(opp.Coin).toLowerCase().includes(term) ||
          cleanText(opp.Source).toLowerCase().includes(term) ||
          cleanText(opp.Market).toLowerCase().includes(term),
      );
    }
    return filtered.sort((a, b) => {
      const aiA = toNumber(a.aiScore);
      const aiB = toNumber(b.aiScore);
      if (aiB !== aiA) return aiB - aiA;
      const roiA = toNumber(String(a.roi).replace("%", ""));
      const roiB = toNumber(String(b.roi).replace("%", ""));
      if (roiB !== roiA) return roiB - roiA;
      const profitA = toNumber(a["Est. Profit/Unit/Day"]);
      const profitB = toNumber(b["Est. Profit/Unit/Day"]);
      if (profitB !== profitA) return profitB - profitA;
      return toNumber(b["Paying Rate"]) - toNumber(a["Paying Rate"]);
    });
  }, [data.opportunities, searchTerm, selectedAlgo]);
  const filteredCoins = useMemo(() => {
    let coins = [...(data.coinCatalog || [])];
    if (selectedAlgo) {
      coins = coins.filter((coin) =>
        (coin.algorithms || []).includes(selectedAlgo),
      );
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      coins = coins.filter(
        (coin) =>
          cleanText(coin.symbol).toLowerCase().includes(term) ||
          cleanText(coin.coinId).toLowerCase().includes(term) ||
          (coin.algorithms || []).some((algo) =>
            algo.toLowerCase().includes(term),
          ),
      );
    }
    return coins;
  }, [data.coinCatalog, searchTerm, selectedAlgo]);
  const topOpportunity = filteredOpportunities[0] || null;
  const profitableCount = filteredOpportunities.filter(
    (opp) => toNumber(String(opp.roi).replace("%", "")) > 0,
  ).length;
  const roiValues = filteredOpportunities
    .map((opp) => toNumber(String(opp.roi).replace("%", "")))
    .filter((value) => Number.isFinite(value));
  const medianRoi = roiValues.length
    ? [...roiValues].sort((a, b) => a - b)[Math.floor(roiValues.length / 2)]
    : 0;
  const healthySources = sourceStatusEntries.filter(
    ([, status]) => status && status.ok,
  ).length;
  const minerstatStatus = data.sourceStatus?.minerstat;
  const minerstatQuotaIssue = Boolean(
    minerstatStatus &&
    !minerstatStatus.ok &&
    /402|quota|monthly/i.test(String(minerstatStatus.message || "")),
  );
  const aiModel = data.aiModel || {};
  const aiModelReady = Boolean(aiModel.ready);
  const getSourceStyle = (source) => {
    const map = {
      CoinGecko: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
      CoinPaprika: "bg-violet-500/10 text-violet-300 border-violet-500/30",
      MEXC: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
      Xeggex: "bg-amber-500/10 text-amber-300 border-amber-500/30",
      K1Pool: "bg-sky-500/10 text-sky-300 border-sky-500/30",
      Zpool: "bg-orange-500/10 text-orange-300 border-orange-500/30",
      Minerstat: "bg-violet-500/10 text-violet-300 border-violet-500/30",
      "Hashrate.no": "bg-rose-500/10 text-rose-300 border-rose-500/30",
      WhatToMine: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
      NiceHash: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
    };
    return map[source] || "bg-slate-500/10 text-slate-300 border-slate-500/30";
  };
  const hiddenCoins = new Set([
    "SDR",
    "PYI",
    "KLS",
    "CLORE",
    "MEWC",
    "NEVO",
    "XNA",
    "AIPG",
    "ZEPH",
    "NEXA",
    "ALPH",
    "IRON",
    "CKB",
    "RVN",
    "BEAM",
    "CFX",
    "ERG",
    "VRSC",
  ]);
  return /*#__PURE__*/ React.createElement(
    "div",
    {
      className: "relative min-h-screen text-slate-100",
    },
    /*#__PURE__*/ React.createElement(
      "div",
      {
        className: "pointer-events-none absolute inset-0 overflow-hidden",
      },
      /*#__PURE__*/ React.createElement("div", {
        className:
          "absolute left-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl",
      }),
      /*#__PURE__*/ React.createElement("div", {
        className:
          "absolute right-[-6rem] top-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl",
      }),
      /*#__PURE__*/ React.createElement("div", {
        className:
          "absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-slate-400/5 blur-3xl",
      }),
    ),
    /*#__PURE__*/ React.createElement(
      "div",
      {
        className: "relative mx-auto max-w-[92rem] px-4 py-6 md:px-6 lg:px-8",
      },
      /*#__PURE__*/ React.createElement(
        "header",
        {
          className:
            "mb-6 overflow-hidden rounded-[2rem] border border-slate-800/70 bg-slate-950/60 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] backdrop-blur-2xl lg:p-8",
        },
        /*#__PURE__*/ React.createElement("div", {
          className:
            "absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/35 to-transparent",
        }),
        /*#__PURE__*/ React.createElement(
          "div",
          {
            className:
              "flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between",
          },
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "max-w-3xl",
            },
            /*#__PURE__*/ React.createElement(
              "div",
              {
                className: "mb-4 flex flex-wrap items-center gap-3",
              },
              /*#__PURE__*/ React.createElement(
                Badge,
                {
                  className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
                },
                "Live market intelligence",
              ),
              /*#__PURE__*/ React.createElement(
                Badge,
                {
                  className:
                    "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
                },
                healthySources,
                " sources online",
              ),
              /*#__PURE__*/ React.createElement(
                Badge,
                {
                  className: "border-slate-700 bg-slate-900/50 text-slate-400",
                },
                "AI ",
                aiModelReady ? "trained" : "warming up",
              ),
            ),
            /*#__PURE__*/ React.createElement(
              "h1",
              {
                className:
                  "max-w-4xl text-4xl font-black tracking-tight text-white md:text-6xl",
              },
              "A professional trading command center for mining opportunities",
            ),
            /*#__PURE__*/ React.createElement(
              "p",
              {
                className:
                  "mt-4 max-w-2xl text-sm leading-7 text-slate-400 md:text-base",
              },
              "Compare NiceHash pricing, pool benchmarks, exchange feeds, and learned AI ranking in one calm, high-signal workspace.",
            ),
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "grid gap-3 sm:grid-cols-3 xl:w-[42rem]",
            },
            /*#__PURE__*/ React.createElement(
              Card,
              {
                className: "p-4",
              },
              /*#__PURE__*/ React.createElement(
                "p",
                {
                  className:
                    "text-[10px] font-semibold uppercase tracking-[0.34em] text-slate-500",
                },
                "BTC price",
              ),
              /*#__PURE__*/ React.createElement(
                "p",
                {
                  className: "mt-2 font-mono text-xl font-bold text-white",
                },
                data.btcPrice ? data.btcPrice.toLocaleString() : "0",
              ),
            ),
            /*#__PURE__*/ React.createElement(
              Card,
              {
                className: "p-4",
              },
              /*#__PURE__*/ React.createElement(
                "p",
                {
                  className:
                    "text-[10px] font-semibold uppercase tracking-[0.34em] text-slate-500",
                },
                "Updated",
              ),
              /*#__PURE__*/ React.createElement(
                "p",
                {
                  className: "mt-2 font-mono text-xl font-bold text-white",
                },
                data.timestamp
                  ? new Date(data.timestamp).toLocaleTimeString()
                  : "--",
              ),
            ),
            /*#__PURE__*/ React.createElement(
              "button",
              {
                onClick: () => fetchData(true),
                className:
                  "rounded-[1.5rem] border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-400/50 hover:bg-emerald-500/15",
              },
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "flex items-center justify-between gap-3",
                },
                /*#__PURE__*/ React.createElement(
                  "div",
                  null,
                  /*#__PURE__*/ React.createElement(
                    "p",
                    {
                      className:
                        "text-[10px] font-semibold uppercase tracking-[0.34em] text-emerald-200",
                    },
                    "Refresh",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "p",
                    {
                      className: "mt-2 text-sm font-medium text-slate-200",
                    },
                    "Force a new market scan",
                  ),
                ),
                /*#__PURE__*/ React.createElement("i", {
                  className: safeClass(
                    "fa-solid fa-rotate text-lg text-emerald-300",
                    refreshing ? "animate-spin" : "",
                  ),
                }),
              ),
            ),
          ),
        ),
        /*#__PURE__*/ React.createElement(
          "div",
          {
            className:
              "mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.5fr_0.9fr_0.9fr]",
          },
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "relative",
            },
            /*#__PURE__*/ React.createElement("i", {
              className:
                "fa-solid fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500",
            }),
            /*#__PURE__*/ React.createElement("input", {
              type: "text",
              placeholder: "Search algo, coin, source, or market...",
              value: searchTerm,
              onChange: (e) => setSearchTerm(e.target.value),
              className:
                "w-full rounded-2xl border border-slate-800/70 bg-slate-950/65 py-3 pl-11 pr-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/20",
            }),
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className:
                "rounded-2xl border border-slate-800/70 bg-slate-950/65 px-4 py-3",
            },
            /*#__PURE__*/ React.createElement(
              "p",
              {
                className:
                  "text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500",
              },
              "Algorithm filter",
            ),
            /*#__PURE__*/ React.createElement(
              "div",
              {
                className: "mt-2 flex flex-wrap gap-2",
              },
              /*#__PURE__*/ React.createElement(
                "button",
                {
                  onClick: () => setSelectedAlgo(null),
                  className: safeClass(
                    "rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em]",
                    selectedAlgo === null
                      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                      : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700",
                  ),
                },
                "All",
              ),
              uniqueAlgos.slice(0, 8).map((algo) =>
                /*#__PURE__*/ React.createElement(
                  "button",
                  {
                    key: algo,
                    onClick: () =>
                      setSelectedAlgo(algo === selectedAlgo ? null : algo),
                    className: safeClass(
                      "rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em]",
                      algo === selectedAlgo
                        ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                        : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700",
                    ),
                  },
                  algo,
                ),
              ),
            ),
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className:
                "rounded-2xl border border-slate-800/70 bg-slate-950/65 px-4 py-3",
            },
            /*#__PURE__*/ React.createElement(
              "p",
              {
                className:
                  "text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500",
              },
              "Scan state",
            ),
            /*#__PURE__*/ React.createElement(
              "div",
              {
                className: "mt-2 flex items-center gap-3",
              },
              /*#__PURE__*/ React.createElement("span", {
                className: safeClass(
                  "h-3 w-3 rounded-full",
                  refreshing
                    ? "bg-cyan-400 animate-pulse"
                    : "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]",
                ),
              }),
              /*#__PURE__*/ React.createElement(
                "div",
                null,
                /*#__PURE__*/ React.createElement(
                  "p",
                  {
                    className: "text-sm font-medium text-slate-200",
                  },
                  loading || initializing
                    ? "Initializing market scan"
                    : "Live market scan ready",
                ),
                /*#__PURE__*/ React.createElement(
                  "p",
                  {
                    className: "text-xs text-slate-500",
                  },
                  filteredOpportunities.length,
                  " opportunities in view",
                ),
              ),
            ),
          ),
        ),
      ),
      /*#__PURE__*/ React.createElement(
        "section",
        {
          className: "mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4",
        },
        /*#__PURE__*/ React.createElement(MetricCard, {
          label: "Opportunities",
          value: filteredOpportunities.length,
          hint: "Current scan results after filtering",
          accent: "text-cyan-300",
        }),
        /*#__PURE__*/ React.createElement(MetricCard, {
          label: "Profitable",
          value: profitableCount,
          hint: "Rows with positive ROI",
          accent: "text-emerald-300",
        }),
        /*#__PURE__*/ React.createElement(MetricCard, {
          label: "Median ROI",
          value: formatRoi(medianRoi),
          hint: "More stable than a raw average for skewed scans",
          accent: "text-amber-300",
        }),
        /*#__PURE__*/ React.createElement(MetricCard, {
          label: "AI model",
          value: aiModelReady
            ? `${Math.round((aiModel.validationAccuracy || 0) * 100)}%`
            : "training",
          hint: aiModelReady
            ? `${aiModel.samples || 0} samples learned from price history`
            : "Waiting for enough history to train",
          accent: "text-violet-300",
        }),
      ),
      /*#__PURE__*/ React.createElement(
        "section",
        {
          className: "grid w-full gap-6",
        },
        /*#__PURE__*/ React.createElement(
          Card,
          {
            className: "overflow-hidden",
          },
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "border-b border-slate-800/70 px-5 py-4 md:px-6",
            },
            /*#__PURE__*/ React.createElement(
              "div",
              {
                className:
                  "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
              },
              /*#__PURE__*/ React.createElement(
                "div",
                null,
                /*#__PURE__*/ React.createElement(
                  "h2",
                  {
                    className:
                      "text-xs font-semibold uppercase tracking-[0.34em] text-slate-300",
                  },
                  "Arbitrage opportunities",
                ),
                /*#__PURE__*/ React.createElement(
                  "p",
                  {
                    className: "mt-1 max-w-xl text-xs text-slate-500",
                  },
                  "Ranked by the TensorFlow model first, then ROI as a fallback.",
                ),
              ),
              /*#__PURE__*/ React.createElement(
                Badge,
                {
                  className: "border-slate-700 bg-slate-950/70 text-slate-400",
                },
                filteredOpportunities.length,
                " visible",
              ),
            ),
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "overflow-x-auto",
            },
            /*#__PURE__*/ React.createElement(
              "table",
              {
                className: "w-full border-collapse text-left table-fixed",
              },
              /*#__PURE__*/ React.createElement(
                "thead",
                {
                  className: "sticky top-0 z-10 bg-slate-950/90 backdrop-blur",
                },
                /*#__PURE__*/ React.createElement(
                  "tr",
                  {
                    className:
                      "border-b border-slate-800/70 text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500",
                  },
                  /*#__PURE__*/ React.createElement("th", {
                    className: "w-8 px-4 py-4",
                  }),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-24 px-4 py-4",
                    },
                    "Algorithm",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-28 px-4 py-4",
                    },
                    "Coin",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-20 px-4 py-4",
                    },
                    "Market",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-24 px-4 py-4",
                    },
                    "Source",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-24 px-4 py-4",
                    },
                    "Market",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-20 px-4 py-4",
                    },
                    "Volume",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-20 px-4 py-4",
                    },
                    "Speed",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-24 px-4 py-4",
                    },
                    "Paying",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-16 px-4 py-4 text-right",
                    },
                    "AI",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-16 px-4 py-4 text-right",
                    },
                    "ROI",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "th",
                    {
                      className: "w-20 px-4 py-4 text-right",
                    },
                    "Profit",
                  ),
                ),
              ),
              /*#__PURE__*/ React.createElement(
                "tbody",
                {
                  className: "divide-y divide-slate-800/60",
                },
                loading || initializing
                  ? /*#__PURE__*/ React.createElement(
                      "tr",
                      null,
                      /*#__PURE__*/ React.createElement(
                        "td",
                        {
                          colSpan: "12",
                          className: "px-6 py-24 text-center text-slate-500",
                        },
                        /*#__PURE__*/ React.createElement("i", {
                          className:
                            "fa-solid fa-circle-notch fa-spin text-3xl text-cyan-400",
                        }),
                        /*#__PURE__*/ React.createElement(
                          "p",
                          {
                            className:
                              "mt-4 text-xs uppercase tracking-[0.3em] text-slate-500",
                          },
                          "Syncing market feeds",
                        ),
                      ),
                    )
                  : filteredOpportunities.length === 0
                    ? /*#__PURE__*/ React.createElement(
                        "tr",
                        null,
                        /*#__PURE__*/ React.createElement(
                          "td",
                          {
                            colSpan: "12",
                            className:
                              "px-6 py-20 text-center text-sm text-slate-400",
                          },
                          "No opportunities found for the current filters.",
                        ),
                      )
                    : filteredOpportunities.map((opp, idx) => {
                        const roiValue = toNumber(
                          String(opp.roi).replace("%", ""),
                        );
                        const isProfitable = roiValue > 0;
                        const isExpanded = expandedRows.has(idx);
                        const speedFormatted = formatHashrate(
                          opp.Speed,
                          opp.Algorithm,
                        );
                        const marketPriceFormatted = formatHashrate(
                          opp["Market Price"],
                          opp.Algorithm,
                        );
                        const payingRateFormatted = formatHashrate(
                          opp["Paying Rate"],
                          opp.Algorithm,
                        );
                        return /*#__PURE__*/ React.createElement(
                          React.Fragment,
                          {
                            key: `${opp.Algorithm}-${opp.Coin}-${idx}`,
                          },
                          /*#__PURE__*/ React.createElement(
                            "tr",
                            {
                              className: safeClass(
                                "cursor-pointer transition-colors hover:bg-slate-900/60",
                                roiValue > 5 ? "bg-emerald-500/[0.03]" : "",
                              ),
                              onClick: () => toggleRow(idx),
                            },
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className:
                                  "px-5 py-4 text-center text-slate-500",
                              },
                              /*#__PURE__*/ React.createElement("i", {
                                className: safeClass(
                                  "fa-solid transition-transform",
                                  isExpanded
                                    ? "fa-chevron-down rotate-180"
                                    : "fa-chevron-right",
                                ),
                              }),
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className: "px-4 py-4",
                              },
                              /*#__PURE__*/ React.createElement(
                                "span",
                                {
                                  className:
                                    "text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300",
                                },
                                opp.Algorithm,
                              ),
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className: "px-4 py-4",
                              },
                              /*#__PURE__*/ React.createElement(
                                "div",
                                {
                                  className: "flex items-center gap-2",
                                },
                                /*#__PURE__*/ React.createElement(
                                  "span",
                                  {
                                    className: "font-semibold text-slate-100",
                                  },
                                  cleanText(opp.Coin).replace("-", " "),
                                ),
                                hiddenCoins.has(opp.Coin) &&
                                  /*#__PURE__*/ React.createElement(
                                    Badge,
                                    {
                                      className:
                                        "border-amber-500/30 bg-amber-500/10 text-amber-300",
                                    },
                                    "Gem",
                                  ),
                              ),
                              opp.CoinId &&
                                /*#__PURE__*/ React.createElement(
                                  "p",
                                  {
                                    className:
                                      "mt-1 text-[10px] text-slate-500",
                                  },
                                  opp.CoinId,
                                ),
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className: "px-4 py-4",
                              },
                              /*#__PURE__*/ React.createElement(
                                Badge,
                                {
                                  className:
                                    "border-slate-700 bg-slate-950/70 text-slate-400",
                                },
                                opp.Market,
                              ),
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className: "px-4 py-4",
                              },
                              /*#__PURE__*/ React.createElement(
                                Badge,
                                {
                                  className: getSourceStyle(opp.Source),
                                  title: opp.RevenueSources
                                    ? Object.entries(opp.RevenueSources)
                                        .map(
                                          ([src, rate]) =>
                                            `${src}: ${formatDecimal(rate)}`,
                                        )
                                        .join("\n")
                                    : "",
                                },
                                opp.Source,
                              ),
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className:
                                  "px-4 py-4 font-mono text-sm text-slate-300",
                              },
                              marketPriceFormatted.display,
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className:
                                  "px-4 py-4 font-mono text-sm text-slate-400",
                              },
                              formatDecimal(opp.Volume, 6),
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className:
                                  "px-4 py-4 font-mono text-sm text-slate-400",
                              },
                              speedFormatted.display,
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className:
                                  "px-4 py-4 font-mono text-sm text-slate-200",
                              },
                              payingRateFormatted.display,
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className:
                                  "px-4 py-4 text-right font-mono text-sm text-cyan-300",
                              },
                              /*#__PURE__*/ React.createElement(
                                "div",
                                null,
                                formatDecimal(opp.aiScore || 0, 2),
                              ),
                              /*#__PURE__*/ React.createElement(
                                "div",
                                {
                                  className:
                                    "mt-1 text-[10px] uppercase tracking-[0.22em] text-slate-500",
                                },
                                opp.aiLabel || "watch",
                                " ",
                                opp.opportunityScore
                                  ? `| raw ${opp.opportunityScore}`
                                  : "",
                              ),
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className: "px-4 py-4 text-right",
                              },
                              /*#__PURE__*/ React.createElement(
                                Badge,
                                {
                                  className: isProfitable
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                    : "border-slate-700 bg-slate-950/70 text-slate-500",
                                },
                                formatRoi(opp.roi),
                              ),
                            ),
                            /*#__PURE__*/ React.createElement(
                              "td",
                              {
                                className: safeClass(
                                  "px-4 py-4 text-right font-mono text-sm",
                                  isProfitable
                                    ? "text-emerald-300"
                                    : "text-slate-500",
                                ),
                              },
                              formatDecimal(opp["Est. Profit/Unit/Day"]),
                            ),
                          ),
                          isExpanded &&
                            opp.Candidates &&
                            /*#__PURE__*/ React.createElement(
                              "tr",
                              {
                                className: "bg-slate-950/50",
                              },
                              /*#__PURE__*/ React.createElement(
                                "td",
                                {
                                  colSpan: "12",
                                  className: "px-5 pb-5 pt-1 md:px-6",
                                },
                                /*#__PURE__*/ React.createElement(
                                  "div",
                                  {
                                    className:
                                      "rounded-2xl border border-slate-800/70 bg-slate-950/80 p-4",
                                  },
                                  /*#__PURE__*/ React.createElement(
                                    "div",
                                    {
                                      className:
                                        "mb-3 flex items-center justify-between gap-3",
                                    },
                                    /*#__PURE__*/ React.createElement(
                                      "div",
                                      null,
                                      /*#__PURE__*/ React.createElement(
                                        "p",
                                        {
                                          className:
                                            "text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500",
                                        },
                                        "Candidate breakdown",
                                      ),
                                      /*#__PURE__*/ React.createElement(
                                        "p",
                                        {
                                          className:
                                            "mt-1 text-sm font-medium text-slate-200",
                                        },
                                        opp.Algorithm,
                                        " routed to the best-paying destination",
                                      ),
                                    ),
                                    /*#__PURE__*/ React.createElement(
                                      Badge,
                                      {
                                        className:
                                          "border-slate-700 bg-slate-950/70 text-slate-400",
                                      },
                                      opp.Candidates.length,
                                      " coin",
                                      opp.Candidates.length !== 1 ? "s" : "",
                                    ),
                                  ),
                                  /*#__PURE__*/ React.createElement(
                                    "div",
                                    {
                                      className: "grid gap-2",
                                    },
                                    opp.Candidates.map((candidate) =>
                                      /*#__PURE__*/ React.createElement(
                                        "div",
                                        {
                                          key: `${candidate.Coin}-${candidate.Source}`,
                                          className:
                                            "flex flex-col gap-2 rounded-2xl border border-slate-800/70 bg-slate-900/50 p-3 md:flex-row md:items-center md:justify-between",
                                        },
                                        /*#__PURE__*/ React.createElement(
                                          "div",
                                          null,
                                          /*#__PURE__*/ React.createElement(
                                            "p",
                                            {
                                              className:
                                                "text-sm font-semibold text-slate-100",
                                            },
                                            candidate.Coin,
                                          ),
                                          /*#__PURE__*/ React.createElement(
                                            "p",
                                            {
                                              className:
                                                "mt-1 text-[10px] uppercase tracking-[0.22em] text-slate-500",
                                            },
                                            candidate.Source,
                                          ),
                                        ),
                                        /*#__PURE__*/ React.createElement(
                                          "div",
                                          {
                                            className:
                                              "flex flex-wrap items-center gap-2",
                                          },
                                          Object.entries(
                                            candidate.RevenueBreakdown || {},
                                          ).map(([source, rate]) =>
                                            /*#__PURE__*/ React.createElement(
                                              Badge,
                                              {
                                                key: source,
                                                className:
                                                  getSourceStyle(source),
                                                title: formatDecimal(rate),
                                              },
                                              source,
                                              " ",
                                              formatDecimal(rate),
                                            ),
                                          ),
                                          /*#__PURE__*/ React.createElement(
                                            Badge,
                                            {
                                              className:
                                                "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                                            },
                                            "Best ",
                                            formatDecimal(candidate.PayingRate),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                        );
                      }),
              ),
            ),
          ),
        ),
        /*#__PURE__*/ React.createElement(
          "details",
          {
            className:
              "rounded-[1.5rem] border border-slate-800/70 bg-slate-950/55 shadow-2xl shadow-black/20",
          },
          /*#__PURE__*/ React.createElement(
            "summary",
            {
              className: "cursor-pointer list-none px-5 py-4 md:px-6",
            },
            /*#__PURE__*/ React.createElement(
              "div",
              {
                className: "flex items-center justify-between gap-3",
              },
              /*#__PURE__*/ React.createElement(
                "div",
                null,
                /*#__PURE__*/ React.createElement(
                  "p",
                  {
                    className:
                      "text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500",
                  },
                  "Compact panel",
                ),
                /*#__PURE__*/ React.createElement(
                  "h3",
                  {
                    className:
                      "mt-1 text-sm font-bold uppercase tracking-[0.22em] text-slate-200",
                  },
                  "Open market details",
                ),
              ),
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "flex items-center gap-2",
                },
                /*#__PURE__*/ React.createElement(
                  Badge,
                  {
                    className:
                      "border-slate-700 bg-slate-950/70 text-slate-400",
                  },
                  healthySources,
                  "/",
                  sourceStatusEntries.length,
                  " live",
                ),
                /*#__PURE__*/ React.createElement("i", {
                  className: "fa-solid fa-chevron-down text-slate-500",
                }),
              ),
            ),
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className:
                "space-y-6 border-t border-slate-800/70 px-5 py-5 md:px-6",
            },
            minerstatQuotaIssue &&
              /*#__PURE__*/ React.createElement(
                Card,
                {
                  className: "border-amber-500/30 bg-amber-500/10 p-5",
                },
                /*#__PURE__*/ React.createElement(
                  "div",
                  {
                    className: "flex items-start gap-3",
                  },
                  /*#__PURE__*/ React.createElement(
                    "div",
                    {
                      className:
                        "mt-0.5 rounded-full border border-amber-500/40 bg-amber-500/20 p-2 text-amber-200",
                    },
                    /*#__PURE__*/ React.createElement("i", {
                      className: "fa-solid fa-triangle-exclamation",
                    }),
                  ),
                  /*#__PURE__*/ React.createElement(
                    "div",
                    null,
                    /*#__PURE__*/ React.createElement(
                      "p",
                      {
                        className:
                          "text-xs font-semibold uppercase tracking-[0.28em] text-amber-200",
                      },
                      "Minerstat quota reached",
                    ),
                    /*#__PURE__*/ React.createElement(
                      "p",
                      {
                        className: "mt-2 text-sm leading-6 text-amber-50/90",
                      },
                      "Minerstat is temporarily disabled for this session because the API returned a quota error. The scanner is still using CoinGecko, CoinPaprika, MEXC, Xeggex, K1Pool, Hashrate.no, WhatToMine, and Zpool where available.",
                    ),
                  ),
                ),
              ),
            /*#__PURE__*/ React.createElement(
              Card,
              {
                className: "p-5",
              },
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "mb-4 flex items-center justify-between gap-3",
                },
                /*#__PURE__*/ React.createElement(
                  "div",
                  null,
                  /*#__PURE__*/ React.createElement(
                    "p",
                    {
                      className:
                        "text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500",
                    },
                    "Feed health",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "h3",
                    {
                      className:
                        "mt-1 text-sm font-bold uppercase tracking-[0.22em] text-slate-200",
                    },
                    "Source status",
                  ),
                ),
                /*#__PURE__*/ React.createElement(
                  Badge,
                  {
                    className:
                      "border-slate-700 bg-slate-950/70 text-slate-400",
                  },
                  healthySources,
                  "/",
                  sourceStatusEntries.length,
                  " online",
                ),
              ),
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "space-y-3",
                },
                sourceStatusEntries.map(([source, status]) =>
                  /*#__PURE__*/ React.createElement(
                    "div",
                    {
                      key: source,
                      className:
                        "flex items-start justify-between gap-4 rounded-2xl border border-slate-800/70 bg-slate-950/55 p-3",
                    },
                    /*#__PURE__*/ React.createElement(
                      "div",
                      {
                        className: "flex items-center gap-3",
                      },
                      /*#__PURE__*/ React.createElement("span", {
                        className: safeClass(
                          "mt-1 h-2.5 w-2.5 rounded-full",
                          status?.ok
                            ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]"
                            : "bg-rose-400",
                        ),
                      }),
                      /*#__PURE__*/ React.createElement(
                        "div",
                        null,
                        /*#__PURE__*/ React.createElement(
                          "p",
                          {
                            className: "text-sm font-semibold text-slate-100",
                          },
                          source,
                        ),
                        /*#__PURE__*/ React.createElement(
                          "p",
                          {
                            className: "mt-1 text-xs text-slate-500",
                          },
                          status?.message || "unknown",
                        ),
                      ),
                    ),
                    /*#__PURE__*/ React.createElement(
                      Badge,
                      {
                        className: status?.ok
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-rose-500/30 bg-rose-500/10 text-rose-300",
                      },
                      status?.ok ? "Online" : "Offline",
                    ),
                  ),
                ),
              ),
            ),
            /*#__PURE__*/ React.createElement(
              Card,
              {
                className: "p-5",
              },
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "mb-4 flex items-center justify-between gap-3",
                },
                /*#__PURE__*/ React.createElement(
                  "div",
                  null,
                  /*#__PURE__*/ React.createElement(
                    "p",
                    {
                      className:
                        "text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500",
                    },
                    "Top signal",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "h3",
                    {
                      className:
                        "mt-1 text-sm font-bold uppercase tracking-[0.22em] text-slate-200",
                    },
                    "Best AI-ranked opportunity",
                  ),
                ),
                /*#__PURE__*/ React.createElement(
                  Badge,
                  {
                    className:
                      "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
                  },
                  topOpportunity ? topOpportunity.Algorithm : "N/A",
                ),
              ),
              topOpportunity
                ? /*#__PURE__*/ React.createElement(
                    "div",
                    {
                      className: "space-y-3",
                    },
                    /*#__PURE__*/ React.createElement(
                      "div",
                      {
                        className:
                          "rounded-2xl border border-slate-800/70 bg-slate-950/55 p-4",
                      },
                      /*#__PURE__*/ React.createElement(
                        "div",
                        {
                          className: "flex items-center justify-between gap-3",
                        },
                        /*#__PURE__*/ React.createElement(
                          "div",
                          null,
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "text-xs font-semibold uppercase tracking-[0.26em] text-slate-500",
                            },
                            "Coin",
                          ),
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "mt-1 text-lg font-bold text-slate-100",
                            },
                            topOpportunity.Coin,
                          ),
                        ),
                        /*#__PURE__*/ React.createElement(
                          Badge,
                          {
                            className:
                              "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                          },
                          formatRoi(topOpportunity.roi),
                        ),
                      ),
                      /*#__PURE__*/ React.createElement(
                        "div",
                        {
                          className: "mt-4 grid gap-3 sm:grid-cols-2",
                        },
                        /*#__PURE__*/ React.createElement(
                          "div",
                          {
                            className:
                              "rounded-2xl border border-slate-800/70 bg-slate-900/50 p-3",
                          },
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "text-[10px] uppercase tracking-[0.26em] text-slate-500",
                            },
                            "Revenue source",
                          ),
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "mt-2 text-sm font-semibold text-slate-200",
                            },
                            topOpportunity.Source,
                          ),
                        ),
                        /*#__PURE__*/ React.createElement(
                          "div",
                          {
                            className:
                              "rounded-2xl border border-slate-800/70 bg-slate-900/50 p-3",
                          },
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "text-[10px] uppercase tracking-[0.26em] text-slate-500",
                            },
                            "AI score",
                          ),
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "mt-2 text-sm font-semibold text-slate-200",
                            },
                            formatDecimal(topOpportunity.aiScore || 0, 2),
                          ),
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "mt-1 text-[10px] uppercase tracking-[0.22em] text-slate-500",
                            },
                            topOpportunity.aiLabel || "watch",
                            " \xB7 confidence ",
                            formatDecimal(topOpportunity.aiConfidence || 0, 2),
                          ),
                        ),
                      ),
                    ),
                    /*#__PURE__*/ React.createElement(
                      "div",
                      {
                        className:
                          "rounded-2xl border border-slate-800/70 bg-slate-950/55 p-4",
                      },
                      /*#__PURE__*/ React.createElement(
                        "p",
                        {
                          className:
                            "text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500",
                        },
                        "Model status",
                      ),
                      /*#__PURE__*/ React.createElement(
                        "div",
                        {
                          className: "mt-3 grid gap-3 sm:grid-cols-2",
                        },
                        /*#__PURE__*/ React.createElement(
                          "div",
                          null,
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "text-xs uppercase tracking-[0.22em] text-slate-500",
                            },
                            "Validation accuracy",
                          ),
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "mt-1 text-lg font-bold text-slate-100",
                            },
                            aiModelReady
                              ? `${Math.round((aiModel.validationAccuracy || 0) * 100)}%`
                              : "Training",
                          ),
                        ),
                        /*#__PURE__*/ React.createElement(
                          "div",
                          null,
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "text-xs uppercase tracking-[0.22em] text-slate-500",
                            },
                            "Training samples",
                          ),
                          /*#__PURE__*/ React.createElement(
                            "p",
                            {
                              className:
                                "mt-1 text-lg font-bold text-slate-100",
                            },
                            aiModel.samples || 0,
                          ),
                        ),
                      ),
                    ),
                  )
                : /*#__PURE__*/ React.createElement(
                    "p",
                    {
                      className: "text-sm text-slate-500",
                    },
                    "No opportunity is currently visible with the active filters.",
                  ),
            ),
            /*#__PURE__*/ React.createElement(
              Card,
              {
                className: "p-5",
              },
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "mb-4 flex items-center justify-between gap-3",
                },
                /*#__PURE__*/ React.createElement(
                  "div",
                  null,
                  /*#__PURE__*/ React.createElement(
                    "p",
                    {
                      className:
                        "text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500",
                    },
                    "Coin universe",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "h3",
                    {
                      className:
                        "mt-1 text-sm font-bold uppercase tracking-[0.22em] text-slate-200",
                    },
                    "Filtered symbols",
                  ),
                ),
                /*#__PURE__*/ React.createElement(
                  Badge,
                  {
                    className:
                      "border-slate-700 bg-slate-950/70 text-slate-400",
                  },
                  filteredCoins.length,
                  " coins",
                ),
              ),
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "space-y-2",
                },
                filteredCoins.slice(0, 10).map((coin) =>
                  /*#__PURE__*/ React.createElement(
                    "div",
                    {
                      key: coin.symbol,
                      className:
                        "rounded-2xl border border-slate-800/70 bg-slate-950/55 p-3",
                    },
                    /*#__PURE__*/ React.createElement(
                      "div",
                      {
                        className: "flex items-start justify-between gap-3",
                      },
                      /*#__PURE__*/ React.createElement(
                        "div",
                        null,
                        /*#__PURE__*/ React.createElement(
                          "p",
                          {
                            className: "font-semibold text-slate-100",
                          },
                          coin.symbol,
                        ),
                        /*#__PURE__*/ React.createElement(
                          "p",
                          {
                            className: "mt-1 text-xs text-slate-500",
                          },
                          coin.coinId || "no CoinGecko id",
                        ),
                      ),
                      /*#__PURE__*/ React.createElement(
                        "p",
                        {
                          className: "font-mono text-sm text-emerald-300",
                        },
                        coin.priceUsd ? formatMoney(coin.priceUsd) : "n/a",
                      ),
                    ),
                    /*#__PURE__*/ React.createElement(
                      "div",
                      {
                        className: "mt-3 flex flex-wrap gap-2",
                      },
                      (coin.algorithms || []).slice(0, 3).map((algo) =>
                        /*#__PURE__*/ React.createElement(
                          Badge,
                          {
                            key: algo,
                            className:
                              "border-slate-700 bg-slate-950/70 text-slate-400",
                          },
                          algo,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      /*#__PURE__*/ React.createElement(
        "details",
        {
          className:
            "mt-6 rounded-[1.5rem] border border-slate-800/70 bg-slate-950/55 shadow-2xl shadow-black/20",
        },
        /*#__PURE__*/ React.createElement(
          "summary",
          {
            className: "cursor-pointer list-none px-5 py-4 md:px-6",
          },
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "flex items-center justify-between gap-3",
            },
            /*#__PURE__*/ React.createElement(
              "div",
              null,
              /*#__PURE__*/ React.createElement(
                "p",
                {
                  className:
                    "text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500",
                },
                "Collapsed feeds",
              ),
              /*#__PURE__*/ React.createElement(
                "h3",
                {
                  className:
                    "mt-1 text-sm font-bold uppercase tracking-[0.22em] text-slate-200",
                },
                "Open market feeds",
              ),
            ),
            /*#__PURE__*/ React.createElement(
              "div",
              {
                className: "flex items-center gap-2",
              },
              /*#__PURE__*/ React.createElement(
                Badge,
                {
                  className: "border-slate-700 bg-slate-950/70 text-slate-400",
                },
                "9 sections",
              ),
              /*#__PURE__*/ React.createElement("i", {
                className: "fa-solid fa-chevron-down text-slate-500",
              }),
            ),
          ),
        ),
        /*#__PURE__*/ React.createElement(
          "div",
          {
            className: "border-t border-slate-800/70 px-5 py-5 md:px-6",
          },
          /*#__PURE__*/ React.createElement(
            "section",
            {
              className: "grid gap-4 xl:grid-cols-2",
            },
            /*#__PURE__*/ React.createElement(PoolSection, {
              title: "CoinGecko price feed",
              tone: "emerald",
              rates: data.coingeckoRates,
              label: "USD price",
            }),
            /*#__PURE__*/ React.createElement(PoolSection, {
              title: "CoinPaprika price feed",
              tone: "violet",
              rates: data.coinpaprikaRates,
              label: "USD price",
            }),
            /*#__PURE__*/ React.createElement(PoolSection, {
              title: "MEXC exchange feed",
              tone: "cyan",
              rates: data.mexcRates,
              label: "USD price",
            }),
            /*#__PURE__*/ React.createElement(PoolSection, {
              title: "Xeggex exchange feed",
              tone: "amber",
              rates: data.xeggexRates,
              label: "USD price",
            }),
            /*#__PURE__*/ React.createElement(PoolSection, {
              title: "Minerstat benchmark",
              tone: "violet",
              rates: data.minerstatRates,
            }),
            /*#__PURE__*/ React.createElement(PoolSection, {
              title: "K1Pool benchmark",
              tone: "blue",
              rates: data.k1PoolRates,
            }),
            /*#__PURE__*/ React.createElement(PoolSection, {
              title: "Hashrate.no benchmark",
              tone: "rose",
              rates: data.hashrateNoRates,
              label: "Daily",
            }),
            /*#__PURE__*/ React.createElement(PoolSection, {
              title: "WhatToMine benchmark",
              tone: "emerald",
              rates: data.whattomineRates,
            }),
            /*#__PURE__*/ React.createElement(PoolSection, {
              title: "Zpool benchmark",
              tone: "cyan",
              rates: data.zpoolRates,
            }),
          ),
        ),
      ),
    ),
  );
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(/*#__PURE__*/ React.createElement(App, null));
