export function createApiClient({ onState } = {}) {
  return async function callApi(path, options = {}) {
    const startedAt = performance.now();
    const method = options.method || "GET";
    const { query, section, ...fetchOptions } = options;
    let finalPath = path;

    const enrichedQuery = { ...query };
    if (path.startsWith("/api/v2/")) enrichedQuery.ts = Date.now();

    if (Object.keys(enrichedQuery).length > 0) {
      const params = new URLSearchParams();
      Object.entries(enrichedQuery).forEach(([key, value]) => {
        if (value !== undefined && value !== null)
          params.append(key, String(value));
      });
      const qs = params.toString();
      if (qs) finalPath += (finalPath.includes("?") ? "&" : "?") + qs;
    }

    if (!options.silent) {
      onState?.({
        type: "request-start",
        payload: { section, method, path: finalPath },
      });
    }

    // Use relative API paths so development proxy and production same-origin routing both work.
    const apiBase = "";

    const headers = { ...fetchOptions.headers };
    let body = fetchOptions.body;
    if (body && typeof body === "object" && !(body instanceof FormData)) {
      body = JSON.stringify(body);
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
    }

    try {
      const res = await fetch(`${apiBase}${finalPath}`, {
        ...fetchOptions,
        method,
        headers,
        body,
        mode: "cors",
        credentials: "omit",
      });

      let data = null;
      if (res.status !== 204 && res.status !== 205) {
        const text = await res.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
      }

      if (!options.silent) {
        onState?.({
          type: "request-finish",
          payload: {
            method,
            path: finalPath,
            status: `${res.status} ${res.statusText}`,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
      }

      const isAppError =
        !res.ok ||
        (data &&
          typeof data === "object" &&
          (data.success === false || data.error || data.errors)) ||
        (typeof data === "string" && data.length > 0 && !data.startsWith("{"));

      if (!isAppError && (res.status === 304 || res.ok)) {
        if (!options.silent)
          onState?.({
            type: "request-success",
            payload: { status: res.status, statusText: res.statusText, data },
          });
      } else if (!options.silent) {
        const errorMsg =
          typeof data === "string"
            ? data
            : data?.errors?.[0]?.message ||
              data?.error ||
              data?.message ||
              data?.data?.message ||
              res.statusText;
        onState?.({
          type: "request-error",
          payload: {
            status: res.status,
            errorMsg,
            data,
            showModal: !!options.showModal,
          },
        });
      }

      return data || (res.ok ? { success: true } : null);
    } catch (err) {
      if (!options.silent) {
        onState?.({
          type: "request-failed",
          payload: {
            error: err.message || String(err),
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
      }
      throw err;
    } finally {
      if (!options.silent) onState?.({ type: "request-end" });
    }
  };
}
