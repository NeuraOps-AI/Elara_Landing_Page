'use strict';

const STATUSES = ['New', 'Contacted', 'Qualified', 'Site visit', 'Closed', 'Lost'];
const DOC_NAMES = { brochure: 'Brochure', 'price-sheet': 'Price sheet' };
const byId = id => document.getElementById(id);
const statusClass = value => `status-${String(value).toLowerCase().replaceAll(' ', '-')}`;
let leads = [];
let selectedLead = null;
let loading = false;
let opener = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toUpperCase();
}

function documents(lead) {
  return Array.isArray(lead.requestedDocuments) ? lead.requestedDocuments.filter(doc => Object.hasOwn(DOC_NAMES, doc)) : [];
}

function formatDate(value, options) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...options });
}

function buildStats() {
  const container = byId('stats');
  container.replaceChildren();
  STATUSES.forEach(status => {
    const button = element('button', `stat ${statusClass(status)}`);
    button.type = 'button';
    button.dataset.status = status;
    const label = element('span', 'stat-label');
    label.append(element('span', 'status-dot'), document.createTextNode(status));
    const count = leads.filter(lead => lead.status === status).length;
    button.append(label, element('span', 'stat-count', count), element('span', 'stat-arrow', '↗'));
    button.setAttribute('aria-label', `Filter ${status} leads, ${count}`);
    button.setAttribute('aria-pressed', String(byId('status-filter').value === status));
    button.classList.toggle('selected', byId('status-filter').value === status);
    button.addEventListener('click', () => {
      byId('status-filter').value = byId('status-filter').value === status ? '' : status;
      render();
    });
    container.append(button);
  });
  byId('nav-count').textContent = leads.length;
}

function filteredLeads() {
  const query = byId('search').value.trim().toLowerCase();
  const status = byId('status-filter').value;
  const requested = byId('document-filter').value;
  const multiplier = byId('sort').value === 'oldest' ? 1 : -1;
  return leads.filter(lead => {
    const haystack = `${lead.name || ''} ${lead.email || ''} ${lead.phone || ''}`.toLowerCase();
    const docs = documents(lead);
    return (!query || haystack.includes(query)) && (!status || lead.status === status)
      && (!requested || (requested === 'both' ? docs.includes('brochure') && docs.includes('price-sheet') : docs.includes(requested)));
  }).sort((a, b) => multiplier * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
}

function makeState(title, description, { actionText, action, error = false } = {}) {
  const state = byId('state');
  state.replaceChildren();
  const symbol = element('span', 'state-symbol', error ? '!' : '↗');
  symbol.setAttribute('aria-hidden', 'true');
  state.append(symbol, element('h3', '', title), element('p', '', description));
  if (actionText && action) {
    const button = element('button', 'button button-light', actionText);
    button.type = 'button';
    button.addEventListener('click', action);
    state.append(button);
  }
  state.hidden = false;
  byId('table-scroll').hidden = true;
}

function clearFilters() {
  byId('search').value = '';
  byId('status-filter').value = '';
  byId('document-filter').value = '';
  render();
}

function render() {
  buildStats();
  const filtered = filteredLeads();
  byId('results-count').textContent = filtered.length;
  byId('table-summary').textContent = leads.length ? `${filtered.length} of ${leads.length} ${leads.length === 1 ? 'lead' : 'leads'}` : 'Your next conversation awaits.';
  if (!leads.length) {
    makeState('Room for your first conversation.', 'When someone enquires or requests a brochure, their details will arrive here.', { actionText: 'Explore the website ↗', action: () => { window.location.href = '/'; } });
    return;
  }
  if (!filtered.length) {
    makeState('No leads match just yet.', 'Try a different search or clear the filters to see every enquiry.', { actionText: 'Clear filters', action: clearFilters });
    return;
  }
  byId('state').hidden = true;
  byId('table-scroll').hidden = false;
  const body = byId('leads-body');
  body.replaceChildren();
  filtered.forEach(lead => {
    const row = element('tr');
    const identityCell = element('td');
    const identity = element('div', 'lead-cell');
    const avatar = element('span', 'avatar', initials(lead.name));
    avatar.setAttribute('aria-hidden', 'true');
    const info = element('div');
    const button = element('button', 'lead-name', lead.name || 'Unnamed enquiry');
    button.type = 'button';
    button.setAttribute('aria-label', `View lead details for ${lead.name || 'this enquiry'}`);
    button.addEventListener('click', event => { event.stopPropagation(); openLead(lead, button); });
    const email = element('span', 'lead-contact', lead.email || '—');
    email.title = lead.email || '';
    info.append(button, email, element('span', 'lead-phone', lead.phone || '—'));
    identity.append(avatar, info);
    identityCell.append(identity);
    const interestCell = element('td');
    const interest = element('span', 'interest-text', lead.interest || 'General enquiry');
    interest.title = lead.interest || 'General enquiry';
    interestCell.append(interest);
    const docsCell = element('td');
    const requested = documents(lead);
    if (requested.length) requested.forEach(doc => docsCell.append(element('span', 'document-tag', DOC_NAMES[doc])));
    else docsCell.textContent = 'Enquiry';
    const dateCell = element('td');
    dateCell.append(element('span', 'date-day', formatDate(lead.createdAt, { day: '2-digit', month: 'short', year: 'numeric' })), element('span', 'date-time', formatDate(lead.createdAt, { hour: '2-digit', minute: '2-digit' })));
    const statusCell = element('td');
    const knownStatus = STATUSES.includes(lead.status) ? lead.status : 'New';
    const badge = element('span', `status-badge ${statusClass(knownStatus)}`);
    badge.append(element('span', 'status-dot'), document.createTextNode(knownStatus));
    statusCell.append(badge);
    const arrowCell = element('td', 'row-arrow', '↗');
    arrowCell.setAttribute('aria-hidden', 'true');
    row.append(identityCell, interestCell, docsCell, dateCell, statusCell, arrowCell);
    row.addEventListener('click', () => openLead(lead, button));
    body.append(row);
  });
}

async function loadLeads() {
  if (loading) return;
  loading = true;
  byId('refresh').disabled = true;
  byId('updated').textContent = 'Refreshing…';
  try {
    const response = await fetch('/api/leads', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load enquiries.');
    const result = await response.json();
    if (!Array.isArray(result.leads)) throw new Error('The lead response was incomplete.');
    leads = result.leads;
    render();
    byId('updated').textContent = `Updated ${formatDate(new Date().toISOString(), { hour: '2-digit', minute: '2-digit' })} IST`;
    byId('announcer').textContent = `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'} loaded.`;
  } catch (error) {
    byId('updated').textContent = 'Connection unavailable';
    makeState('Your workspace needs a moment.', 'We couldn’t load your enquiries. Check that the local server is running and try again.', { actionText: 'Try again', action: loadLeads, error: true });
    byId('announcer').textContent = 'Could not load leads. Try refreshing.';
  } finally {
    loading = false;
    byId('refresh').disabled = false;
  }
}

function openLead(lead, trigger) {
  selectedLead = lead;
  opener = trigger || document.activeElement;
  byId('detail-name').textContent = lead.name || 'Unnamed enquiry';
  byId('detail-avatar').textContent = initials(lead.name);
  byId('detail-created').textContent = `Received ${formatDate(lead.createdAt, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} IST`;
  const phone = byId('detail-phone');
  phone.href = `tel:${String(lead.phone || '').replace(/[^+\d]/g, '')}`;
  phone.querySelector('span').textContent = lead.phone || 'No phone provided';
  const email = byId('detail-email');
  email.href = `mailto:${encodeURIComponent(lead.email || '')}`;
  email.querySelector('span').textContent = lead.email || 'No email provided';
  byId('detail-interest').textContent = lead.interest || 'General enquiry';
  byId('detail-documents').textContent = documents(lead).map(doc => DOC_NAMES[doc]).join(' & ') || 'No documents requested';
  byId('detail-source').textContent = lead.source || 'Website';
  byId('detail-message').textContent = lead.message || 'No additional message was provided.';
  byId('detail-status').value = STATUSES.includes(lead.status) ? lead.status : 'New';
  byId('detail-notes').value = lead.notes || '';
  byId('save-feedback').textContent = '';
  byId('save-feedback').classList.remove('error');
  byId('save-lead').disabled = false;
  const dialog = byId('lead-dialog');
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function closeLead() {
  byId('lead-dialog').close();
}

async function saveLead(event) {
  event.preventDefault();
  if (!selectedLead) return;
  const id = selectedLead.id;
  const button = byId('save-lead');
  const feedback = byId('save-feedback');
  button.disabled = true;
  feedback.textContent = 'Saving…';
  feedback.classList.remove('error');
  try {
    const response = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ status: byId('detail-status').value, notes: byId('detail-notes').value })
    });
    const result = await response.json();
    if (!response.ok || !result.lead) throw new Error(result.error || 'We couldn’t save these changes. Please try again.');
    leads = leads.map(lead => lead.id === id ? result.lead : lead);
    if (selectedLead?.id === id) {
      selectedLead = result.lead;
      feedback.textContent = 'Saved. Your next step is all set.';
    }
    render();
    byId('announcer').textContent = 'Lead changes saved.';
  } catch (error) {
    feedback.textContent = error.message || 'We couldn’t save these changes. Please try again.';
    feedback.classList.add('error');
  } finally {
    button.disabled = false;
  }
}

byId('search').addEventListener('input', render);
['status-filter', 'document-filter', 'sort'].forEach(id => byId(id).addEventListener('change', render));
byId('refresh').addEventListener('click', loadLeads);
byId('close-dialog').addEventListener('click', closeLead);
byId('lead-form').addEventListener('submit', saveLead);
byId('lead-dialog').addEventListener('click', event => {
  if (event.target === byId('lead-dialog')) {
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeLead();
  }
});
byId('lead-dialog').addEventListener('close', () => {
  selectedLead = null;
  if (opener?.isConnected) opener.focus();
  else byId('refresh').focus();
});

buildStats();
loadLeads();
