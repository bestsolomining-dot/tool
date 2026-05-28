import { useState, useCallback } from 'react';

export function useApi() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [output, setOutput] = useState(null);
    const [lastCall, setLastCall] = useState(null);
    const [activeSection, setActiveSection] = useState(null);
    const [responseModalOpen, setResponseModalOpen] = useState(false);
    const [modalContent, setModalContent] = useState(null);

    const callApi = useCallback(async (path, options = {}) => {
        const startedAt = performance.now();
        const method = options.method || 'GET';

        const { query, section, ...fetchOptions } = options;
        let finalPath = path;

        const enrichedQuery = { ...query };
        // NiceHash API v2 requires a 'ts' parameter.
        if (path.startsWith('/api/v2/') && !path.startsWith('/api/v2/mrr/') && !enrichedQuery.ts) {
            enrichedQuery.ts = Date.now();
        }

        if (Object.keys(enrichedQuery).length > 0) {
            const params = new URLSearchParams();
            Object.entries(enrichedQuery).forEach(([key, value]) => {
                if (value !== undefined && value !== null) params.append(key, String(value));
            });
            const qs = params.toString();
            if (qs) finalPath += (finalPath.includes('?') ? '&' : '?') + qs;
        }

        if (!options.silent) {
            setActiveSection(section || null);
            setLoading(true);
            setError('');
            setLastCall({ method, path: finalPath, status: 'Pending', durationMs: null });
        }

        const apiBase = window.location.port === '5173'
            ? `${window.location.protocol}//${window.location.hostname}:3000`
            : '';

        const headers = { ...fetchOptions.headers };
        let body = fetchOptions.body;

        if (body && typeof body === 'object' && !(body instanceof FormData)) {
            body = JSON.stringify(body);
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        }

        try {
            const res = await fetch(`${apiBase}${finalPath}`, {
                ...fetchOptions,
                method,
                headers,
                body,
                mode: 'cors',
                credentials: 'omit',
            });

            let data = null;
            if (res.status !== 204) {
                const text = await res.text();
                try {
                    data = text ? JSON.parse(text) : null;
                } catch {
                    data = text;
                }

                if (!options.silent) {
                    setLastCall({
                        method,
                        path: finalPath,
                        status: `${res.status} ${res.statusText}`,
                        durationMs: Math.round(performance.now() - startedAt),
                    });
                }

                const isAppError = data && (data.success === false || data.error);

                if (!isAppError && (res.status === 304 || res.ok)) {
                    if (!options.silent && options.showModal) {
                        setError('');
                        if (res.status === 304) {
                            setModalContent({ status: res.status, message: res.statusText, note: 'Not modified' });
                            setResponseModalOpen(true);
                        } else {
                            setOutput(data);
                            setModalContent(data);
                            setResponseModalOpen(true);
                        }
                    }
                    if (!options.silent) setOutput(data);
                } else if (!options.silent) {
                    const errorMsg = typeof data === 'string' ? data : data?.error || data?.message || res.statusText || 'Unknown Error';
                    setError(errorMsg);
                    setOutput(null);
                    setResponseModalOpen(false);
                }
            }
            return data;
        } catch (err) {
            if (!options.silent) {
                setError(err.message || String(err));
                setLastCall((prev) => ({ ...prev, status: 'Failed', durationMs: Math.round(performance.now() - startedAt) }));
            }
            throw err;
        } finally {
            if (!options.silent) setLoading(false);
        }
    }, []);

    return { loading, error, output, lastCall, activeSection, responseModalOpen, setResponseModalOpen, modalContent, callApi, setOutput };
}