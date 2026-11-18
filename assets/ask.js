/* Persian Gulf Daily Summary - "Ask the data".
 * Sends the reader's question to /api/ask (src/worker.js) and shows the answer.
 * Answers are inserted with textContent only, never as HTML.
 */
(function () {
  'use strict';

  var forms = document.querySelectorAll('form[data-ask]');
  if (!forms.length) return;

  function setStatus(form, text, isError) {
    var el = form.querySelector('.ask-status');
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('ask-error', Boolean(isError));
  }

  function setEnabled(form, on) {
    form.querySelectorAll('textarea, button').forEach(function (el) { el.disabled = !on; });
  }

  function ask(form) {
    var input = form.querySelector('textarea');
    var question = input.value.trim();
    if (!question) { input.focus(); return; }
    if (question.length > 500) { setStatus(form, 'Please keep questions under 500 characters.', true); return; }

    var box = form.querySelector('.ask-answer');
    form.querySelector('.ask-q').textContent = question;
    form.querySelector('.ask-a').textContent = '';
    box.hidden = false;
    box.classList.add('is-loading');
    setEnabled(form, false);
    setStatus(form, 'Thinking. This can take up to a minute if the model has been idle.');

    fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question, date: form.getAttribute('data-date') || '' }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (r.ok && r.data.answer) {
          form.querySelector('.ask-a').textContent = r.data.answer;
          setStatus(form, '');
        } else {
          box.hidden = true;
          setStatus(form, r.data.error || 'Something went wrong. Please try again.', true);
        }
      })
      .catch(function () {
        box.hidden = true;
        setStatus(form, 'Could not reach the server. Check your connection and try again.', true);
      })
      .then(function () {
        box.classList.remove('is-loading');
        setEnabled(form, true);
      });
  }

  forms.forEach(function (form) {
    var input = form.querySelector('textarea');
    form.addEventListener('submit', function (e) { e.preventDefault(); ask(form); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(form); }
    });
    form.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () { input.value = chip.textContent; ask(form); });
    });
  });

  // Is the feature switched on (Worker deployed and API key set)?
  fetch('/api/ask', { headers: { Accept: 'application/json' } })
    .then(function (res) { return res.ok ? res.json() : { enabled: false }; })
    .catch(function () { return { enabled: false }; })
    .then(function (status) {
      forms.forEach(function (form) {
        if (status && status.enabled) {
          setEnabled(form, true);
          setStatus(form, '');
        } else {
          setEnabled(form, false);
          setStatus(form, 'Questions are not switched on yet.');
        }
      });
    });
})();
