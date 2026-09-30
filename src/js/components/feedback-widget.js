// Floating feedback widget — lets anyone using the app flag a bug or
// suggest an improvement without leaving it, from any view (map/list/
// targets), not just the map. Submissions go straight to Supabase
// (public.feedback, DATA project — see schema.sql), insert-only for the
// anon key: there's deliberately no read policy, so feedback text (which
// may reference specific clinics/regions/deals) isn't fetchable by anyone
// holding the same public key embedded in the client. Reading submissions
// back is a Supabase Studio / service-role job, not an in-app one.
//
// Loaded as a classic <script> after app.js, same shared-global-scope
// convention as Copilot/GraphPanel (see copilot-panel.js's header comment)
// — no window.* export; Feedback is referenced as a bare identifier both
// here and from map.html's onclick markup.

const FEEDBACK_TYPES = [
    { key: 'bug', label: 'Bug' },
    { key: 'suggestion', label: 'Suggestion' },
    { key: 'other', label: 'Other' }
];

const Feedback = {
    type: 'bug',
    _submitting: false
};

Feedback.isOpen = function () {
    return !document.getElementById('feedback-popover')?.classList.contains('hidden');
};

Feedback.open = function () {
    document.getElementById('feedback-popover')?.classList.remove('hidden');
    Feedback.render();
    document.getElementById('feedback-message')?.focus();
};

Feedback.close = function () {
    document.getElementById('feedback-popover')?.classList.add('hidden');
};

Feedback.toggle = function () {
    if (Feedback.isOpen()) Feedback.close(); else Feedback.open();
};

Feedback.render = function () {
    const row = document.getElementById('feedback-type-row');
    if (!row) return;
    row.innerHTML = FEEDBACK_TYPES.map((t) => `
        <div class="feedback-type-chip ${Feedback.type === t.key ? 'selected' : ''}" data-type-key="${t.key}">${t.label}</div>
    `).join('');
    row.querySelectorAll('.feedback-type-chip').forEach((chipEl) => {
        chipEl.addEventListener('click', () => {
            Feedback.type = chipEl.dataset.typeKey;
            Feedback.render();
        });
    });
};

Feedback.submit = async function () {
    if (Feedback._submitting) return;
    const status = document.getElementById('feedback-status');
    const textarea = document.getElementById('feedback-message');
    const message = (textarea?.value || '').trim();
    if (!message) {
        if (status) { status.textContent = 'Say a bit more first.'; status.className = 'feedback-status error'; }
        return;
    }

    Feedback._submitting = true;
    if (status) { status.textContent = 'Sending…'; status.className = 'feedback-status'; }
    const submitBtn = document.getElementById('feedback-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const supabase = await getSupabaseClient();
        const { error } = await supabase.from('feedback').insert({
            type: Feedback.type,
            message: message,
            submitted_by: (typeof State !== 'undefined' && State.user?.email) || null,
            market: (typeof State !== 'undefined' && State.markets?.current) || null,
            page_url: window.location.href,
            user_agent: navigator.userAgent
        });
        if (error) throw error;

        if (status) { status.textContent = 'Thanks — got it!'; status.className = 'feedback-status success'; }
        textarea.value = '';
        setTimeout(() => {
            Feedback.close();
            if (status) { status.textContent = ''; status.className = 'feedback-status'; }
        }, 1200);
    } catch (e) {
        console.warn('Feedback submit failed:', e);
        if (status) { status.textContent = 'Failed to send — try again?'; status.className = 'feedback-status error'; }
    } finally {
        Feedback._submitting = false;
        if (submitBtn) submitBtn.disabled = false;
    }
};
