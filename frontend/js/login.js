function _systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function _resolveTheme(pref) {
    return pref === 'system' ? _systemTheme() : pref;
}
document.documentElement.dataset.theme = _resolveTheme(localStorage.getItem("theme") || "system");

(function () {
    const btn = document.getElementById('theme-btn');
    // The login toggle only switches between explicit dark/light; it does not
    // change the stored "system" preference used elsewhere in the app.
    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        btn.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
        localStorage.setItem('theme', theme);
    }
    applyTheme(_resolveTheme(localStorage.getItem('theme') || 'system'));
    btn.addEventListener('click', () => {
        applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
})();

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    const errorMsg = document.getElementById('error-msg');
    const password = document.getElementById('password').value;

    btn.disabled = true;
    errorMsg.style.display = 'none';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
        if (res.ok) {
            window.location.href = '/';
        } else {
            errorMsg.style.display = 'block';
            btn.disabled = false;
        }
    } catch {
        errorMsg.textContent = 'Could not reach the server. Please try again.';
        errorMsg.style.display = 'block';
        btn.disabled = false;
    }
});
