import crypto from 'crypto';
import axios, { AxiosInstance, Method } from 'axios';
import { v4 as uuidv4 } from 'uuid';

interface NiceHashConfig {
    apiKey: string;
    apiSecret: string;
    orgId: string;
    baseUrl?: string;
}

export class NiceHashClient {
    private axiosInstance: AxiosInstance;
    private config: NiceHashConfig;
    private timeOffset: number = 0;

    constructor(config: NiceHashConfig) {
        this.config = config;
        this.axiosInstance = axios.create({
            baseURL: config.baseUrl || 'https://api2.nicehash.com',
        });
    }

    /**
     * Synchronize local time with NiceHash server time to prevent signature errors.
     */
    async syncTime() {
        const response = await axios.get(`${this.axiosInstance.defaults.baseURL}/api/v2/time`);
        const serverTime = response.data.serverTime;
        this.timeOffset = serverTime - Date.now();
    }

    private getSignature(method: string, path: string, query: string, body: string, nonce: string, time: string) {
        const hmac = crypto.createHmac('sha256', this.config.apiSecret);
        const input = [
            this.config.apiKey,
            time,
            nonce,
            null,
            this.config.orgId,
            null,
            method.toUpperCase(),
            path,
            query,
            body
        ].map(x => (x === null ? '' : x)).join('\0');

        return hmac.update(input).digest('hex');
    }

    private async request(method: Method, path: string, params: any = {}, body: any = null) {
        const time = (Date.now() + this.timeOffset).toString();
        const nonce = uuidv4();
        
        // Ensure query parameters are handled consistently
        const urlParams = new URLSearchParams();
        Object.keys(params).sort().forEach(key => {
            if (params[key] !== undefined) urlParams.append(key, params[key]);
        });
        const query = urlParams.toString();
        const bodyStr = body ? JSON.stringify(body) : '';

        const signature = this.getSignature(method, path, query, bodyStr, nonce, time);

        try {
            const response = await this.axiosInstance.request({
                method,
                url: path,
                params: params,
                data: body,
                headers: {
                    'X-Time': time,
                    'X-Nonce': nonce,
                    'X-Organization-Id': this.config.orgId,
                    'X-Auth': `${this.config.apiKey}:${signature}`,
                    'Content-Type': 'application/json',
                },
            });
            return response.data;
        } catch (error: any) {
            console.error(`API Error [${method} ${path}]:`, error.response?.data || error.message);
            throw error;
        }
    }

    // --- ACCOUNTING SECTION ---
    readonly accounting = {
        getBalances: () => this.request('GET', '/main/api/v2/accounting/accounts2'),
        getBalance: (currency: string) => this.request('GET', `/main/api/v2/accounting/account2/${currency}`),
        getActivities: (params?: { cur?: string; page?: number; size?: number }) => 
            this.request('GET', '/main/api/v2/accounting/activities', params),
        getDepositAddresses: () => this.request('GET', '/main/api/v2/accounting/depositAddresses'),
        getWithdrawals: (currency: string) => this.request('GET', `/main/api/v2/accounting/withdrawals/${currency}`),
        createWithdrawal: (body: any) => this.request('POST', '/main/api/v2/accounting/withdrawal', {}, body),
    };

    // --- PUBLIC SECTION ---
    readonly public = {
        getAlgorithms: () => this.request('GET', '/main/api/v2/mining/algorithms'),
        getMarkets: () => this.request('GET', '/main/api/v2/mining/markets'),
        getCurrencies: () => this.request('GET', '/main/api/v2/public/currencies'),
        getFeeInfo: () => this.request('GET', '/main/api/v2/public/service/fee/info'),
        getServerTime: () => this.request('GET', '/api/v2/time'),
    };

    // --- MINING SECTION ---
    readonly mining = {
        getMiningAddress: () => this.request('GET', '/main/api/v2/mining/miningAddress'),
        getRigs: () => this.request('GET', '/main/api/v2/mining/rigs2'),
        getRigDetails: (rigId: string) => this.request('GET', `/main/api/v2/mining/rig2/${rigId}`),
        getPayouts: (params?: { page?: number; size?: number }) => 
            this.request('GET', '/main/api/v2/mining/rigs/payouts', params),
        setRigStatus: (body: { rigId: string; action: string }) => 
            this.request('POST', '/main/api/v2/mining/rigs/status2', {}, body),
    };

    // --- HASHPOWER SECTION ---
    readonly hashpower = {
        getMyOrders: (params?: { op?: string; page?: number; size?: number }) => 
            this.request('GET', '/main/api/v2/hashpower/myOrders', params),
        createOrder: (body: any) => this.request('POST', '/main/api/v2/hashpower/order', {}, body),
        cancelOrder: (id: string) => this.request('DELETE', `/main/api/v2/hashpower/order/${id}`),
        getOrderBook: (params: { algorithm: string; market: string }) => 
            this.request('GET', '/main/api/v2/hashpower/orderBook', params),
    };

    // --- POOLS SECTION ---
    readonly pools = {
        getPools: (params?: { page?: number; size?: number }) => 
            this.request('GET', '/main/api/v2/pools', params),
        getPoolDetails: (poolId: string) => this.request('GET', `/main/api/v2/pool/${poolId}`),
        createPool: (body: any) => this.request('POST', '/main/api/v2/pool', {}, body),
        deletePool: (poolId: string) => this.request('DELETE', `/main/api/v2/pool/${poolId}`),
    };
}
