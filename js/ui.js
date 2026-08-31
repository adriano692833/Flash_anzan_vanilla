(function () {
  if (typeof window === 'undefined' || !window.app) return;

  const app = window.app;

  app.ui = app.ui || {};

  // --- TOAST SYSTEM ---
  const toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);

  app.ui.toast = function (msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast-item ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    el.innerHTML = `<span style="font-size:1.2rem">${icon}</span> <span>${msg}</span>`;
    toastContainer.appendChild(el);

    // Auto remove
    setTimeout(() => {
      el.style.animation = 'fadeOutRight 0.3s forwards';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  };

  // --- MODAL SYSTEM ---
  app.ui.modal = function (title, content, actions = []) {
    const overlay = document.createElement('div');
    overlay.className = 'app-modal-overlay';

    // Default action if none provided
    if (actions.length === 0) {
      actions.push({ label: 'OK', primary: true, onClick: () => { } });
    }

    const btnsHtml = actions.map((a, idx) => {
      const cls = a.primary ? 'btn-primary' : 'btn-secondary';
      return `<button class="btn ${cls}" id="modal-btn-${idx}">${a.label}</button>`;
    }).join('');

    overlay.innerHTML = `
      <div class="app-modal-content glass-card">
        <h2 style="margin-bottom: 1rem; color: var(--text-main);">${title}</h2>
        <div style="margin-bottom: 2rem; color: var(--text-muted); line-height: 1.6;">${content}</div>
        <div style="display: flex; gap: 1rem; justify-content: flex-end;">${btnsHtml}</div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Bind actions
    actions.forEach((a, idx) => {
      const btn = overlay.querySelector(`#modal-btn-${idx}`);
      btn.onclick = () => {
        if (a.onClick) a.onClick();
        closeModal();
      };
    });

    function closeModal() {
      overlay.style.animation = 'fadeOut 0.3s forwards';
      setTimeout(() => overlay.remove(), 300);
    }
  };

  app.ui.showTeacherLiveView = function (show) {
    const el = document.getElementById('teacher-live-view');
    if (!el) return;
    el.style.display = show ? 'block' : 'none';
  };

  app.ui.showResult = function ({ ok, xp, userAnswer, isWaiting }) {
    // Hide all screens, show result
    document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
    const rs = document.getElementById('result-screen');
    rs.style.display = 'block';
    rs.classList.add('active');

    if (isWaiting) {
      document.getElementById('res-icon').innerText = '⏳';
      document.getElementById('res-msg').innerText = 'Weryfikacja...';
      document.getElementById('res-xp-txt').innerText = '';
    } else {
      document.getElementById('res-icon').innerText = ok ? '🎉' : '❌';
      document.getElementById('res-msg').innerText = ok ? 'Świetnie!' : 'Błąd';
      document.getElementById('res-xp-txt').innerText = ok ? `+${xp} XP` : '0 XP';
      document.getElementById('res-xp-txt').style.color = ok ? 'var(--success)' : 'var(--text-muted)';
    }

    document.getElementById('res-details').style.display = 'block';
    document.getElementById('res-worksheet-msg').style.display = 'none';

    document.getElementById('res-correct').innerText = app.state.sum;
    // Fix: Show waiting dash if userAnswer is undefined/null
    document.getElementById('res-user').innerText = (userAnswer === null || userAnswer === undefined || isNaN(userAnswer)) ? '-' : userAnswer;

    const h = (app.state.nums || []).map(n => n >= 0 ? `+${n}` : n).join(' ');
    document.getElementById('res-history').innerText = h;

    // Extra info (time + multiplayer mini leaderboard)
    const timeSec = ((Date.now() - (app.state.startTime || Date.now())) / 1000).toFixed(2);
    const infoDiv = document.createElement('div');
    infoDiv.style.marginTop = '1rem';
    infoDiv.style.padding = '1rem';
    infoDiv.style.background = 'rgba(255,255,255,0.05)';
    infoDiv.style.borderRadius = '0.5rem';

    if (app.multi && app.multi.roomCode) {
      infoDiv.innerHTML = `
        <div style="font-size: 1.2rem; color: var(--accent); margin-bottom: 0.5rem;">⏱️ Twój czas: ${timeSec}s</div>
        <div id="res-mini-leaderboard" style="font-size: 0.9rem; text-align: left;">
          Tabela wyników aktualizuje się...
        </div>
      `;
      // Hook into leaderboard updates to refresh this mini-board
      app.multi.lastMiniBoard = infoDiv.querySelector('#res-mini-leaderboard');
      // Trigger manual update if we have data
      if (app.multi.lastLeaderboardData) {
        app.multi.updateMiniBoard(app.multi.lastLeaderboardData);
      }
    } else {
      infoDiv.innerHTML = `<div style="color: #aaa">Czas: ${timeSec}s</div>`;
    }

    const existing = document.getElementById('res-extra-info');
    if (existing) existing.remove();
    infoDiv.id = 'res-extra-info';
    document.getElementById('res-details').appendChild(infoDiv);

    // Reset state for next game (especially for multiplayer)
    setTimeout(() => {
      app.state.nums = [];
      app.state.sum = null;
    }, 100);

    // Multiplayer UI Logic - Hide controls for students
    const nextBtn = document.getElementById('btn-next-task');
    const waitMsg = document.getElementById('res-waiting-msg');

    // Default state (Single player or Host)
    if (nextBtn) nextBtn.style.display = 'block';
    if (waitMsg) waitMsg.style.display = 'none';

    if (app.multi && app.multi.roomCode && !app.multi.isHost) {
      if (nextBtn) nextBtn.style.display = 'none';
      if (waitMsg) waitMsg.style.display = 'block';
    }
  };
})();
