export default {
  fetch(request, env) {
    const url = new URL(request.url);

    // Bindings from wrangler.jsonc are available on the 'env' object
    const apiKey = env.NICEHASH_API_KEY;
    const apiSecret = env.NICEHASH_API_SECRET;
    const orgId = env.NICEHASH_ORG_ID;
    const mrrKey = env.MRR_KEY_RIG_BT;
    const mrrSecret = env.MRR_SECRET_RIG_BT;

    if (url.pathname.startsWith("/api/v2/")) {
      return Response.json({
        name: "Cloudflare NiceHash Proxy",
        status: "Online",
        auth: {
          nicehash: !!(apiKey && apiSecret && orgId),
          mrr: !!(mrrKey && mrrSecret)
        },
        environment: env.NICEHASH_ENVIRONMENT || 'production',
        default_client: env.MRR_DEFAULT_CLIENT || 'BT'
      });
    }
    return new Response(null, { status: 404 });
  },
}
