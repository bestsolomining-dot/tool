/**
 * Fetches live statistics from mining pools (HeroMiners, MiningPoolDutch)
 * using a WebSocket connection to the backend API.
 *
 * @param {string} type - The type of stats to fetch ('herominers', 'miningpooldutch', 'all').
 * @param {string} client - The MRR client identifier (e.g., 'VN', 'BT').
 * @param {string|null} [rigId=null] - Optional rig ID for rig-specific fetches.
 * @returns {Promise<object>} A promise that resolves with the full successful response data
 *                            (e.g., { success: true, stats: {...}, pools: [...] })
 *                            or rejects with an error.
 */
export async function fetchMiningStats(type, client, rigId = null) {
  const maxAttempts = 5;
  const baseDelay = 1000;

  // Sanitize client: 'VN' is an aggregate identifier and lacks direct API keys on the backend.
  // We default to 'BT' for stats and pool config operations if the context is currently 'VN'.
  let targetClient = client;
  if (targetClient === 'VN' && (type === 'miningpooldutch' || type === 'herominers' || type === 'all')) {
    targetClient = 'BT';
  }

  const attemptFetch = () => new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Use the current host to allow the Vite proxy to handle the upgrade request.
    // Ensure your vite.config.js has 'ws: true' in the proxy settings.
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/v2/mrr/fetch/ws`;
    
    let socket;
    try {
      socket = new WebSocket(wsUrl);
    } catch (err) {
      return reject(new Error(`WebSocket error: ${err.message}`));
    }

    const timeout = setTimeout(() => {
      if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
        socket.close();
      }
      reject(new Error(`Fetch timed out for ${type} at ${wsUrl} after 15s`));
    }, 15000);

    socket.onopen = () => {
      socket.send(JSON.stringify({ action: type, client: targetClient, rigid: rigId }));
    };

    socket.onmessage = (event) => {
      clearTimeout(timeout);
      try {
        const data = JSON.parse(event.data);
        if (data.success) resolve(data);
        else reject(new Error(data.error || "Request failed"));
      } catch (err) {
        reject(new Error("Parse error: " + err.message));
      } finally {
        socket.close();
      }
    };

    socket.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(`Connection failed for ${type} at ${wsUrl}. Check if the backend is running on port 3000 (or your configured PORT environment variable).`));
      socket.close();
    };
  });

  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await attemptFetch();
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
  }
}