document.documentElement.dataset.theme = localStorage.getItem("theme") || "dark";

(function () {
    const btn = document.getElementById('theme-btn');
    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        btn.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
        localStorage.setItem('theme', theme);
    }
    applyTheme(localStorage.getItem('theme') || 'dark');
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
