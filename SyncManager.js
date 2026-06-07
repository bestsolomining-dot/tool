/**
 * SyncManager handles the background aggregation of data across all 
 * NiceHash and Mining Rig Rentals accounts.
 */
export class SyncManager {
    constructor(dependencies) {
        this.db = dependencies.db;
        this.nhConfigs = dependencies.nhConfigs;
        this.mrrConfigs = dependencies.mrrConfigs;
        this.mrrApiCall = dependencies.mrrApiCall;
        this.resolveNhClient = dependencies.resolveNhClient;
        this.getNiceHashApp = dependencies.getNiceHashApp;
        this.isSyncing = false;
    }

    async run() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        console.info('[sync] Starting background synchronization...');
        const syncSnapshot = {
            nhPools: [],
            mrrPools: [],
            mrrRigs: [],
            matches: [],
            lastSync: new Date().toISOString()
        };

        try {
            // 1. Parallel Fetch NiceHash Pools
            const nhAccounts = Object.keys(this.nhConfigs).filter(k => this.nhConfigs[k].apiKey && this.nhConfigs[k].apiSecret);
            await Promise.all(nhAccounts.map(async (acct) => {
                const { client, clientName } = this.resolveNhClient(acct);
                if (!client || (acct === 'PH' && clientName === 'BT')) return;
                try {
                    const result = await this.getNiceHashApp(client).pools.getPools();
                    if (result?.list) {
                        syncSnapshot.nhPools.push(...result.list.map(p => ({
                            id: p.id || p.poolId,
                            name: p.name,
                            username: p.username,
                            algorithm: p.algorithm,
                            client: clientName
                        })));
                    }
                } catch (e) {
                    console.warn(`[sync:nh] Error for ${acct}: ${e.message}`);
                }
            }));

            // 2. Parallel Fetch MRR Rigs and scanning
            const mrrAccts = Object.keys(this.mrrConfigs).filter(k => this.mrrConfigs[k].apiKey && this.mrrConfigs[k].apiSecret);
            await Promise.all(mrrAccts.map(async (acct) => {
                try {
                    const { data: rigsData } = await this.mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: acct });
                    const rigs = Array.isArray(rigsData?.data) ? rigsData.data : (rigsData?.data?.rigs || []);
                    if (rigs.length === 0) return;

                    const rigIds = rigs.map(r => r.id).join(';');
                    const { data: poolsData } = await this.mrrApiCall({ endpoint: `/rig/${rigIds}/pool`, clientNameRaw: acct });
                    const poolItems = Array.isArray(poolsData?.data) ? poolsData.data : (poolsData?.data?.result || []);
                    if (poolItems.length > 0) syncSnapshot.mrrPools.push(...poolItems);

                    const poolMap = new Map(poolItems.map(item => [String(item.rigId || item.rigid || item.id), item.pools]));

                    rigs.forEach(rig => {
                        const pools = poolMap.get(String(rig.id)) || [];
                        syncSnapshot.mrrRigs.push({ id: rig.id, name: rig.name, client: acct, pools });
                        pools.forEach(p => {
                            const mrrUser = String(p.user || p.username || '').trim().toLowerCase();
                            if (!mrrUser) return;
                            
                            const nhMatch = syncSnapshot.nhPools.find(nhp => 
                                String(nhp.username || '').trim().toLowerCase() === mrrUser
                            );
                            
                            if (nhMatch) {
                                syncSnapshot.matches.push({ 
                                    mrrRigId: rig.id, 
                                    mrrRigName: rig.name, 
                                    mrrClient: acct, 
                                    nhPoolName: nhMatch.name, 
                                    username: mrrUser, 
                                    nhClient: nhMatch.client 
                                });
                            }
                        });
                    });
                } catch (e) { console.warn(`[sync:mrr] Error for ${acct}: ${e.message}`); }
            }));
        } finally {
            this.isSyncing = false;
        }
    }
}