'use strict';

const loginForm = document.getElementById('crm-login-form');
const passwordField = document.getElementById('crm-password');
const passwordToggle = document.getElementById('password-toggle');
const loginSubmit = document.getElementById('login-submit');
const loginError = document.getElementById('login-error');
let submitting = false;

function concealPassword() {
  passwordField.type = 'password';
  passwordToggle.textContent = 'Show';
  passwordToggle.setAttribute('aria-label', 'Show password');
  passwordToggle.setAttribute('aria-pressed', 'false');
}

passwordToggle.addEventListener('click', () => {
  const visible = passwordField.type === 'password';
  passwordField.type = visible ? 'text' : 'password';
  passwordToggle.textContent = visible ? 'Hide' : 'Show';
  passwordToggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  passwordToggle.setAttribute('aria-pressed', String(visible));
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || !loginForm.reportValidity()) return;
  submitting = true;
  loginError.hidden = true;
  passwordField.removeAttribute('aria-invalid');
  loginForm.setAttribute('aria-busy', 'true');
  loginSubmit.disabled = true;
  passwordToggle.disabled = true;
  loginSubmit.querySelector('span').textContent = 'Signing in…';
  try {
    const response = await fetch('/api/crm/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password: passwordField.value }),
      cache: 'no-store',
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      passwordField.setAttribute('aria-invalid', String(response.status === 401));
      throw new Error(result.error || 'We couldn’t sign you in. Please try again.');
    }
    passwordField.value = '';
    concealPassword();
    window.location.replace('/CRM/112026');
  } catch (cause) {
    loginError.textContent = cause instanceof TypeError ? 'Couldn’t connect. Check that the application is running and try again.' : cause.message;
    loginError.hidden = false;
    passwordField.value = '';
    concealPassword();
    passwordField.focus();
  } finally {
    submitting = false;
    loginForm.removeAttribute('aria-busy');
    loginSubmit.disabled = false;
    passwordToggle.disabled = false;
    loginSubmit.querySelector('span').textContent = 'Sign in';
  }
});

window.addEventListener('pagehide', () => { passwordField.value = ''; concealPassword(); });
