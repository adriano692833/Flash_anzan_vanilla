'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'mobile.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(html.includes('viewport-fit=cover'), 'Brak obsługi safe-area w viewport');
assert(!html.includes('user-scalable=no'), 'Viewport blokuje powiększanie');
assert((html.match(/class="mobile-nav-item/g) || []).length === 4, 'Dolna nawigacja powinna mieć dokładnie 4 główne pozycje');
for (const id of ['mobile-more-trigger', 'mobile-menu-backdrop', 'mobile-more-menu', 'mobile-more-title', 'mobile-page-title']) {
    assert(html.includes(`id="${id}"`), `Brak elementu mobilnego ${id}`);
}
for (const marker of ['env(safe-area-inset-bottom', '@media (max-width: 1024px)', 'min-height: 44px', '100dvh', '.sidebar.visible']) {
    assert(css.includes(marker), `CSS responsywny: brak ${marker}`);
}
for (const marker of ['toggleMobileMenu', 'mobileNavigate', 'updateNavigationState', 'initMobileShell', "event.key === 'Escape'", "event.key !== 'Tab'"]) {
    assert(app.includes(marker), `Obsługa menu: brak ${marker}`);
}

let depth = 0;
for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '{') depth++;
    if (char === '}') depth--;
    assert(depth >= 0, 'CSS ma nadmiarowy nawias zamykający');
}
assert(depth === 0, 'CSS ma niedomknięty blok');

console.log('Responsywny app-shell telefonu i tabletu: OK');
