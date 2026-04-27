// NexusHub — shared theme toggle
(function() {
  const html = document.documentElement;
  const saved = localStorage.getItem('nh-theme');
  if (saved === 'dark') html.setAttribute('data-theme', 'dark');

  function updateLabel(btn) {
    if (!btn) return;
    const isDark = html.getAttribute('data-theme') === 'dark';
    btn.innerHTML = isDark
      ? '<span class="theme-icon">☀️</span> Light'
      : '<span class="theme-icon">🌙</span> Dark';
  }

  window.addEventListener('DOMContentLoaded', () => {
    const btns = document.querySelectorAll('[data-theme-toggle]');
    btns.forEach(btn => {
      updateLabel(btn);
      btn.addEventListener('click', () => {
        const isDark = html.getAttribute('data-theme') === 'dark';
        if (isDark) {
          html.removeAttribute('data-theme');
          localStorage.setItem('nh-theme', 'light');
        } else {
          html.setAttribute('data-theme', 'dark');
          localStorage.setItem('nh-theme', 'dark');
        }
        document.querySelectorAll('[data-theme-toggle]').forEach(updateLabel);
      });
    });
  });
})();
