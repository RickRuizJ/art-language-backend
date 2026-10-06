'use strict';
/**
 * utils/links.js
 *
 * Convierte cualquier URL http(s) en un "recurso de enlace" que el LMS sabe
 * mostrar. El servidor nunca descarga la URL: sólo la valida y calcula, cuando
 * es posible, una dirección para incrustarla (iframe). Los sitios que no
 * permiten incrustarse se muestran con un botón "Abrir enlace".
 */

const MAX_URL_LENGTH = 2000;

const PROVIDER_LABELS = {
  google_doc:    'Google Doc',
  google_sheet:  'Google Sheet',
  google_slide:  'Google Slides',
  google_form:   'Google Form',
  google_drive:  'Google Drive',
  youtube:       'YouTube',
  vimeo:         'Vimeo',
  website:       'Sitio web'
};

class LinkError extends Error {}

function parseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new LinkError('El link es obligatorio.');
  }
  let value = raw.trim();
  if (value.length > MAX_URL_LENGTH) {
    throw new LinkError('El link es demasiado largo.');
  }
  // Permite pegar "www.sitio.com/pagina" sin protocolo.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;

  let url;
  try {
    url = new URL(value);
  } catch (_) {
    throw new LinkError('El link no es válido.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new LinkError('Sólo se permiten links http o https.');
  }
  if (!url.hostname.includes('.')) {
    throw new LinkError('El link no es válido.');
  }
  return url;
}

function googleResource(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host === 'forms.gle') {
    // Los links cortos de Forms no se pueden incrustar sin resolverlos.
    return { provider: 'google_form', embedUrl: null };
  }

  if (host === 'docs.google.com') {
    const docMatch = path.match(/^\/document\/d\/([^/]+)/);
    if (docMatch) {
      return { provider: 'google_doc', embedUrl: `https://docs.google.com/document/d/${docMatch[1]}/preview` };
    }
    const sheetMatch = path.match(/^\/spreadsheets\/d\/([^/]+)/);
    if (sheetMatch) {
      return { provider: 'google_sheet', embedUrl: `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/preview` };
    }
    const slideMatch = path.match(/^\/presentation\/d\/([^/]+)/);
    if (slideMatch) {
      return { provider: 'google_slide', embedUrl: `https://docs.google.com/presentation/d/${slideMatch[1]}/embed` };
    }
    const formMatch = path.match(/^\/forms\/d\/(e\/)?([^/]+)\/(viewform|formResponse)/);
    if (formMatch) {
      const base = `https://docs.google.com/forms/d/${formMatch[1] || ''}${formMatch[2]}/viewform`;
      return { provider: 'google_form', embedUrl: `${base}?embedded=true` };
    }
    return { provider: 'google_doc', embedUrl: null };
  }

  if (host === 'drive.google.com') {
    const fileMatch = path.match(/^\/file\/d\/([^/]+)/);
    if (fileMatch) {
      return { provider: 'google_drive', embedUrl: `https://drive.google.com/file/d/${fileMatch[1]}/preview` };
    }
    return { provider: 'google_drive', embedUrl: null };
  }

  return null;
}

function videoResource(url) {
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (id) return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}` };
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (v) return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${v}` };
    const parts = url.pathname.split('/').filter(Boolean);
    if (['shorts', 'embed', 'live'].includes(parts[0]) && parts[1]) {
      return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${parts[1]}` };
    }
  }
  if (host === 'vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean).find(p => /^\d+$/.test(p));
    if (id) return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}` };
  }
  return null;
}

/**
 * @param {string} raw URL pegada por el profesor
 * @returns {{type:'external_link', provider:string, label:string, originalUrl:string, embedUrl:string|null}}
 * @throws {LinkError}
 */
function buildLinkResource(raw) {
  const url = parseUrl(raw);
  const detected = googleResource(url) || videoResource(url) || { provider: 'website', embedUrl: null };

  return {
    type: 'external_link',
    provider: detected.provider,
    label: PROVIDER_LABELS[detected.provider] || 'Enlace',
    originalUrl: url.toString(),
    embedUrl: detected.embedUrl
  };
}

module.exports = { buildLinkResource, LinkError, PROVIDER_LABELS };
