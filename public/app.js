'use strict';
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const enquiryDialog = $('#enquiry-dialog');
const mediaDialog = $('#media-dialog');
const mediaContent = $('#media-content');
const documentNames = { brochure: 'ELARA brochure', 'price-sheet': 'Price sheet', both: 'Brochure + price sheet' };
let toastTimer;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}

function mountForm(mount, selectedDocument = 'both', selectedInterest = 'Explore the villas') {
  const prefix = mount.id;
  mount.replaceChildren();
  const form = document.createElement('form');
  form.className = 'enquiry-form';
  form.innerHTML = `
    <div class="field full-width"><label for="${prefix}-name">Full name <span>*</span></label><input id="${prefix}-name" name="name" autocomplete="name" placeholder="Your name" required minlength="2" maxlength="100"></div>
    <div class="field full-mobile"><label for="${prefix}-phone">Phone number <span>*</span></label><input id="${prefix}-phone" name="phone" type="tel" autocomplete="tel" placeholder="+91 98765 43210" required minlength="10" maxlength="24" inputmode="tel"></div>
    <div class="field full-mobile"><label for="${prefix}-email">Email address <span>*</span></label><input id="${prefix}-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254"></div>
    <div class="field"><label for="${prefix}-interest">I’m interested in</label><select id="${prefix}-interest" name="interest"><option>Explore the villas</option><option>Book a site visit</option><option>Price & availability</option></select></div>
    <div class="field"><label for="${prefix}-document">Send me</label><select id="${prefix}-document" name="document"><option value="both">Brochure + price sheet</option><option value="brochure">ELARA brochure</option><option value="price-sheet">Price sheet</option></select></div>
    <div class="field full-width"><label for="${prefix}-message">Anything you’d like to know? <span>(optional)</span></label><textarea id="${prefix}-message" name="message" placeholder="Tell us what you have in mind…" maxlength="2000" rows="2"></textarea></div>
    <label class="consent full-width"><input type="checkbox" name="consent" required><span>I agree to be contacted about my ELARA enquiry and accept the <button type="button" data-privacy>privacy & enquiry details</button>.</span></label>
    <p class="form-error full-width" role="alert" tabindex="-1"></p>
    <button type="submit" class="button button-dark full-width"><span>Enquire & download</span><svg aria-hidden="true"><use href="#download"/></svg></button>
    <p class="form-note full-width">Your details stay with the ELARA enquiry team.</p>`;
  form.elements.document.value = selectedDocument;
  form.elements.interest.value = selectedInterest;
  form.addEventListener('submit', submitEnquiry);
  mount.append(form);
}

async function submitEnquiry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const phone = form.elements.phone.value.trim();
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15 || !/^[+()\d\s.-]+$/.test(phone)) {
    form.elements.phone.setCustomValidity('Please enter a valid phone number with 10–15 digits.');
    form.elements.phone.reportValidity();
    form.elements.phone.addEventListener('input', () => form.elements.phone.setCustomValidity(''), { once: true });
    return;
  }
  const button = $('button[type="submit"]', form);
  const label = $('span', button);
  const error = $('.form-error', form);
  error.textContent = '';
  button.disabled = true;
  label.textContent = 'Sending your enquiry…';
  const values = Object.fromEntries(new FormData(form));
  values.consent = form.elements.consent.checked;
  values.source = form.parentElement.dataset.source;
  try {
    const response = await fetch('/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const result = await response.json();
    if (!response.ok) {
      if (result.fields) {
        Object.entries(result.fields).forEach(([name, message]) => {
          const field = form.elements.namedItem(name);
          if (!field || !field.setCustomValidity) return;
          field.setCustomValidity(message);
          field.setAttribute('aria-invalid', 'true');
          const clear = () => { field.setCustomValidity(''); field.removeAttribute('aria-invalid'); };
          field.addEventListener('input', clear, { once: true });
          field.addEventListener('change', clear, { once: true });
        });
        form.reportValidity();
      }
      throw new Error(result.fields ? Object.values(result.fields).join(' ') : result.error || 'We couldn’t send your enquiry. Please try again.');
    }
    showSuccess(form.parentElement, result.downloads || [], values.document);
    toast('Your enquiry is saved. Your project details are ready.');
  } catch (failure) {
    error.textContent = failure.message === 'Failed to fetch' ? 'We couldn’t reach the enquiry service. Please try again in a moment.' : failure.message;
    error.focus();
    button.disabled = false;
    label.textContent = 'Enquire & download';
  }
}

function downloadLink(download) {
  const anchor = document.createElement('a');
  anchor.href = download.url;
  anchor.setAttribute('download', '');
  anchor.innerHTML = '<svg aria-hidden="true"><use href="#file"/></svg><span></span><svg aria-hidden="true"><use href="#download"/></svg>';
  $('span', anchor).textContent = documentNames[download.document] || download.name || 'Download project details';
  return anchor;
}

function showSuccess(mount, downloads, requestedDocument) {
  const panel = document.createElement('div');
  panel.className = 'success-panel';
  panel.setAttribute('role', 'status');
  panel.innerHTML = '<span class="success-icon"><svg aria-hidden="true"><use href="#check"/></svg></span><h3>Your next chapter starts here.</h3><p>Thank you for your interest in ELARA. Your enquiry has been saved for the sales team. Your download will start shortly; you can also use the links below.</p><div class="success-downloads"></div><button class="text-link" type="button">Make another enquiry <svg aria-hidden="true"><use href="#right"/></svg></button>';
  const links = $('.success-downloads', panel);
  downloads.forEach(download => links.append(downloadLink(download)));
  $('.text-link', panel).addEventListener('click', () => mountForm(mount, requestedDocument));
  mount.replaceChildren(panel);
  const heading = $('h3', panel);
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  const automatic = downloads.find(download => download.document === requestedDocument) || downloads[0];
  if (automatic) {
    const anchor = downloadLink(automatic);
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    if (requestedDocument === 'both' && automatic.document !== 'both') {
      $('p', panel).textContent = 'Thank you for your interest in ELARA. Your enquiry has been saved for the sales team. Your first download has started. Choose the other document below to download it too.';
    }
  }
}

function openEnquiry(trigger) {
  const requestedDocument = trigger.dataset.enquire || 'both';
  const mount = $('#modal-form');
  mount.dataset.source = trigger.dataset.source || 'Website enquiry';
  mountForm(mount, requestedDocument, trigger.dataset.interest || 'Explore the villas');
  $('#dialog-description').textContent = `Share your details to unlock ${requestedDocument === 'both' ? 'the ELARA brochure and price sheet' : 'the ' + documentNames[requestedDocument]}.`;
  enquiryDialog.showModal();
}

document.addEventListener('click', event => {
  const enquiryTrigger = event.target.closest('[data-enquire]');
  if (enquiryTrigger) openEnquiry(enquiryTrigger);
  const closeTrigger = event.target.closest('[data-close]');
  if (closeTrigger) closeTrigger.closest('dialog').close();
  if (event.target.closest('[data-privacy]')) $('#privacy-dialog').showModal();
  if (event.target.closest('[data-film]')) {
    mediaContent.replaceChildren();
    const video = document.createElement('video');
    video.src = '/assets/project-film.mp4'; video.controls = true; video.autoplay = true; video.playsInline = true; video.preload = 'metadata';
    mediaContent.append(video);
    mediaDialog.showModal();
    video.play().catch(() => {});
  }
  const galleryTrigger = event.target.closest('[data-gallery]');
  if (galleryTrigger) showImage(`/assets/villa-${galleryTrigger.dataset.gallery}.webp`, `ELARA · ${galleryTrigger.dataset.gallery === 'day' ? 'The daylight perspective' : 'The evening perspective'} · Artist’s impression`);
  if (event.target.closest('[data-map]')) showImage('/assets/location-map.webp', 'ELARA project location reference · Confirm the exact site pin with the sales team.', true);
});

function showImage(source, caption, isMap = false) {
  mediaContent.replaceChildren();
  const image = document.createElement('img');
  image.src = source; image.alt = caption;
  if (isMap) image.className = 'map-lightbox';
  const text = document.createElement('p');
  text.className = 'media-caption'; text.textContent = caption;
  mediaContent.append(image, text);
  mediaDialog.showModal();
}

$$('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
});
mediaDialog.addEventListener('close', () => { const video = $('video', mediaContent); if (video) { video.pause(); video.removeAttribute('src'); video.load(); } mediaContent.replaceChildren(); });

$$('[data-scene]').forEach(button => button.addEventListener('click', () => {
  $('#hero-image').src = `/assets/villa-${button.dataset.scene}.webp`;
  $('#hero-image').alt = button.dataset.scene === 'day' ? 'ELARA villa with a sculpted cream facade, sweeping curves and planted terrace' : 'ELARA villa at dusk, with warm architectural lighting along its sculpted facade';
  $('.hero-number').firstChild.textContent = button.dataset.scene === 'day' ? '01 ' : '02 ';
  $$('[data-scene]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
}));
$('.menu-button').addEventListener('click', () => { const open = $('.menu-button').getAttribute('aria-expanded') !== 'true'; $('.menu-button').setAttribute('aria-expanded', String(open)); $('.menu-button').setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); $('#mobile-nav').hidden = !open; });
$$('#mobile-nav a, #mobile-nav button').forEach(link => link.addEventListener('click', () => { $('#mobile-nav').hidden = true; $('.menu-button').setAttribute('aria-expanded', 'false'); $('.menu-button').setAttribute('aria-label', 'Open menu'); }));
$('#year').textContent = String(new Date().getFullYear());
enquiryDialog.setAttribute('aria-label', 'Enquire about ELARA and download project details');
enquiryDialog.setAttribute('aria-describedby', 'dialog-description');
mediaDialog.setAttribute('aria-label', 'ELARA project media viewer');
$('#privacy-dialog').setAttribute('aria-label', 'Privacy and enquiry details');
mountForm($('#inline-form'));
