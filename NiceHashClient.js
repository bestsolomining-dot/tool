import { createHmac, randomUUID } from "node:crypto";

export class NiceHashClient {
  constructor({ apiKey, apiSecret, orgId, environment = "production" }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.orgId = orgId;
    this.baseUrl =
      environment === "production"
        ? "https://api2.nicehash.com"
        : "https://api-test.nicehash.com";
    this.initializedPaths = new Set();
  }

  async _delayFirstTime(key) {
    if (!this.initializedPaths.has(key)) {
      console.log(`[NiceHash] First-time function delay (1s): ${key}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      this.initializedPaths.add(key);
    }
  }

  /**
   * Fetches server time to ensure synchronization.
   */
  async getServerTime() {
    await this._delayFirstTime("getServerTime");
    const response = await fetch(`${this.baseUrl}/api/v2/time`, {
      headers: { "User-Agent": "MiningTool/2.0" },
    });
    if (!response.ok) {
      throw new Error(`NiceHash Time Sync failed: ${response.status}`);
    }
    const data = await response.json();
    return data.serverTime;
  }

  /**
   * Generates the HMAC-SHA256 signature using 0x00 separators.
   */
  computeSignature(method, path, query, body, time, nonce) {
    const hmac = createHmac("sha256", this.apiSecret);

    const fields = [
      this.apiKey,
      time,
      nonce,
      "", // Empty field
      this.orgId,
      "", // Empty field
      method.toUpperCase(),
      path,
      query || "",
    ];

    const separator = Buffer.alloc(1, 0);
    let inputBuffer = Buffer.alloc(0);

    // Headers and URL parts use ISO-8859-1
    for (let i = 0; i < fields.length; i++) {
      inputBuffer = Buffer.concat([
        inputBuffer,
        Buffer.from(fields[i], "latin1"),
      ]);
      if (i < fields.length - 1 || body) {
        inputBuffer = Buffer.concat([inputBuffer, separator]);
      }
    }

    // Request body uses UTF-8
    if (body) {
      const bodyString = typeof body === "string" ? body : JSON.stringify(body);
      inputBuffer = Buffer.concat([
        inputBuffer,
        Buffer.from(bodyString, "utf-8"),
      ]);
    }

    return hmac.update(inputBuffer).digest("hex");
  }

  async call({ method, path, query = {}, body = null }) {
    await this._delayFirstTime(path);

    // Ensure path and query string are separated (in case query was included in the path string)
    const [cleanPath, pathQueryString] = path.split("?");

    const serverTime = await this.getServerTime();
    const time = serverTime.toString();
    const nonce = randomUUID();
    const requestId = randomUUID();

    const queryParams = new URLSearchParams(pathQueryString || "");
    const additionalParams = new URLSearchParams(query || {});
    additionalParams.forEach((value, key) => queryParams.set(key, value));

    // Remove 'client' from query before sending to NiceHash upstream,
    // as it is only intended for our backend's internal routing.
    queryParams.delete("client");

    // For Hashpower Private API, ts and nonce MUST be in the query string
    if (cleanPath.includes("/hashpower/")) {
      queryParams.set("ts", time);
      queryParams.set("nonce", nonce);
    }

    const queryString = queryParams.toString();

    const signature = this.computeSignature(
      method,
      cleanPath,
      queryString,
      body,
      time,
      nonce,
    );

    const headers = {
      "User-Agent": "MiningTool/2.0",
      "X-Time": String(time),
      "X-Nonce": String(nonce),
      "X-Organization-Id": String(this.orgId || ""),
      "X-Request-Id": String(requestId),
      "X-Auth": String(`${this.apiKey}:${signature}`),
      "Content-Type": "application/json",
    };

    const url = `${this.baseUrl}${cleanPath}${queryString ? "?" + queryString : ""}`;
    const response = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage =
          errorJson.errors?.[0]?.message ||
          errorJson.message ||
          errorJson.error ||
          errorText;
      } catch (e) {
        /* use raw text */
      }

      const error = new Error(errorMessage);
      error.statusCode = response.status;
      error.headers = response.headers;
      throw error;
    }
    return response.json();
  }
}
