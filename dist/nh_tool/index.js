//#endregion
//#region \0virtual:cloudflare/worker-entry
var worker_entry_default = { fetch(request, env) {
	const url = new URL(request.url);
	const apiKey = env.NICEHASH_API_KEY;
	const apiSecret = env.NICEHASH_API_SECRET;
	const orgId = env.NICEHASH_ORG_ID;
	if (url.pathname.startsWith("/api/v2/")) return Response.json({
		name: "Cloudflare NiceHash Proxy",
		authenticated: !!(apiKey && apiSecret && orgId)
	});
	return new Response(null, { status: 404 });
} };
//#endregion
export { worker_entry_default as default };
