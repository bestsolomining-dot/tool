import React, { useState, useEffect, useMemo } from 'react';

/**
 * A multi-currency calculator modal for BTC, ETH, LTC, DOGE, and BCH.
 * Fetches live market data directly from CoinGecko.
 */

const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash' },
];

export function CryptoCalculatorModal({ isOpen, onClose, onCall }) {
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [amounts, setAmounts] = useState({ usd: '1' });
  const [baseCoin, setBaseCoin] = useState('bitcoin');

  const fetchPrices = async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = COINS.map(c => c.id).join(',');
      const res = await onCall('/api/v2/prices/coingecko', { 
        query: { ids, vs_currencies: 'usd' }, 
        silent: true 
      });
      
      if (res?.success && res.data) {
        setPrices(res.data);
      } else {
        throw new Error(res?.message || "Invalid data received from price API");
      }
    } catch (err) {
      console.error('[CryptoCalculator] Fetch failed:', err);
      setError("API Error: Unable to fetch live rates. Please check your connection or API key.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && !prices) fetchPrices();
  }, [isOpen, prices]);

  const results = useMemo(() => {
    // Return empty results but keep symbols if prices aren't loaded yet
    const currentInput = parseFloat(amounts[baseCoin]) || 0;

    // Helper to find coin data by ID or Symbol (handles various proxy formats)
    const getCoinData = (id) => {
      const coin = COINS.find(c => c.id === id);
      return prices?.[id] || prices?.[coin?.symbol] || prices?.[coin?.symbol?.toLowerCase()];
    };

    const getPrice = (data) => data?.usd || (typeof data === 'number' ? data : 0);
    
    // Calculate the pivot USD value based on current base input
    const baseData = baseCoin === 'usd' ? null : getCoinData(baseCoin);
    const usdValue = baseCoin === 'usd' ? currentInput : currentInput * getPrice(baseData);

    return COINS.map(coin => ({
      ...coin,
      calculated: getPrice(getCoinData(coin.id)) > 0 ? (usdValue / getPrice(getCoinData(coin.id))) : 0,
      usdPrice: getPrice(getCoinData(coin.id)),
      change24h: getCoinData(coin.id)?.usd_24h_change || 0
    }));
  }, [prices, amounts, baseCoin]);

  const onValueChange = (id, val) => {
    setBaseCoin(id);
    setAmounts({ [id]: val });
  };

  const getDisplayUsdValue = () => {
    if (baseCoin === 'usd') return amounts.usd;
    const coin = COINS.find(c => c.id === baseCoin);
    const data = prices?.[baseCoin] || prices?.[coin?.symbol] || prices?.[coin?.symbol?.toLowerCase()];
    const price = data?.usd || (typeof data === 'number' ? data : 0);
    if (!price) return "0.00";
    const val = (parseFloat(amounts[baseCoin]) || 0) * price;
    return val.toFixed(2);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-[#1e293b] border border-slate-700 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden transition-all">
        <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/30">
          <h3 className="text-xl font-black text-white tracking-tight italic">
            CRYPTO <span className="text-blue-400">CALC</span>
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl text-rose-400 text-xs text-center">
              {error}
            </div>
          )}

          <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Reference Value (USD)</label>
            <div className="relative flex items-center">
              <span className="absolute left-0 text-2xl font-light text-slate-600">$</span>
              <input 
                type="number" 
                className="w-full bg-transparent pl-6 text-3xl font-mono text-white outline-none focus:text-blue-400 transition-colors"
                value={getDisplayUsdValue()}
                onChange={(e) => onValueChange('usd', e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-3">
            {loading && !prices ? (
              <div className="py-20 flex flex-col items-center justify-center space-y-3 opacity-50">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Updating Market Data</span>
              </div>
            ) : results.map(coin => (
              <div key={coin.id} className="group relative bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 flex items-center justify-between hover:bg-slate-800 hover:border-slate-600 transition-all">
                <div className="flex flex-col">
                  <span className="text-sm font-black text-white group-hover:text-blue-400 transition-colors">{coin.symbol}</span>
                  <div className={`text-[9px] font-bold ${coin.change24h >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {coin.change24h >= 0 ? '▲' : '▼'} {Math.abs(coin.change24h).toFixed(2)}%
                  </div>
                </div>
                <input 
                  type="number" 
                  className="bg-transparent text-right text-white font-mono text-lg outline-none w-2/3 focus:text-blue-400 transition-colors"
                  value={baseCoin === coin.id ? amounts[coin.id] : (coin.calculated > 0 ? coin.calculated.toFixed(8) : "0.00000000")}
                  onChange={(e) => onValueChange(coin.id, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
        <button onClick={fetchPrices} className="w-full p-4 bg-slate-800 text-[10px] font-bold text-slate-400 hover:text-white hover:bg-slate-700 border-t border-slate-700 transition-all uppercase tracking-[0.2em]">
          Refresh Market Rates
        </button>
      </div>
    </div>
  );
}