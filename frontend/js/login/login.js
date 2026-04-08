// --- Constants ---
const AUTH_ENDPOINT = 'https://backend-middleware-habitar-inmobiliaria-production.up.railway.app/api/v1/auth/login'; 

// --- DOM Elements ---
const form = document.getElementById('login-form');
const correoInput = document.getElementById('correo');
const passwordInput = document.getElementById('password');
const togglePassword = document.getElementById('toggle-password');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');
const submitBtn = document.getElementById('submit-btn');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');

// --- Toggle Password Visibility ---
togglePassword.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePassword.textContent = isPassword ? '🙈' : '👁';
});

// --- UI Helpers ---
function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    btnText.classList.toggle('hidden', isLoading);
    btnSpinner.classList.toggle('hidden', !isLoading);
}

function showError(message) {
    errorText.textContent = message;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}

// --- Reset button state when page is restored from bfcache ---
window.addEventListener('pageshow', () => {
    setLoading(false);
});

// --- 429 Rate-Limit Handler ---
let rateLimitTimer = null;
window.addEventListener('rate-limited', () => {
    if (rateLimitTimer) return;
    let remaining = 60;
    submitBtn.disabled = true;
    btnText.textContent = `Espere ${remaining}s`;
    rateLimitTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(rateLimitTimer);
            rateLimitTimer = null;
            submitBtn.disabled = false;
            btnText.textContent = 'Iniciar Sesión';
        } else {
            btnText.textContent = `Espere ${remaining}s`;
        }
    }, 1000);
});

// --- Login API Call ---
async function login(correo, password) {
    const res = await fetch(AUTH_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ correo, password })
    });

    if (!res.ok) await handleApiError(res);

    return res.json();
}

// --- Form Submit ---
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const correo = correoInput.value.trim();
    const password = passwordInput.value;

    if (!correo || !password) {
        showError('Por favor ingresa tu correo y contraseña.');
        return;
    }

    setLoading(true);

    try {
        const data = await login(correo, password);

        if (data.token) {
            localStorage.setItem('auth_token', data.token);
        }
        if (data.asesorId || data.userId) {
            localStorage.setItem('asesor_id', data.asesorId || data.userId);
        }

        window.location.href = 'dashboard.html';

    } catch (error) {
        console.error('[Login] Error:', error);
        showError(error.message || 'Ocurrió un error inesperado. Intenta de nuevo.');
        setLoading(false);
    }
});

// --- Clear error on input change ---
correoInput.addEventListener('input', hideError);
passwordInput.addEventListener('input', hideError);

