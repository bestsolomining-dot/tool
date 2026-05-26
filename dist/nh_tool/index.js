//#endregion
//#region \0virtual:cloudflare/worker-entry
var worker_entry_default = { fetch(request, env) {
	if (new URL(request.url).pathname.startsWith("/api/v2/")) return Response.json({ name: "Cloudflare" });
	return new Response(null, { status: 404 });
} };
//#endregion
export { worker_entry_default as default };
