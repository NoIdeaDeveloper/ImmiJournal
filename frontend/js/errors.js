// Global error boundary — catches uncaught JS errors and unhandled promise rejections.
// Logs them to the console with context so they are visible in browser dev tools.
window.addEventListener('error', (e) => {
    console.error('[ImmiJournal] Uncaught error:', e.message, '\nSource:', e.filename, 'Line:', e.lineno, '\nStack:', e.error?.stack);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('[ImmiJournal] Unhandled promise rejection:', e.reason);
});
