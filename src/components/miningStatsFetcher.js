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
  // Sanitize client: 'VN' is an aggregate identifier and lacks direct API keys on the backend.
  // We default to 'BT' for stats and pool config operations if the context is currently 'VN'.
  let targetClient = client;
  if (targetClient === 'VN' && (type === 'miningpooldutch' || type === 'herominers' || type === 'all')) {
    targetClient = 'BT';
  }

  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Fix: derivce the backend host for local development (Vite port 5173 -> Backend port 3000)
    const host = window.location.port === '5173' ? 'localhost:3000' : window.location.host;
    const wsUrl = `${protocol}//${host}/api/v2/mrr/fetch/ws`;
    
    let socket;

    try {
      socket = new WebSocket(wsUrl);
    } catch (err) {
      return reject(new Error(`Failed to establish WebSocket connection: ${err.message}`));
    }

    // Add a timeout to prevent the UI from hanging if the socket never responds
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Connection timed out after 10 seconds."));
    }, 10000);

    socket.onopen = () => {
      const message = {
        action: type,
        client: targetClient
      };
      if (rigId) {
        message.rigid = rigId;
      }
      socket.send(JSON.stringify(message));
    };

    socket.onmessage = (event) => {
      clearTimeout(timeout);
      try {
        const data = JSON.parse(event.data);
        if (data.success) {
          resolve(data); // Resolve with the entire data object if successful
        } else if (data.error) {
          reject(new Error(data.error));
        } else {
          reject(new Error("Unknown WebSocket data format or missing 'success' field."));
        }
      } catch (err) {
        reject(new Error("Failed to parse WebSocket data: " + err.message));
      } finally {
        socket.close();
      }
    };

    socket.onerror = (event) => {
      clearTimeout(timeout);
      console.error(`WebSocket Error for type '${type}', client '${targetClient}', rigId '${rigId}':`, event);
      reject(new Error(`WebSocket connection failed for type '${type}' and client '${targetClient}'. Please check network, backend status, or console for more details.`));
      socket.close();
    };

    socket.onclose = (event) => {
      // This callback is primarily for cleanup or detecting unexpected closures.
      // Actual errors/success should be handled by onmessage/onerror.
    };
  });
}