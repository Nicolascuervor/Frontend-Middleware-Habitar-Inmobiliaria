// ============================================================
// Centralized API Error Handler
// ============================================================
// Parses backend error responses and throws user-friendly errors.
// Handles: 400, 401, 403, 404, 429, 500, 502

/**
 * Parses the backend JSON response body safely.
 * Supports standard { mensaje } and @Valid { errors: [{field, defaultMessage}] } formats.
 */
async function parseErrorBody(res) {
    try {
        const text = await res.text();
        if (!text) return {};
        return JSON.parse(text);
    } catch {
        return {};
    }
}

/**
 * Extracts a human-readable message from the backend error body.
 * - Standard format: { mensaje: "..." }
 * - @Valid format:   { errors: [{ field, defaultMessage }] }
 * - Plain text fallback
 */
function extractMessage(body) {
    if (body.mensaje) return body.mensaje;

    if (Array.isArray(body.errors)) {
        return body.errors.map(e => e.defaultMessage || e.message).join('. ');
    }

    if (body.message) return body.message;

    return '';
}

/**
 * Main error handler — call after a failed fetch response.
 * Throws an Error with the appropriate user-facing message.
 * For 401, clears auth and redirects to login.
 * For 429, dispatches 'rate-limited' event on window.
 */
async function handleApiError(res) {
    const status = res.status;
    const body = await parseErrorBody(res);
    const backendMsg = extractMessage(body);

    switch (status) {
        case 400:
            throw new Error(backendMsg || 'Datos de entrada inválidos.');

        case 401:
            localStorage.removeItem('auth_token');
            window.location.href = 'login.html';
            throw new Error('Sesión expirada. Redirigiendo al login...');

        case 403:
            throw new Error('No tienes permisos para esta acción.');

        case 404:
            throw new Error(backendMsg || 'Recurso no encontrado.');

        case 429:
            window.dispatchEvent(new CustomEvent('rate-limited', {
                detail: { mensaje: backendMsg || 'Demasiados intentos. Espere 1 minuto.' }
            }));
            throw new Error(backendMsg || 'Demasiados intentos. Espere 1 minuto.');

        case 500:
            throw new Error(backendMsg || 'Ocurrió un error interno. Por favor, intenta de nuevo.');

        case 502:
            throw new Error('Servicio temporalmente no disponible, intente más tarde.');

        default:
            throw new Error(backendMsg || `Error inesperado (${status}).`);
    }
}
