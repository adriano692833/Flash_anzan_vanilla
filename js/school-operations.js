(function () {
    if (typeof window === 'undefined' || !window.app) return;
    const app = window.app;

    function he(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function value(id) { const el = document.getElementById(id); return el ? el.value : ''; }
    function setVisible(id, show) { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; }
    function timeToMinutes(text) {
        const parts = String(text || '').split(':').map(Number);
        return Math.max(0, Math.min(1439, (parts[0] || 0) * 60 + (parts[1] || 0)));
    }
    function minutesToTime(minutes) {
        const n = Number(minutes) || 0;
        return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    }
    function localDate(offsetDays) {
        const d = new Date();
        d.setHours(12, 0, 0, 0);
        d.setDate(d.getDate() + (offsetDays || 0));
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function roleLabel(role) {
        return ({ teacher: 'Nauczyciel', student: 'Uczeń', guardian: 'Opiekun' })[role] || role;
    }
    function statusLabel(status) {
        return ({ active: 'Aktywne', used: 'Wykorzystane', revoked: 'Unieważnione' })[status] || status;
    }
    function eventDateLabel(event) {
        const days = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
        return event.kind === 'weekly'
            ? `${days[Number(event.weekday)] || 'co tydzień'}, ${minutesToTime(event.startMinutes)} · ${event.validFrom}–${event.validUntil}`
            : `${event.date}, ${minutesToTime(event.startMinutes)}`;
    }
    function nextOccurrence(event) {
        if (event.kind === 'once') return event.date || '';
        const start = new Date(`${event.validFrom}T12:00:00`);
        const now = new Date(); now.setHours(12, 0, 0, 0);
        let d = start > now ? start : now;
        const shift = (Number(event.weekday) - d.getDay() + 7) % 7;
        d = new Date(d); d.setDate(d.getDate() + shift);
        const result = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return result <= event.validUntil ? result : '';
    }
    function download(name, content, type) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const a = document.createElement('a'); a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    app.schoolOps = {
        data: { events: [], assignments: [], classes: [], staff: [], profile: {} },
        invitations: [],
        bindSocket: function (socket) {
            if (!socket || this._boundSocket === socket) return;
            this._boundSocket = socket;
            socket.on('school_operations_data', data => { this.data = data || this.data; this.render(); });
            socket.on('school_operations_changed', () => this.load());
            socket.on('invitations_created', data => this.renderNewInvites(data));
            socket.on('invitations_list', data => { this.invitations = data.invitations || []; this.renderInvites(); });
            socket.on('schedule_conflict', data => {
                const rows = (data.conflicts || []).map(item => `• ${he(item.title)} — ${he(item.className)} (${he(eventDateLabel(item))})`).join('<br>');
                app.ui.modal('Kolizja w planie', `Termin koliduje z nauczycielem, klasą lub salą:<br><br>${rows}`);
            });
            socket.on('attendance_data', data => this.renderAttendance(data));
            socket.on('audit_logs', data => this.renderAudit(data.logs || []));
            socket.on('class_members', data => {
                if (data.classId === value('ops-invite-class')) this.populateInviteStudents(data.members || []);
            });
        },
        socket: function () {
            app.multi.init();
            if (app.multi.socket) this.bindSocket(app.multi.socket);
            return app.multi.socket;
        },
        load: function () {
            const socket = this.socket();
            if (!socket) return;
            socket.emit('request_school_operations');
            if (['school_admin', 'teacher'].includes(app.multi.myRole)) socket.emit('list_invitations');
        },
        render: function () {
            const data = this.data || {};
            const role = data.role || app.multi.myRole;
            const isStaff = ['school_admin', 'teacher'].includes(role);
            setVisible('ops-invites-card', isStaff);
            setVisible('ops-class-editor', role === 'school_admin');
            setVisible('ops-schedule-editor', isStaff);
            setVisible('ops-assignment-editor', role === 'teacher');
            setVisible('ops-family-card', ['student', 'guardian'].includes(role));
            setVisible('ops-audit-card', role === 'school_admin');
            setVisible('ops-requests-card', role === 'school_admin');
            setVisible('ops-event-teacher-field', role === 'school_admin');

            const summary = document.getElementById('ops-summary');
            if (summary) summary.innerHTML = `<div><b>${(data.events || []).filter(e => e.status !== 'cancelled').length}</b><span>Serie zajęć</span></div><div><b>${(data.assignments || []).length}</b><span>Aktywne zadania</span></div><div><b>${Number(data.seatUsage && data.seatUsage.used) || 0}/${Number(data.seatUsage && data.seatUsage.limit) || '∞'}</b><span>Wykorzystanie licencji</span></div><div><b>Europe/Warsaw</b><span>Strefa czasowa</span></div>`;

            const classes = data.classes || [];
            ['ops-invite-class', 'ops-event-class', 'ops-assignment-class'].forEach(id => {
                const el = document.getElementById(id); if (!el) return;
                const selected = el.value;
                el.innerHTML = classes.length ? classes.filter(c => c.active !== false).map(c => `<option value="${he(c.id)}">${he(c.name)} ${he(c.schoolYear || '')}</option>`).join('') : '<option value="">— brak klas —</option>';
                if (selected && classes.some(c => c.id === selected)) el.value = selected;
            });
            const staff = (data.staff || []).filter(user => user.role === 'teacher');
            const teacherSelect = document.getElementById('ops-event-teacher');
            if (teacherSelect) teacherSelect.innerHTML = staff.length ? staff.map(user => `<option value="${he(user.uid)}">${he(user.name)}</option>`).join('') : '<option value="">— brak nauczycieli —</option>';
            const classTeacher = document.getElementById('ops-class-teacher');
            if (classTeacher) classTeacher.innerHTML = staff.length ? staff.map(user => `<option value="${he(user.uid)}">${he(user.name)}</option>`).join('') : '<option value="">— najpierw zaproś nauczyciela —</option>';

            const profile = data.profile || {};
            const contact = document.getElementById('ops-contact-summary');
            if (contact) contact.innerText = `Konto: ${profile.name || '—'} · e-mail: ${profile.contactEmail || 'nie podano'} · telefon: ${profile.contactPhone || 'nie podano'}`;
            this.renderEvents(); this.renderAssignments(); this.renderRequests(); this.updateInviteForm(); this.updateScheduleForm();
            this.loadInviteStudents();
        },
        updateInviteForm: function () {
            const role = value('ops-invite-role');
            const isOwner = app.multi.myRole === 'school_admin';
            const select = document.getElementById('ops-invite-role');
            if (select) {
                const teacherOption = select.querySelector('option[value="teacher"]');
                if (teacherOption) teacherOption.hidden = !isOwner;
                if (!isOwner && role === 'teacher') select.value = 'student';
            }
            const selectedRole = value('ops-invite-role');
            setVisible('ops-invite-class-field', selectedRole !== 'teacher');
            setVisible('ops-invite-student-field', selectedRole === 'guardian');
            const count = document.getElementById('ops-invite-count');
            if (count) { count.disabled = selectedRole === 'guardian'; if (selectedRole === 'guardian') count.value = '1'; }
            this.loadInviteStudents();
        },
        loadInviteStudents: function () {
            if (value('ops-invite-role') !== 'guardian') return;
            const classId = value('ops-invite-class');
            if (classId && this.socket()) this.socket().emit('list_class_members', { classId });
        },
        populateInviteStudents: function (members) {
            const el = document.getElementById('ops-invite-student'); if (!el) return;
            el.innerHTML = members.length ? members.map(m => `<option value="${he(m.uid)}">${he(m.name)}</option>`).join('') : '<option value="">— brak uczniów —</option>';
        },
        createInvites: function () {
            const socket = this.socket(); if (!socket) return;
            socket.emit('create_invitations', {
                role: value('ops-invite-role'), classId: value('ops-invite-class'), studentUid: value('ops-invite-student'),
                count: value('ops-invite-count'), expiresDays: value('ops-invite-days'),
                contactEmail: value('ops-invite-email'), contactPhone: value('ops-invite-phone')
            });
        },
        renderNewInvites: function (data) {
            const box = document.getElementById('ops-new-invites'); if (!box) return;
            const expires = new Date(data.expiresAt).toLocaleString('pl-PL');
            box.innerHTML = `<div class="ops-result-title">Gotowe · ${he(roleLabel(data.role))} · ważne do ${he(expires)}</div>${(data.codes || []).map(code => {
                const link = `${data.registrationBase}${encodeURIComponent(code)}`;
                return `<div class="ops-code"><strong>${he(code)}</strong><span><button class="btn btn-secondary" onclick="app.schoolOps.copy('${he(code)}')">Kopiuj kod</button><button class="btn btn-secondary" onclick="app.schoolOps.copy('${he(link)}')">Kopiuj link</button></span></div>`;
            }).join('')}<p class="field-help">To jedyny moment, gdy pełne kody są widoczne. Skopiuj je teraz; wysyłka e-mail/SMS wymaga późniejszego podłączenia dostawcy.</p>`;
        },
        copy: function (text) {
            navigator.clipboard.writeText(text).then(() => app.ui.toast('Skopiowano.', 'success')).catch(() => app.ui.toast('Nie udało się skopiować.', 'error'));
        },
        renderInvites: function () {
            const box = document.getElementById('ops-invites-list'); if (!box) return;
            const list = [...this.invitations].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30);
            box.innerHTML = list.length ? list.map(item => `<div class="ops-row"><div><b>${he(roleLabel(item.role))}</b><span>${he(statusLabel(item.status))} · wygasa ${he(item.expiresAt ? new Date(item.expiresAt).toLocaleDateString('pl-PL') : '—')}${item.contactEmail ? ' · ' + he(item.contactEmail) : ''}</span></div>${item.status === 'active' ? `<button class="btn btn-danger" onclick="app.schoolOps.revokeInvite('${he(item.id)}')">Unieważnij</button>` : ''}</div>`).join('') : '<div class="ops-empty">Brak zaproszeń.</div>';
        },
        revokeInvite: function (id) { if (confirm('Unieważnić to zaproszenie?')) this.socket().emit('revoke_invitation', { inviteId: id }); },
        updateScheduleForm: function () {
            const weekly = value('ops-event-kind') !== 'once';
            setVisible('ops-event-weekday-field', weekly); setVisible('ops-event-from-field', weekly); setVisible('ops-event-until-field', weekly); setVisible('ops-event-date-field', !weekly);
            const from = document.getElementById('ops-event-from'), until = document.getElementById('ops-event-until'), date = document.getElementById('ops-event-date');
            if (from && !from.value) from.value = localDate(0); if (until && !until.value) until.value = localDate(120); if (date && !date.value) date.value = localDate(1);
        },
        createEvent: function () {
            this.socket().emit('create_schedule_event', {
                title: value('ops-event-title'), classId: value('ops-event-class'), teacherUid: value('ops-event-teacher'),
                kind: value('ops-event-kind'), weekday: value('ops-event-weekday'), date: value('ops-event-date'),
                validFrom: value('ops-event-from'), validUntil: value('ops-event-until'),
                startMinutes: timeToMinutes(value('ops-event-time')), durationMinutes: value('ops-event-duration'), location: value('ops-event-location')
            });
        },
        createClass: function () {
            this.socket().emit('create_managed_class', { name: value('ops-class-name'), schoolYear: value('ops-class-year'), teacherUid: value('ops-class-teacher') });
        },
        renderEvents: function () {
            const box = document.getElementById('ops-events-list'); if (!box) return;
            const staff = ['school_admin', 'teacher'].includes(this.data.role);
            const list = [...(this.data.events || [])].sort((a, b) => String(nextOccurrence(a)).localeCompare(String(nextOccurrence(b))));
            box.innerHTML = list.length ? list.map(item => {
                const occurrence = nextOccurrence(item);
                return `<article class="ops-event ${item.status === 'cancelled' ? 'is-cancelled' : ''}"><div class="ops-event-date"><b>${he(minutesToTime(item.startMinutes))}</b><span>${he(occurrence || item.date || '—')}</span></div><div><h3>${he(item.title)}</h3><p>${he(item.className)} · ${he(item.teacherName)}${item.location ? ' · ' + he(item.location) : ''}</p><small>${he(eventDateLabel(item))}</small></div><div class="ops-event-actions">${staff && item.status !== 'cancelled' ? `<button class="btn btn-secondary" onclick="app.schoolOps.openAttendance('${he(item.id)}','${he(occurrence || localDate(0))}')">Obecność</button><button class="btn btn-danger" onclick="app.schoolOps.cancelEvent('${he(item.id)}')">Odwołaj</button>` : ''}</div></article>`;
            }).join('') : '<div class="ops-empty">Brak zaplanowanych zajęć.</div>';
            const make = document.getElementById('ops-makeup-event');
            if (make) make.innerHTML = list.filter(e => e.status !== 'cancelled').map(e => `<option value="${he(e.id)}">${he(e.title)} · ${he(e.className)}</option>`).join('');
        },
        cancelEvent: function (id) { if (confirm('Odwołać te zajęcia? Zapis pozostanie w historii.')) this.socket().emit('cancel_schedule_event', { eventId: id }); },
        openAttendance: function (eventId, date) { this.socket().emit('request_attendance', { eventId, occurrenceDate: date }); },
        renderAttendance: function (data) {
            setVisible('ops-attendance-card', true);
            const current = Object.fromEntries((data.attendance || []).map(row => [row.uid, row.status]));
            const box = document.getElementById('ops-attendance');
            box.innerHTML = `<div class="ops-list">${(data.members || []).map(member => `<label class="ops-row"><div><b>${he(member.name)}</b></div><select class="input-lg ops-attendance-status" data-uid="${he(member.uid)}" data-name="${he(member.name)}"><option value="present" ${current[member.uid] === 'present' ? 'selected' : ''}>Obecny</option><option value="absent" ${current[member.uid] === 'absent' ? 'selected' : ''}>Nieobecny</option><option value="late" ${current[member.uid] === 'late' ? 'selected' : ''}>Spóźniony</option><option value="excused" ${current[member.uid] === 'excused' ? 'selected' : ''}>Usprawiedliwiony</option></select></label>`).join('')}</div><button class="btn btn-primary" onclick="app.schoolOps.saveAttendance('${he(data.eventId)}','${he(data.occurrenceDate)}')">Zapisz obecność</button>`;
            document.getElementById('ops-attendance-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
        saveAttendance: function (eventId, occurrenceDate) {
            const entries = [...document.querySelectorAll('.ops-attendance-status')].map(el => ({ uid: el.dataset.uid, name: el.dataset.name, status: el.value }));
            this.socket().emit('save_attendance', { eventId, occurrenceDate, entries });
        },
        createAssignment: function () {
            this.socket().emit('create_assignment', { classId: value('ops-assignment-class'), title: value('ops-assignment-title'), dueDate: value('ops-assignment-date'), trainingKey: value('ops-assignment-training'), description: value('ops-assignment-description') });
        },
        renderAssignments: function () {
            const box = document.getElementById('ops-assignments-list'); if (!box) return;
            const list = [...(this.data.assignments || [])].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
            box.innerHTML = list.length ? list.map(item => `<div class="ops-row"><div><b>${he(item.title)}</b><span>${he(item.className)} · do ${he(item.dueDate || 'bez terminu')} · ${he(item.teacherName)}</span>${item.description ? `<p>${he(item.description)}</p>` : ''}${item.trainingKey ? `<small>Trening: ${he(item.trainingKey)}</small>` : ''}</div></div>`).join('') : '<div class="ops-empty">Brak aktywnych zadań.</div>';
        },
        privacyRequest: function (type) { if (type !== 'delete' || confirm('Wysłać wniosek o usunięcie konta? Dane wymagane prawem mogą pozostać do końca retencji.')) this.socket().emit('create_privacy_request', { type }); },
        requestMakeup: function () { this.socket().emit('create_makeup_request', { eventId: value('ops-makeup-event'), preferredDate: value('ops-makeup-date'), note: value('ops-makeup-note') }); },
        loadAudit: function () { this.socket().emit('request_audit_logs'); },
        renderAudit: function (logs) {
            const box = document.getElementById('ops-audit-list'); if (!box) return;
            box.innerHTML = logs.length ? logs.map(item => `<div class="ops-row"><div><b>${he(item.action)}</b><span>${he(item.createdAt ? new Date(item.createdAt).toLocaleString('pl-PL') : '')} · ${he(item.actorUid)}</span></div></div>`).join('') : '<div class="ops-empty">Brak wpisów.</div>';
        },
        renderRequests: function () {
            const box = document.getElementById('ops-requests-list'); if (!box) return;
            const requests = this.data.requests || {};
            const rows = [
                ...(requests.privacy || []).map(item => ({ ...item, requestType: 'privacy', label: `Prywatność: ${item.type || 'wniosek'}` })),
                ...(requests.makeup || []).map(item => ({ ...item, requestType: 'makeup', label: `Odrabianie: ${item.preferredDate || 'bez daty'}` }))
            ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
            box.innerHTML = rows.length ? rows.map(item => `<div class="ops-row"><div><b>${he(item.label)}</b><span>${he(item.createdAt ? new Date(item.createdAt).toLocaleString('pl-PL') : '')} · konto ${he(item.uid)}${item.note ? ' · ' + he(item.note) : ''}</span></div><select class="input-lg" onchange="app.schoolOps.updateRequest('${he(item.requestType)}','${he(item.id)}',this.value)"><option value="new" ${item.status === 'new' ? 'selected' : ''}>Nowy</option><option value="in_progress" ${item.status === 'in_progress' ? 'selected' : ''}>W realizacji</option><option value="resolved" ${item.status === 'resolved' ? 'selected' : ''}>Zrealizowany</option><option value="rejected" ${item.status === 'rejected' ? 'selected' : ''}>Odrzucony</option></select></div>`).join('') : '<div class="ops-empty">Brak nowych wniosków.</div>';
        },
        updateRequest: function (requestType, requestId, status) { this.socket().emit('update_school_request', { requestType, requestId, status }); },
        exportIcs: function () {
            const esc = text => String(text || '').replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
            const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
            const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Flash Anzan School//PL', 'CALSCALE:GREGORIAN', 'X-WR-TIMEZONE:Europe/Warsaw'];
            (this.data.events || []).filter(e => e.status !== 'cancelled').forEach(event => {
                let date = event.kind === 'once' ? event.date : nextOccurrence({ ...event, validFrom: event.validFrom });
                if (!date) return;
                const compact = date.replace(/-/g, '');
                const start = minutesToTime(event.startMinutes).replace(':', '') + '00';
                const endMinutes = Number(event.startMinutes) + Number(event.durationMinutes);
                const end = minutesToTime(endMinutes % 1440).replace(':', '') + '00';
                lines.push('BEGIN:VEVENT', `UID:${event.id}@anzan-school`, `DTSTAMP:${stamp}`, `DTSTART;TZID=Europe/Warsaw:${compact}T${start}`, `DTEND;TZID=Europe/Warsaw:${compact}T${end}`, `SUMMARY:${esc(event.title)}`, `DESCRIPTION:${esc(event.className + ' · ' + event.teacherName)}`, `LOCATION:${esc(event.location)}`);
                if (event.kind === 'weekly') lines.push(`RRULE:FREQ=WEEKLY;UNTIL=${String(event.validUntil).replace(/-/g, '')}T215959Z`);
                lines.push('END:VEVENT');
            });
            lines.push('END:VCALENDAR');
            download('plan-anzan.ics', lines.join('\r\n'), 'text/calendar;charset=utf-8');
        }
    };

    const due = document.getElementById('ops-assignment-date'); if (due && !due.value) due.value = localDate(7);
    const makeup = document.getElementById('ops-makeup-date'); if (makeup && !makeup.value) makeup.value = localDate(7);
})();
