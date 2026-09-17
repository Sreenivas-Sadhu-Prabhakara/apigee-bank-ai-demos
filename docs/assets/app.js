const data = JSON.parse(document.querySelector('#playbook-data').textContent);
const pages = [...document.querySelectorAll('[data-page]')];
const dialog = document.querySelector('.search-dialog');
const searchInput = document.querySelector('#site-search');
const results = document.querySelector('.search-results');
const menu = document.querySelector('.mobile-menu');
const sidebar = document.querySelector('.sidebar');
const scrim = document.querySelector('.nav-scrim');
let toastTimer;

function notify(message) {
  const toast = document.querySelector('.toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function closeMenu() {
  sidebar.classList.remove('is-open');
  scrim.hidden = true;
  menu.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('nav-open');
}

function route() {
  if (location.hash === '#main') return;
  const [, requested, anchor] = location.hash.split('/');
  const id = pages.some(p => p.dataset.page === requested) ? requested : 'overview';
  const title = data.pages.find(p => p.id === id)?.title || 'Overview';
  for (const page of pages) page.hidden = page.dataset.page !== id;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.querySelector('#current-page').textContent = title;
  document.title = `${title} — Banking AI Playbook`;
  closeMenu();
  if (dialog.open) dialog.close();
  if (anchor) {
    const target = document.getElementById(`${id}--${decodeURIComponent(anchor)}`);
    if (target) requestAnimationFrame(() => target.scrollIntoView({block: 'start'}));
    else window.scrollTo({top: 0, behavior: 'instant'});
  } else window.scrollTo({top: 0, behavior: 'instant'});
}

function showResults(query = '') {
  results.replaceChildren();
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let matches;
  if (!terms.length) {
    matches = data.pages.map(p => ({...p, page: p.id, heading: p.category, text: 'Open the guide', anchor: ''}));
  } else {
    matches = data.search.map(item => {
      const haystack = `${item.title} ${item.heading} ${item.text}`.toLowerCase();
      const score = terms.every(t => haystack.includes(t)) ? terms.reduce((sum, t) => sum + (item.heading.toLowerCase().includes(t) ? 5 : 0) + (item.title.toLowerCase().includes(t) ? 3 : 0) + 1, 0) : 0;
      return {...item, score};
    }).filter(item => item.score).sort((a, b) => b.score - a.score).slice(0, 14);
  }
  if (!matches.length) {
    const p = document.createElement('p');
    p.className = 'search-empty';
    p.textContent = `No matches for “${query}”. Try “confirmation”, “Ollama”, or “MCP”.`;
    results.append(p);
  }
  for (const item of matches) {
    const a = document.createElement('a');
    a.className = 'search-result';
    a.href = `#/${item.page}${item.anchor ? '/' + item.anchor : ''}`;
    const title = document.createElement('strong');
    title.textContent = item.heading;
    const label = document.createElement('span');
    label.className = 'search-result-label';
    label.textContent = item.title;
    const snippet = document.createElement('p');
    const firstTerm = terms[0];
    const start = firstTerm ? Math.max(0, item.text.toLowerCase().indexOf(firstTerm) - 48) : 0;
    snippet.textContent = (start ? '…' : '') + item.text.slice(start, start + 150) + (item.text.length > start + 150 ? '…' : '');
    a.append(label, title, snippet);
    a.addEventListener('click', () => { dialog.close(); if (location.hash === a.hash) route(); });
    results.append(a);
  }
}

function openSearch() {
  closeMenu();
  if (!dialog.open) dialog.showModal();
  searchInput.value = '';
  showResults();
  searchInput.focus();
}

document.querySelector('.search-trigger').addEventListener('click', openSearch);
document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
searchInput.addEventListener('input', () => showResults(searchInput.value));
searchInput.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('a')?.focus(); }
  if (event.key === 'Enter') results.querySelector('a')?.click();
});
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
results.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const links = [...results.querySelectorAll('a')];
  const index = links.indexOf(document.activeElement);
  links[(index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]?.focus();
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
  if (event.key === 'Escape') closeMenu();
});
menu.addEventListener('click', () => {
  const open = !sidebar.classList.contains('is-open');
  sidebar.classList.toggle('is-open', open);
  menu.setAttribute('aria-expanded', String(open));
  scrim.hidden = !open;
  document.body.classList.toggle('nav-open', open);
});
scrim.addEventListener('click', closeMenu);
document.querySelector('.main-nav').addEventListener('click', event => {
  if (event.target.closest('a')) closeMenu();
});

document.addEventListener('click', async event => {
  const downloadPage = event.target.closest('[data-download-html]');
  if (downloadPage && (location.protocol === 'file:' || downloadPage.getAttribute('href') === '#/overview')) {
    event.preventDefault();
    const blob = new Blob(['<!doctype html>\n' + document.documentElement.outerHTML], {type:'text/html'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'banking-ai-playbook.html';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const copy = event.target.closest('.copy-code, [data-copy-prompt]');
  if (!copy) return;
  const value = copy.dataset.copyPrompt ? data.prompts[copy.dataset.copyPrompt] : copy.closest('.code-block').querySelector('code').textContent;
  try {
    await navigator.clipboard.writeText(value);
    notify(copy.dataset.copyPrompt ? 'Build prompt copied. Ready for Opus 5.' : 'Code copied to clipboard.');
    if (copy.classList.contains('copy-code')) {
      const label = copy.querySelector('span');
      label.textContent = 'Copied';
      setTimeout(() => { label.textContent = 'Copy'; }, 1800);
    }
  } catch {
    notify('Clipboard is unavailable. Select the text to copy it.');
  }
});

window.addEventListener('hashchange', route);
route();
