import { request } from 'undici';
import { createHmac, randomUUID } from 'node:crypto';

export class NiceHashClient {
  constructor({ apiKey, apiSecret, orgId, environment = 'production' }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.orgId = orgId;
    this.baseUrl = environment === 'production' 
      ? 'https://api2.nicehash.com' 
      : 'https://api-test.nicehash.com';
  }

  /**
   * Fetches server time to ensure synchronization.
   */
  async getServerTime() {
    const response = await request(`${this.baseUrl}/api/v2/time`);
    const data = await response.body.json();
    return data.serverTime;
  }

  /**
   * Generates the HMAC-SHA256 signature using 0x00 separators.
   */
  computeSignature(method, path, query, body, time, nonce) {
    const hmac = createHmac('sha256', this.apiSecret);
    
    const fields = [
      this.apiKey,
      time,
      nonce,
      '', // Empty field
      this.orgId,
      '', // Empty field
      method.toUpperCase(),
      path,
      query || ''
    ];

    const separator = Buffer.alloc(1, 0);
    let inputBuffer = Buffer.alloc(0);

    // Headers and URL parts use ISO-8859-1
    for (let i = 0; i < fields.length; i++) {
      inputBuffer = Buffer.concat([inputBuffer, Buffer.from(fields[i], 'latin1')]);
      if (i < fields.length - 1 || body) {
        inputBuffer = Buffer.concat([inputBuffer, separator]);
      }
    }

    // Request body uses UTF-8
    if (body) {
      const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
      inputBuffer = Buffer.concat([inputBuffer, Buffer.from(bodyString, 'utf-8')]);
    }

    return hmac.update(inputBuffer).digest('hex');
  }

  async call({ method, path, query = {}, body = null }) {
    const serverTime = await this.getServerTime();
    const time = serverTime.toString();
    const nonce = randomUUID();
    const requestId = randomUUID();

    const queryString = typeof query === 'string' 
      ? query 
      : new URLSearchParams(query).toString();

    const signature = this.computeSignature(method, path, queryString, body, time, nonce);

    const headers = {
      'X-Time': time,
      'X-Nonce': nonce,
      'X-Organization-Id': this.orgId,
      'X-Request-Id': requestId,
      'X-Auth': `${this.apiKey}:${signature}`,
      'Content-Type': 'application/json'
    };

    const url = `${this.baseUrl}${path}${queryString ? '?' + queryString : ''}`;
    const response = await request(url, {
      method: method.toUpperCase(),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.statusCode >= 400) {
      throw new Error(`NiceHash API [${response.statusCode}]: ${await response.body.text()}`);
    }
    return response.body.json();
  }
}