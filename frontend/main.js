// ============================================================
// Constants & Config
// ============================================================
const API_BASE     = 'https://backend-middleware-habitar-inmobiliaria-production.up.railway.app/api/v1/vitrina';
const DEFAULT_TOKEN = '197928127379';

// Header needed to bypass localtunnel's HTML verification page
const TUNNEL_HEADERS = { 'bypass-tunnel-reminder': 'true' };

// Estado values from backend
const ESTADO = {
    SIN_REVISAR: null,          // no estado field or empty
    APROBADO:    'APROBADO',
    DESCARTADO:  'DESCARTADO'
};

// ============================================================
// State
// ============================================================
const state = {
    properties: [],
    agent:      null,
    token:      null,
    activeTab:  'sin-revisar',
    historicoFetched: false,
    historicoData: [],
    historicoPage: 1
};
const HISTORICO_PAGE_SIZE = 10;

/**
 * Extract the numeric wasi ID from urlReferencia.
 * e.g. ".../apartamento-venta-centenario-armenia/9798229-APROBADO" → "9798229"
 */
function extractWasiId(prop) {
    const url = prop.urlReferencia || '';
    const segment = url.split('/').pop();          // "9798229-APROBADO"
    return segment.replace(/-[A-Z_]+$/, '');       // "9798229"
}

// ============================================================
// API Service
// ============================================================
const detailCache = new Map();
let detailAbortCtrl = null;

const api = {
    async getVitrina(token) {
        const res = await fetch(`${API_BASE}/${token}`, {
            headers: TUNNEL_HEADERS
        });
        if (!res.ok) await handleApiError(res);
        return res.json();
    },

    async getHistorico(token) {
        const url = `https://backend-middleware-habitar-inmobiliaria-production.up.railway.app/api/v1/historico-inmuebles/por-cliente/${token}`;
        const res = await fetch(url, { headers: TUNNEL_HEADERS });
        if (!res.ok) await handleApiError(res);
        return res.json();
    },

    async getPropertyDetail(token, wasiId, options = {}) {
        const { cancelPrevious = false } = options;
        // Cache hit — devolver inmediatamente sin red
        if (detailCache.has(wasiId)) return detailCache.get(wasiId);

        // Solo cancelar petición previa en flujos interactivos (modal),
        // nunca en cargas en paralelo como el historial.
        let signal;
        if (cancelPrevious) {
            if (detailAbortCtrl) detailAbortCtrl.abort();
            detailAbortCtrl = new AbortController();
            signal = detailAbortCtrl.signal;
        }

        const isNumeric = /^\d+$/.test(String(wasiId));
        let data;

        try {
            if (isNumeric) {
                const res = await fetch(`${API_BASE}/${token}/inmuebles/${wasiId}`, {
                    headers: TUNNEL_HEADERS,
                    signal
                });
                if (!res.ok) await handleApiError(res);
                data = await res.json();
            } else {
                const PRIVADOS_API = 'https://backend-middleware-habitar-inmobiliaria-production.up.railway.app/api/v1/inmuebles-privados';
                const res = await fetch(`${PRIVADOS_API}/${wasiId}`, { signal });
                if (!res.ok) await handleApiError(res);
                data = await res.json();

                if (data.imagenes && !data.galeriasImagenes) data.galeriasImagenes = data.imagenes;
                if (data.precio && !data.precioFormateado) {
                    data.precioFormateado = `$${Number(data.precio).toLocaleString('es-CO')}`;
                }
            }

            detailCache.set(wasiId, data);
            return data;
        } catch (err) {
            if (err.name === 'AbortError') return; // ignorar cancelaciones voluntarias
            throw err;
        }
    },

    async aprobar(token, url) {
        const res = await fetch(`${API_BASE}/${token}/estado/aprobar`, {
            method:  'PATCH',
            headers: { ...TUNNEL_HEADERS, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ url })
        });
        if (!res.ok) await handleApiError(res);
        return res.ok;
    },

    async descartar(token, url) {
        const res = await fetch(`${API_BASE}/${token}/estado/descartar`, {
            method:  'PATCH',
            headers: { ...TUNNEL_HEADERS, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ url })
        });
        if (!res.ok) await handleApiError(res);
        return res.ok;
    },

    async visitar(token, url) {
        const res = await fetch(`${API_BASE}/${token}/estado/visitar`, {
            method:  'PATCH',
            headers: { ...TUNNEL_HEADERS, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ url })
        });
        if (!res.ok) await handleApiError(res);
        return res.ok;
    }
};


// ============================================================
// Helpers
// ============================================================
function getEstado(prop) {
    const e = (prop.estado || '').toUpperCase();
    if (e === 'APROBADO')   return 'aprobado';
    if (e === 'DESCARTADO') return 'descartado';
    if (e === 'VISITADO')   return 'visitado';

    // Prevención bilingüe: Airtable usa prop.url, Wasi usa prop.urlReferencia
    const url = (prop.url || prop.urlReferencia || '').toUpperCase();
    if (url.endsWith('-APROBADO'))   return 'aprobado';
    if (url.endsWith('-DESCARTADO')) return 'descartado';
    if (url.endsWith('-VISITADO'))   return 'visitado';

    return 'sin-revisar';
}

function buildUrlWasi(prop) {
    return prop.urlReferencia || '';
}

function formatHistoryDate(isoString) {
    if (!isoString) return '';
    try {
        const d = new Date(isoString);
        return d.toLocaleDateString('es-CO', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return isoString;
    }
}

function normalizeHistoryState(estadoCodigo) {
    const code = String(estadoCodigo || '').toUpperCase();
    if (code === 'APROBADO') return 'APROBADO';
    if (code === 'DESCARTADO') return 'DESCARTADO';
    if (code === 'VISITADO') return 'VISITADO';
    if (code === 'REVISADO') return 'REVISADO';
    return 'SIN_REVISAR';
}

function getLatestHistoryByProperty(histData) {
    const latestByCode = new Map();
    (histData || []).forEach(item => {
        if (!item || !item.codigoNumerico) return;
        const prev = latestByCode.get(item.codigoNumerico);
        if (!prev) {
            latestByCode.set(item.codigoNumerico, item);
            return;
        }
        const prevTs = Date.parse(prev.fechaCreacion || 0) || 0;
        const currTs = Date.parse(item.fechaCreacion || 0) || 0;
        if (currTs >= prevTs) latestByCode.set(item.codigoNumerico, item);
    });
    return Array.from(latestByCode.values());
}

// ============================================================
// UI: DOM references
// ============================================================
const elPropertyList  = document.getElementById('property-list');
const elLoadingState  = document.getElementById('loading-state');
const elEmptyState    = document.getElementById('empty-state');
const elEmptyIcon     = document.getElementById('empty-icon');
const elEmptyTitle    = document.getElementById('empty-title');
const elEmptyDesc     = document.getElementById('empty-desc');
const elAgentProfile  = document.getElementById('agent-profile');
const elModal         = document.getElementById('detail-modal');
const elModalBody     = document.getElementById('modal-body');
const elModalClose    = document.querySelector('.modal-close');
const elTemplate      = document.getElementById('property-card-template');
const elTabBtns       = document.querySelectorAll('.tab-btn');
const elBadgeSin      = document.getElementById('badge-sin-revisar');
const elBadgeApr      = document.getElementById('badge-aprobadas');
const elBadgeDes      = document.getElementById('badge-descartadas');
const elBadgeVis      = document.getElementById('badge-visitados');
const elHistoricoPagination = document.getElementById('historico-pagination');
const elHistoricoPrev = document.getElementById('historico-prev');
const elHistoricoNext = document.getElementById('historico-next');
const elHistoricoPageInfo = document.getElementById('historico-page-info');
const elHistoricoLoading = document.getElementById('historico-loading');

// ============================================================
// Helpers: Phone Parsing
// ============================================================
/**
 * Parses a phone string that may contain an extension.
 * Handles:
 *   - "3209929718 extensión 101"  (text with accent variants / encoding issues)
 *   - "1013209929718"             (extension prepended as digits)
 * Returns { main, ext } — ext is empty string if none found.
 */
function parsePhone(raw) {
    if (!raw) return { main: '', ext: '' };

    // Case 1: contains text keyword "extensi" (handles encoding variants: extensión / extensiÃ³n / extension)
    const textMatch = raw.match(/^([\d\s\(\)\+\-]+?)\s*extensi[^0-9]*(\d+)/i);
    if (textMatch) {
        return { main: textMatch[1].trim(), ext: textMatch[2].trim() };
    }

    // Case 2: pure digit string longer than 10 digits — first N extras are the extension
    const digits = raw.replace(/\D/g, '');
    if (digits.length > 10) {
        const ext  = digits.slice(0, digits.length - 10);
        const main = digits.slice(digits.length - 10);
        return { main, ext };
    }

    return { main: raw.trim(), ext: '' };
}


function renderAgent(agent) {
    if (!agent) return;

    const { main: phoneMain, ext } = parsePhone(agent.telefono);
    const phoneHTML = phoneMain
        ? `<span class="phone-number">${phoneMain}</span>${ext
            ? ` &nbsp;<span class="phone-ext">Ext. ${ext}</span>`
            : ''}`
        : '';

    elAgentProfile.innerHTML = `
        <img src="${agent.fotoUrl || 'https://via.placeholder.com/150'}"
             alt="Foto de ${agent.nombreCompleto || 'Asesor'}"
             class="agent-photo">
        <div class="agent-info-col">
            <h2 class="agent-card-title">TU ASESOR ENCARGADO</h2>
            <h3 class="agent-name">${agent.nombreCompleto || 'Asesor Inmobiliario'}</h3>
            <div class="agent-details">
                <p>${agent.correo || ''}</p>
                <p class="agent-phone"><strong>Tel:</strong> ${phoneHTML}</p>
            </div>
        </div>
        <a href="${agent.linkMeeting || '#'}" target="_blank" class="agent-action-btn">
            Agendar Reunión
        </a>
    `;
}


// ============================================================
// UI: Tab Badges
// ============================================================
function updateBadges() {
    const counts = { 'sin-revisar': 0, aprobado: 0, descartado: 0, visitado: 0 };
    state.properties.forEach(p => { counts[getEstado(p)]++; });
    elBadgeSin.textContent = counts['sin-revisar'];
    elBadgeApr.textContent = counts.aprobado;
    elBadgeDes.textContent = counts.descartado;
    if (elBadgeVis) elBadgeVis.textContent = counts.visitado;
}

// ============================================================
// UI: Render Properties
// ============================================================
function renderCurrentTab() {
    // Remove previous cards
    elPropertyList.querySelectorAll('.property-card').forEach(c => c.remove());
    elEmptyState.classList.add('hidden');
    elHistoricoPagination.classList.add('hidden');
    elHistoricoLoading.classList.add('hidden');

    const tab = state.activeTab;
    let filtered = tab === 'historico'
        ? state.historicoData
        : state.properties.filter(p => {
            const e = getEstado(p);
            if (tab === 'sin-revisar')  return e === 'sin-revisar';
            if (tab === 'aprobadas')    return e === 'aprobado';
            if (tab === 'descartadas')  return e === 'descartado';
            if (tab === 'visitados')    return e === 'visitado';
            return false;
        });

    if (tab === 'historico') {
        const totalPages = Math.max(1, Math.ceil(state.historicoData.length / HISTORICO_PAGE_SIZE));
        if (state.historicoPage > totalPages) state.historicoPage = totalPages;
        if (state.historicoPage < 1) state.historicoPage = 1;

        const start = (state.historicoPage - 1) * HISTORICO_PAGE_SIZE;
        filtered = state.historicoData.slice(start, start + HISTORICO_PAGE_SIZE);

        if (state.historicoData.length > HISTORICO_PAGE_SIZE) {
            elHistoricoPagination.classList.remove('hidden');
            elHistoricoPageInfo.textContent = `Página ${state.historicoPage} de ${totalPages}`;
            elHistoricoPrev.disabled = state.historicoPage === 1;
            elHistoricoNext.disabled = state.historicoPage === totalPages;
        }
    }

    if (filtered.length === 0) {
        showEmptyState(tab);
        return;
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach(prop => {
        const clone = elTemplate.content.cloneNode(true);
        const card  = clone.querySelector('.property-card');

        card.dataset.id = prop.id;
        const imgEl = card.querySelector('.property-image');
        imgEl.src     = prop.imagenUrl || '';
        imgEl.alt     = prop.titulo || 'Propiedad';
        imgEl.loading = 'lazy';

        const priceBadge = card.querySelector('.price-badge');
        const rawPrice = prop.precioFormateado || '';
        const isZeroPrice = !rawPrice || /^\$?\s*0+([.,]0+)?$/.test(rawPrice.trim());
        if (isZeroPrice) {
            priceBadge.style.display = 'none';
        } else {
            priceBadge.textContent = rawPrice;
        }
        card.querySelector('.property-title').textContent = prop.titulo || '';
        card.querySelector('.property-location').innerHTML = `📍 ${prop.ubicacion || ''}`;
        card.querySelector('.property-description').textContent = prop.descripcionCorta || '';

        const openDetail = () => openPropertyDetail(prop.id);
        card.querySelector('.property-image-wrapper').addEventListener('click', openDetail);
        card.querySelector('.property-image-wrapper').style.cursor = 'pointer';
        card.querySelector('.property-title').addEventListener('click', openDetail);
        card.querySelector('.property-title').style.cursor = 'pointer';

        if (tab === 'historico' && prop._historyMeta) {
            const metaDiv = card.querySelector('.property-history-meta');
            const badgeSpan = metaDiv.querySelector('.history-state-badge');
            const dateSpan = metaDiv.querySelector('.history-date');
            const stateCode = normalizeHistoryState(prop._historyMeta.estadoCodigo);
            const badgeText = stateCode === 'APROBADO' ? 'TE INTERESO' : stateCode.replace('_', ' ');
            const badgeClass = stateCode === 'APROBADO' ? 'state-te-intereso' : `state-${stateCode.toLowerCase()}`;

            metaDiv.classList.remove('hidden');
            badgeSpan.textContent = badgeText;
            badgeSpan.className = `history-state-badge ${badgeClass}`;
            dateSpan.textContent = formatHistoryDate(prop._historyMeta.fechaCreacion);
        }

        const actionBar = card.querySelector('.action-bar');
        buildActionButtons(actionBar, prop, card, tab);

        fragment.appendChild(card);
    });

    elPropertyList.appendChild(fragment);
}

// ============================================================
// UI: Action Buttons (per tab)
// ============================================================
function buildActionButtons(actionBar, prop, card, tab) {
    actionBar.innerHTML = '';

    // Soporte híbrido: Airtable entrega prop.url, Wasi entrega prop.urlReferencia
    const url = prop.url || prop.urlReferencia || '';

    if (tab === 'sin-revisar') {
        actionBar.appendChild(makeBtn('discard', '✕ Descartar', async () => {
            await handleAction(prop, card, 'descartar', url);
        }));
        actionBar.appendChild(makeBtn('approve', '⭐ Me interesa', async () => {
            await handleAction(prop, card, 'aprobar', url);
        }));

    } else if (tab === 'aprobadas') {
        actionBar.appendChild(makeBtn('discard', '✕ Descartar', async () => {
            await handleAction(prop, card, 'descartar', url);
        }));

    } else if (tab === 'descartadas') {
        actionBar.appendChild(makeBtn('approve', '⭐ Me interesa nuevamente', async () => {
            await handleAction(prop, card, 'aprobar', url);
        }));

    }
    // 'visitados' and 'historico' → no buttons (read-only)
}

function makeBtn(type, label, onClick) {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = type === 'approve'
        ? 'btn btn-approve'
        : 'btn btn-discard-tab';
    btn.innerHTML = label;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
}

// ============================================================
// UI: Empty State
// ============================================================
const EMPTY_COPY = {
    'sin-revisar': {
        icon:  '',
        title: '¡Todo revisado!',
        desc:  'No hay propiedades pendientes por revisar.'
    },
    'aprobadas': {
        icon:  '',
        title: 'Sin aprobadas aún',
        desc:  'Aprueba propiedades de la sección "Sin revisar" para verlas aquí.'
    },
    'descartadas': {
        icon:  '',
        title: 'Sin descartadas',
        desc:  'No has descartado ninguna propiedad todavía.'
    },
    'visitados': {
        icon:  '',
        title: 'Sin visitados aún',
        desc:  'Las propiedades que hayas visitado aparecerán aquí.'
    },
    'historico': {
        icon:  '',
        title: 'Sin historial',
        desc:  'Aún no hay inmuebles registrados en tu historial.'
    }
};

function showEmptyState(tab) {
    const copy = EMPTY_COPY[tab] || EMPTY_COPY['sin-revisar'];
    elEmptyIcon.textContent  = copy.icon;
    elEmptyTitle.textContent = copy.title;
    elEmptyDesc.textContent  = copy.desc;
    elEmptyState.classList.remove('hidden');
}

async function loadHistoricoTab() {
    elPropertyList.querySelectorAll('.property-card').forEach(c => c.remove());
    elEmptyState.classList.add('hidden');
    elHistoricoPagination.classList.add('hidden');
    elHistoricoLoading.classList.remove('hidden');
    elLoadingState.classList.remove('hidden');

    try {
        const histData = await api.getHistorico(state.token);
        const latestRecords = getLatestHistoryByProperty(histData);

        const details = await Promise.all(latestRecords.map(async item => {
            try {
                const pDetail = await api.getPropertyDetail(state.token, item.codigoNumerico);
                if (!pDetail) return null;
                return {
                    ...pDetail,
                    id: item.codigoNumerico,
                    imagenUrl: (pDetail.galeriasImagenes && pDetail.galeriasImagenes.length > 0) ? pDetail.galeriasImagenes[0] : '',
                    descripcionCorta: pDetail.observaciones || pDetail.descripcionCorta || '',
                    precioFormateado: pDetail.precioFormateado || (pDetail.precio ? `$${Number(pDetail.precio).toLocaleString('es-CO')}` : ''),
                    urlReferencia: pDetail.urlReferencia || pDetail.url || '',
                    titulo: pDetail.titulo || '',
                    _historyMeta: item
                };
            } catch (err) {
                console.warn('Could not fetch detail for historico item', item.codigoNumerico, err);
                return null;
            }
        }));

        state.historicoData = details.filter(Boolean);
        state.historicoFetched = true;
        state.historicoPage = 1;
    } catch (e) {
        console.error('Error loading historico', e);
        state.historicoData = [];
        state.historicoFetched = true;
        state.historicoPage = 1;
    } finally {
        elLoadingState.classList.add('hidden');
        elHistoricoLoading.classList.add('hidden');
        renderCurrentTab();
    }
}

// ============================================================
// Action Handler (Aprobar / Descartar)
// ============================================================
async function handleAction(prop, card, action, url) {
    if (card.classList.contains('processing')) return;
    card.classList.add('processing');

    // Disable all buttons in card
    card.querySelectorAll('button').forEach(b => b.disabled = true);

    try {
        if (action === 'aprobar') {
            await api.aprobar(state.token, url);
            prop.estado = 'APROBADO';
        } else {
            await api.descartar(state.token, url);
            prop.estado = 'DESCARTADO';
        }

        // Animate removal from current tab
        await animateRemoval(card, action === 'aprobar' ? 'right' : 'left');

        updateBadges();
        renderCurrentTab();  // re-render after state change

    } catch (err) {
        console.error('Action failed:', err);
        showToast('⚠ Hubo un problema, intenta de nuevo.');
        card.classList.remove('processing');
        card.querySelectorAll('button').forEach(b => b.disabled = false);
    }
}

// ============================================================
// Animations & Toast
// ============================================================
function animateRemoval(card, direction) {
    return new Promise(resolve => {
        card.classList.add(direction === 'right' ? 'slide-out-right' : 'slide-out-left');
        setTimeout(() => { card.remove(); resolve(); }, 300);
    });
}

let toastTimer;
function showToast(msg) {
    let toast = document.getElementById('vitrina-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id        = 'vitrina-toast';
        toast.className = 'vitrina-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================================
// Modal: Property Detail
// ============================================================
function openPropertyDetail(wasiId) {
    elModalBody.innerHTML = '<div class="modal-loading"><div class="spinner"></div><p>Cargando detalles...</p></div>';
    elModal.classList.remove('hidden');
    elModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';   // freeze background scroll

    api.getPropertyDetail(state.token, wasiId, { cancelPrevious: true })
        .then(d => { elModalBody.innerHTML = buildDetailHTML(d); initGallery(); })
        .catch(() => {
            elModalBody.innerHTML = '<p class="modal-error">Error cargando el detalle del inmueble.</p>';
        });
}

function buildPriceBlock(d) {
    const raw = d.precioFormateado || '';

    // Dual price: "Venta: $970.000.000 | Alquiler: $6.500.000"
    if (raw.includes('|')) {
        const parts = raw.split('|').map(s => s.trim());
        const cards = parts.map(part => {
            // Extract label and amount, e.g. "Venta: $970.000.000"
            const match = part.match(/^(.+?):\s*(.+)$/);
            const label = match ? match[1].trim() : '';
            const amount = match ? match[2].trim() : part;
            const isRent = /alquiler|arriendo|renta/i.test(label);
            return `
              <div class="price-card">
                <small>Precio de ${label.toLowerCase()}</small>
                <div class="modal-price">${amount}${isRent ? '<span class="price-period">Mensual</span>' : ''}</div>
                <small>Pesos Colombianos</small>
              </div>`;
        }).join('');
        return `<div class="modal-price-block dual-price">${cards}</div>`;
    }

    // Single price (default)
    return `
      <div class="modal-price-block">
        <small>Precio de ${(d.tipoNegocio || '').toLowerCase()}</small>
        <div class="modal-price">${raw}</div>
        <small>Pesos Colombianos</small>
      </div>`;
}

/**
 * Get highest quality image URL by stripping Wasi CDN size suffixes.
 * e.g. "https://static-cf.wasi.co/…/image_340x…" → "https://static-cf.wasi.co/…/image…"
 * This lets the browser request the original full-resolution file.
 */
function getHighQualityUrl(src) {
    if (!src) return src;
    // Remove common Wasi size suffixes like _340x, _640x, _1024x, etc.
    return src.replace(/_\d+x(?=\.|$)/g, '');
}

function buildDetailHTML(d) {
    const imgs = (d.galeriasImagenes && d.galeriasImagenes.length)
        ? d.galeriasImagenes
        : ['https://via.placeholder.com/800x500?text=Sin+imagen'];

    const thumbs = imgs.map((src, i) =>
        `<img src="${src}" class="gallery-thumb${i === 0 ? ' active' : ''}" data-index="${i}" alt="Foto ${i+1}">`
    ).join('');

    const specRows = [
        ['Tipo de negocio',      d.tipoNegocio],
        ['Tipo de inmueble',     d.tipoInmueble],
        ['Ubicación',            d.ubicacion],
        ['Zona',                 d.zona],
        ['Dirección',            d.direccion],
        ['Estrato',              d.estrato],
        ['Piso',                 d.piso],
        ['Habitaciones',         d.habitaciones],
        ['Baños',                d.banos],
        ['Estacionamiento',      d.estacionamiento],
        ['Área Construida',      d.areaConstruida],
        ['Área Terreno',         d.areaTerreno],
        ['Área Privada',         d.areaPrivada],
        ['Estado físico',        ({'Used':'Usado','New':'Nuevo'}[d.estadoFisico] || d.estadoFisico)],
        ['Año construcción',     d.anioConstruccion],
        ['Valor administración', d.valorAdministracion],
        ['Encargado',            d.encargado],
    ].filter(([, v]) => v && !/^\s*(m²|m2|0)?\s*$/i.test(String(v)));

    const specRows2Col = specRows.map(([k, v]) =>
        `<div class="spec-row"><span class="spec-label">${k}:</span><span class="spec-value">${v}</span></div>`
    ).join('');

    const checkList = (arr) => (arr || []).map(item =>
        `<div class="char-item"><span class="char-check">✓</span>${item}</div>`
    ).join('');

    // Encode image URLs as a data attribute for the lightbox
    const imgsDataAttr = encodeURIComponent(JSON.stringify(imgs));

    return `
      <div class="modal-two-col" data-gallery-images="${imgsDataAttr}">

        <!-- LEFT: Gallery Carousel -->
        <div class="modal-gallery-col">
          <div class="carousel-viewport">
            <div class="carousel-track" id="carousel-track">
              ${imgs.map((src, i) =>
                `<div class="carousel-slide" data-img-index="${i}"><img src="${src}" alt="${d.titulo || ''} - Foto ${i+1}" class="carousel-img" loading="lazy"></div>`
              ).join('')}
            </div>
            <button class="gallery-arrow gallery-prev" aria-label="Anterior">&#8249;</button>
            <button class="gallery-arrow gallery-next" aria-label="Siguiente">&#8250;</button>
          </div>
          <div class="gallery-thumbs">${thumbs}</div>
        </div>

        <!-- RIGHT: Title + Price + Specs -->
        <div class="modal-specs-col">
          <h2 class="modal-title">${d.titulo || ''}</h2>

          ${buildPriceBlock(d)}


          <div class="spec-list">${specRows2Col}</div>
        </div>
      </div>

      <!-- BOTTOM: Characteristics full-width -->
      <div class="modal-chars-row">
        ${(d.caracteristicasInternas && d.caracteristicasInternas.length) ? `
        <section class="detail-section">
          <h3 class="detail-section-title">Características internas</h3>
          <div class="char-grid">${checkList(d.caracteristicasInternas)}</div>
        </section>` : ''}

        ${(d.caracteristicasExternas && d.caracteristicasExternas.length) ? `
        <section class="detail-section">
          <h3 class="detail-section-title">Características externas</h3>
          <div class="char-grid">${checkList(d.caracteristicasExternas)}</div>
        </section>` : ''}
      </div>
    `;
}


function initGallery() {
    const track   = document.getElementById('carousel-track');
    const slides  = track.querySelectorAll('.carousel-slide');
    const thumbs  = document.querySelectorAll('.gallery-thumb');
    const total   = slides.length;
    let current   = 0;

    // Extract gallery images from data attribute
    const twoColEl = document.querySelector('.modal-two-col[data-gallery-images]');
    let galleryImages = [];
    if (twoColEl) {
        try {
            galleryImages = JSON.parse(decodeURIComponent(twoColEl.dataset.galleryImages));
        } catch (e) { /* ignore */ }
    }

    function show(i) {
        current = ((i % total) + total) % total;
        track.style.transform = `translateX(-${current * 100}%)`;
        thumbs.forEach((t, idx) => t.classList.toggle('active', idx === current));
    }

    thumbs.forEach((t, i) => t.addEventListener('click', () => show(i)));
    document.querySelector('.gallery-prev').addEventListener('click', () => show(current - 1));
    document.querySelector('.gallery-next').addEventListener('click', () => show(current + 1));

    // Click on carousel image → open lightbox at that index
    slides.forEach((slide) => {
        slide.addEventListener('click', () => {
            const idx = parseInt(slide.dataset.imgIndex || '0', 10);
            if (galleryImages.length > 0) {
                openLightbox(galleryImages, idx);
            }
        });
    });

    // Click on thumbnails also opens lightbox
    thumbs.forEach((t, i) => {
        t.addEventListener('dblclick', () => {
            if (galleryImages.length > 0) {
                openLightbox(galleryImages, i);
            }
        });
    });

    // Touch/swipe support for mobile
    let startX = 0;
    const viewport = track.parentElement;
    viewport.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    viewport.addEventListener('touchend', e => {
        const diff = startX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) show(current + (diff > 0 ? 1 : -1));
    }, { passive: true });
}

// ============================================================
// Lightbox: Fullscreen Image Viewer
// ============================================================
let lightboxEl = null;
let lightboxState = { images: [], current: 0, active: false };

function createLightboxDOM() {
    if (lightboxEl) return;

    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.id = 'lightbox-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Visor de imágenes en pantalla completa');

    overlay.innerHTML = `
        <button class="lightbox-close" aria-label="Cerrar visor">✕</button>
        <button class="lightbox-arrow lightbox-prev" aria-label="Imagen anterior">&#8249;</button>
        <div class="lightbox-img-container">
            <img class="lightbox-img" src="" alt="Imagen en detalle">
        </div>
        <button class="lightbox-arrow lightbox-next" aria-label="Imagen siguiente">&#8250;</button>
        <div class="lightbox-thumbs" id="lightbox-thumbs"></div>
        <div class="lightbox-counter" id="lightbox-counter">1 / 1</div>
    `;

    document.body.appendChild(overlay);
    lightboxEl = overlay;

    // Events
    overlay.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
    overlay.querySelector('.lightbox-prev').addEventListener('click', () => lightboxNav(-1));
    overlay.querySelector('.lightbox-next').addEventListener('click', () => lightboxNav(1));

    // Click on backdrop closes
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.classList.contains('lightbox-img-container')) {
            closeLightbox();
        }
    });

    // Block touchmove to prevent background scroll bleed-through on mobile
    overlay.addEventListener('touchmove', e => { e.preventDefault(); }, { passive: false });

    // Touch/swipe support (uses touchstart/touchend, not touchmove)
    let lbStartX = 0;
    overlay.addEventListener('touchstart', e => { lbStartX = e.touches[0].clientX; }, { passive: true });
    overlay.addEventListener('touchend', e => {
        const diff = lbStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 60) lightboxNav(diff > 0 ? 1 : -1);
    }, { passive: true });
}

function openLightbox(images, startIndex) {
    createLightboxDOM();

    lightboxState.images = images;
    lightboxState.current = startIndex || 0;
    lightboxState.active = true;

    // Lock body scroll — save position to prevent jump
    lightboxState.scrollY = window.scrollY;
    document.body.classList.add('lightbox-open');
    document.body.style.top = `-${lightboxState.scrollY}px`;

    // Build thumbnail strip
    const thumbsContainer = lightboxEl.querySelector('#lightbox-thumbs');
    thumbsContainer.innerHTML = images.map((src, i) =>
        `<img src="${src}" class="lightbox-thumb${i === lightboxState.current ? ' active' : ''}" data-index="${i}" alt="Miniatura ${i + 1}">`
    ).join('');

    // Thumb click handlers
    thumbsContainer.querySelectorAll('.lightbox-thumb').forEach(t => {
        t.addEventListener('click', () => {
            lightboxShowImage(parseInt(t.dataset.index, 10));
        });
    });

    lightboxShowImage(lightboxState.current);

    // Show overlay with small delay for CSS transition
    requestAnimationFrame(() => {
        lightboxEl.classList.add('active');
    });
}

function lightboxShowImage(index) {
    const total = lightboxState.images.length;
    lightboxState.current = ((index % total) + total) % total;

    const img = lightboxEl.querySelector('.lightbox-img');
    const src = lightboxState.images[lightboxState.current];

    // Use highest quality URL
    const hqSrc = getHighQualityUrl(src);

    // Fade out, swap, fade in
    img.style.opacity = '0';
    img.style.transform = 'scale(0.92)';

    setTimeout(() => {
        img.src = hqSrc;
        img.alt = `Imagen ${lightboxState.current + 1} de ${total}`;

        // Once loaded, reveal
        img.onload = () => {
            img.style.opacity = '1';
            img.style.transform = 'scale(1)';
        };

        // Fallback: if the HQ URL fails, fall back to original
        img.onerror = () => {
            if (img.src !== src) {
                img.src = src;
            }
            img.style.opacity = '1';
            img.style.transform = 'scale(1)';
        };
    }, 150);

    // Update counter
    const counter = lightboxEl.querySelector('#lightbox-counter');
    counter.textContent = `${lightboxState.current + 1} / ${total}`;

    // Update thumb active state
    lightboxEl.querySelectorAll('.lightbox-thumb').forEach((t, i) => {
        t.classList.toggle('active', i === lightboxState.current);
        if (i === lightboxState.current) {
            t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    });
}

function lightboxNav(direction) {
    lightboxShowImage(lightboxState.current + direction);
}

function closeLightbox() {
    if (!lightboxEl) return;
    lightboxState.active = false;
    lightboxEl.classList.remove('active');

    // Unlock body scroll — restore position
    document.body.classList.remove('lightbox-open');
    document.body.style.top = '';
    window.scrollTo(0, lightboxState.scrollY || 0);
}

// ============================================================
// Modal Close
// ============================================================
function closeModal() {
    elModal.classList.add('hidden');
    elModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';   // restore background scroll
}


elModalClose.addEventListener('click', closeModal);
elModal.addEventListener('click', e => { if (e.target === elModal) closeModal(); });

// Keyboard navigation: Escape, Left/Right arrows
document.addEventListener('keydown', e => {
    // Lightbox takes priority over modal
    if (lightboxState.active) {
        if (e.key === 'Escape') { closeLightbox(); e.stopPropagation(); return; }
        if (e.key === 'ArrowLeft')  { lightboxNav(-1); return; }
        if (e.key === 'ArrowRight') { lightboxNav(1); return; }
        return;
    }
    if (e.key === 'Escape' && !elModal.classList.contains('hidden')) closeModal();
});

elHistoricoPrev.addEventListener('click', () => {
    if (state.activeTab !== 'historico') return;
    if (state.historicoPage <= 1) return;
    state.historicoPage -= 1;
    renderCurrentTab();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

elHistoricoNext.addEventListener('click', () => {
    if (state.activeTab !== 'historico') return;
    const totalPages = Math.max(1, Math.ceil(state.historicoData.length / HISTORICO_PAGE_SIZE));
    if (state.historicoPage >= totalPages) return;
    state.historicoPage += 1;
    renderCurrentTab();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ============================================================
// Tabs
// ============================================================
elTabBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        elTabBtns.forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        state.activeTab = btn.dataset.tab;

        if (state.activeTab === 'historico' && !state.historicoFetched) {
            await loadHistoricoTab();
        } else {
            renderCurrentTab();
        }
    });
});

// ============================================================
// Init
// ============================================================
async function init() {
    const params = new URLSearchParams(window.location.search);

    // Support encoded token (?t=base64) and legacy plain token (?token=...)
    function decodeToken(raw) {
        try { return atob(raw); } catch { return raw; }
    }
    const rawParam = params.get('t') || params.get('token');
    state.token = rawParam ? decodeToken(rawParam) : DEFAULT_TOKEN;

    console.log(`Vitrina token: ${state.token}`);

    try {
        const data       = await api.getVitrina(state.token);
        state.agent      = data.asesor    || {};
        state.properties = data.inmuebles || [];

        elLoadingState.classList.add('hidden');

        renderAgent(state.agent);
        updateBadges();
        renderCurrentTab();

    } catch (err) {
        console.error(err);
        elLoadingState.classList.add('hidden');
        elEmptyState.classList.remove('hidden');
        elEmptyIcon.textContent  = '⚠️';
        elEmptyTitle.textContent = 'Error al cargar';
        elEmptyDesc.textContent  = 'No pudimos cargar la vitrina. Verifica tu conexión o el enlace.';
    }
}

document.addEventListener('DOMContentLoaded', init);
