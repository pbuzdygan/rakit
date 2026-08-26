const shell = document.querySelector('#app-shell');
const themeToggle = document.querySelector('#theme-toggle');
const toast = document.querySelector('#toast');
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

document.querySelector('#menu-toggle').addEventListener('click', () => {
  shell.classList.toggle('is-collapsed');
});

themeToggle.addEventListener('click', () => {
  const root = document.documentElement;
  const light = root.dataset.theme === 'light';
  root.dataset.theme = light ? 'dark' : 'light';
  themeToggle.querySelector('.icon').className = `icon ${light ? 'icon-sun' : 'icon-moon'}`;
});

document.querySelector('#refresh-button').addEventListener('click', () => {
  document.querySelector('#updated-label').textContent = 'Updated just now';
  showToast('Overview data refreshed');
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => showToast(`${button.dataset.action} — mockup interaction`));
});

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('is-active'));
    button.classList.add('is-active');
    showToast(`${button.dataset.view} selected — this prototype focuses on Overview`);
  });
});

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('is-active'));
    button.classList.add('is-active');
    const filter = button.dataset.filter;
    document.querySelectorAll('.attention-row').forEach((row) => {
      row.hidden = filter !== 'all' && row.dataset.level !== filter;
    });
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.target.matches('input, textarea, select')) return;
  event.preventDefault();
  document.querySelector('.global-search input').focus();
});
