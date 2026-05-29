export default {
  fetch(request, env) {
    const url = new URL(request.url);

    // Bindings from wrangler.jsonc are available on the 'env' object
    const apiKey = env.NICEHASH_API_KEY;
    const apiSecret = env.NICEHASH_API_SECRET;
    const orgId = env.NICEHASH_ORG_ID;
    const apiKeyPh = env.NICEHASH_API_KEY_PH;
    const apiSecretPh = env.NICEHASH_API_SECRET_PH;
    const orgIdPh = env.NICEHASH_ORG_ID_PH;
    const mrrKey = env.MRR_KEY_RIG_BT;
    const mrrSecret = env.MRR_SECRET_RIG_BT;

    if (url.pathname.startsWith("/api/v2/")) {
      return Response.json({
        name: "Multi-Client Proxy",
        status: "Online",
        auth: {
          nicehash_default: !!(apiKey && apiSecret && orgId),
          nicehash_ph: !!(apiKeyPh && apiSecretPh && orgIdPh),
          mrr: !!(mrrKey && mrrSecret)
        },
        environments: {
          btApiKey: env.NICEHASH_API_KEY,
          btApiSecret: env.NICEHASH_API_SECRET,
          btOrgId: env.NICEHASH_ORG_ID,
          btEnvironment: 'production',
          phApiKey: env.NICEHASH_API_KEY_PH,
          phApiSecret: env.NICEHASH_API_SECRET_PH,
          phOrgId: env.NICEHASH_ORG_ID_PH,
          phEnvironment: 'production'
        },
        default_client: env.NH_DEFAULT_CLIENT || 'BT'
      });
    }
    return new Response(null, { status: 404 });
  },
}
