import axios from 'axios';
import crypto from 'crypto';

const DEFAULT_BASE_URL = 'https://www.miningrigrentals.com/api/v2';

function normalizeIds(ids) {
  if (Array.isArray(ids)) return ids.join(';');
  return String(ids ?? '').trim();
}

export class MiningrigrentalsClient {
  constructor({ key, secret, baseUrl = DEFAULT_BASE_URL }) {
    if (!key || !secret) {
      throw new Error('MiningrigrentalsClient requires both key and secret');
    }

    this.key = key;
    this.secret = secret;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.prevNonce = Date.now();
  }

  nextNonce() {
    this.prevNonce += 1;
    return String(this.prevNonce);
  }

  signature(endpoint, nonce) {
    return crypto.createHmac('sha1', this.secret).update(`${this.key}${nonce}${endpoint}`).digest('hex');
  }

  async request(method, endpoint, { params, data } = {}) {
    const nonce = this.nextNonce();
    const headers = {
      'x-api-key': this.key,
      'x-api-nonce': nonce,
      'x-api-sign': this.signature(endpoint, nonce),
    };

    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers,
        params,
        data,
      });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const payload = error?.response?.data;
      throw new Error(
        `MRR ${method} ${endpoint} failed${status ? ` (${status})` : ''}: ${JSON.stringify(payload || error.message)}`,
        { cause: error },
      );
    }
  }

  // MiningRig methods
  getRigs(options = {}) {
    return this.request('GET', '/rig', { params: options });
  }

  listMyRigs(options = {}) {
    return this.request('GET', '/rig/mine', { params: options });
  }

  getRigsById(rigIds) {
    return this.request('GET', `/rig/${normalizeIds(rigIds)}`);
  }

  createRig(options) {
    return this.request('PUT', '/rig', { params: options });
  }

  updateRigsById(rigIds, options = {}) {
    return this.request('PUT', `/rig/${normalizeIds(rigIds)}`, { params: options });
  }

  deleteRigs(rigIds) {
    return this.request('DELETE', `/rig/${normalizeIds(rigIds)}`);
  }

  extendRental(rigIds, options = {}) {
    return this.request('PUT', `/rig/${normalizeIds(rigIds)}/extend`, { params: options });
  }

  applyPoolToRigs(rigIds, profileId) {
    return this.request('PUT', `/rig/${normalizeIds(rigIds)}/profile`, { params: { profile: profileId } });
  }

  getPoolsFromRigs(rigIds) {
    return this.request('GET', `/rig/${normalizeIds(rigIds)}/pool`);
  }

  addPoolToRigs(rigIds, options = {}) {
    return this.request('PUT', `/rig/${normalizeIds(rigIds)}/pool`, { params: options });
  }

  replacePoolOnRigs(rigIds, options = {}) {
    return this.addPoolToRigs(rigIds, options);
  }

  deletePoolOnRigs(rigIds, priority) {
    const suffix = priority === undefined ? '' : `/${priority}`;
    return this.request('DELETE', `/rig/${normalizeIds(rigIds)}/pool${suffix}`);
  }
}

export default MiningrigrentalsClient;
