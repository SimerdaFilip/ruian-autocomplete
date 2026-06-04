// Zero-dependency Czech address autocomplete backed by the ČÚZK RÚIAN
// address service. The pure helpers and RuianAddressClient have no DOM
// dependency so they can be unit-tested under plain Node.

const DEFAULT_BASE =
  'https://ags.cuzk.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer';
const DEFAULT_LAYER = 1;

// ČÚZK stores user input case-sensitively, so searches go through UPPER().
// The where clause is single-quoted, hence a quote in the needle has to be
// doubled or it would terminate the literal early.
export function escapeLike(input) {
  return String(input == null ? '' : input).trim().replace(/'/g, "''");
}

export function buildSearchUrl(base, layerId, query, limit) {
  const where = `UPPER(adresa) LIKE UPPER('%${escapeLike(query)}%')`;
  return `${base}/${layerId}/query?${queryString({
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(limit),
    f: 'json',
  })}`;
}

export function buildCodeUrl(base, layerId, code) {
  const where = `kod=${escapeLike(code)}`;
  return `${base}/${layerId}/query?${queryString({
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  })}`;
}

// 17000 -> "170 00". Czech postal codes are five digits split 3+2.
export function formatZip(psc) {
  if (psc == null || psc === '') return null;
  const digits = String(psc).replace(/\D/g, '');
  if (digits.length !== 5) return null;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

export function mapFeature(feature) {
  const attrs = (feature && feature.attributes) || {};
  const geometry = (feature && feature.geometry) || {};
  return {
    code: toInt(attrs.kod),
    label: attrs.adresa != null ? String(attrs.adresa) : '',
    houseNumber: toInt(attrs.cislodomovni),
    orientationNumber: toOrientation(attrs.cisloorientacni, attrs.cisloorientacnipismeno),
    zip: formatZip(attrs.psc),
    streetCode: toInt(attrs.ulice),
    lat: toNumber(geometry.y),
    lng: toNumber(geometry.x),
  };
}

export class RuianAddressClient {
  constructor({ base = DEFAULT_BASE, layerId = DEFAULT_LAYER, fetch = globalThis.fetch } = {}) {
    if (typeof fetch !== 'function') {
      throw new TypeError('RuianAddressClient requires a fetch implementation');
    }
    this.base = base;
    this.layerId = layerId;
    this._fetch = fetch;
  }

  async search(query, limit = 10, { signal } = {}) {
    const url = buildSearchUrl(this.base, this.layerId, query, limit);
    const data = await this._request(url, signal);
    return (data.features || []).map(mapFeature);
  }

  async byCode(code, { signal } = {}) {
    const url = buildCodeUrl(this.base, this.layerId, code);
    const data = await this._request(url, signal);
    const feature = (data.features || [])[0];
    return feature ? mapFeature(feature) : null;
  }

  async _request(url, signal) {
    const response = await this._fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`RUIAN request failed with HTTP ${response.status}`);
    }
    const data = await response.json();
    // ArcGIS reports query errors with HTTP 200 and an error envelope.
    if (data && data.error) {
      const { code, message } = data.error;
      throw new Error(`RUIAN error ${code ?? ''}: ${message || 'unknown error'}`.trim());
    }
    return data;
  }
}

function queryString(params) {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

function toInt(value) {
  if (value == null || value === '') return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

// Orientation number may carry a trailing letter (e.g. "53a"); keep it a string.
function toOrientation(number, letter) {
  if (number == null || number === '') return null;
  const suffix = letter != null && letter !== '' ? String(letter) : '';
  return `${number}${suffix}`;
}

// --- Widget --------------------------------------------------------------
// Everything below touches the DOM. Guarded so importing under Node is safe.

const HAS_DOM = typeof document !== 'undefined' && typeof window !== 'undefined';

let optionIdSeq = 0;

export const RuianAutocomplete = {
  attach(inputEl, options = {}) {
    if (!HAS_DOM) {
      throw new Error('RuianAutocomplete.attach requires a browser environment');
    }
    return new Autocomplete(inputEl, options);
  },
};

class Autocomplete {
  constructor(input, options) {
    this.input = input;
    this.options = {
      minChars: 2,
      debounce: 200,
      limit: 10,
      ...options,
    };
    this.suggestions = [];
    this.activeIndex = -1;
    this.open = false;
    this._timer = null;
    this._abort = null;
    this._blurTimer = null;

    if (this.options.endpoint) {
      this.source = (query, limit, signal) =>
        fetchEndpoint(this.options.endpoint, query, limit, signal);
    } else if (typeof this.options.source === 'function') {
      this.source = this.options.source;
    } else {
      const client = new RuianAddressClient({
        base: this.options.base,
        layerId: this.options.layerId,
      });
      this.source = (query, limit, signal) => client.search(query, limit, { signal });
    }

    this._buildDom();
    this._bind();
  }

  _buildDom() {
    const doc = this.input.ownerDocument;
    this.listId = `ruian-ac-list-${++optionIdSeq}`;

    this.list = doc.createElement('ul');
    this.list.className = 'ruian-ac-list';
    this.list.id = this.listId;
    this.list.setAttribute('role', 'listbox');
    this.list.hidden = true;

    this.input.classList.add('ruian-ac-input');
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.setAttribute('aria-controls', this.listId);
    this.input.setAttribute('autocomplete', 'off');

    // Wrap so the listbox can be absolutely positioned under the input.
    if (this.input.parentElement && this.input.parentElement.classList.contains('ruian-ac')) {
      this.wrapper = this.input.parentElement;
    } else {
      this.wrapper = doc.createElement('div');
      this.wrapper.className = 'ruian-ac';
      this.input.parentNode.insertBefore(this.wrapper, this.input);
      this.wrapper.appendChild(this.input);
    }
    this.wrapper.appendChild(this.list);
  }

  _bind() {
    this._onInput = () => this._scheduleQuery();
    this._onKeyDown = (e) => this._handleKey(e);
    this._onBlur = () => {
      // Delay so a click on an option still registers before we close.
      this._blurTimer = setTimeout(() => this._close(), 150);
    };
    this._onFocus = () => {
      if (this.suggestions.length) this._show();
    };

    this.input.addEventListener('input', this._onInput);
    this.input.addEventListener('keydown', this._onKeyDown);
    this.input.addEventListener('blur', this._onBlur);
    this.input.addEventListener('focus', this._onFocus);
  }

  _scheduleQuery() {
    clearTimeout(this._timer);
    const query = this.input.value.trim();
    if (query.length < this.options.minChars) {
      this._close();
      return;
    }
    this._timer = setTimeout(() => this._runQuery(query), this.options.debounce);
  }

  async _runQuery(query) {
    if (this._abort) this._abort.abort();
    const controller = new AbortController();
    this._abort = controller;

    try {
      const results = await this.source(query, this.options.limit, controller.signal);
      // A newer request may have superseded this one mid-flight.
      if (controller.signal.aborted) return;
      this._render(results, query);
    } catch (err) {
      if (controller.signal.aborted || err.name === 'AbortError') return;
      // Network/parse failures should not be noisy in the page; just close.
      this._close();
    }
  }

  _render(results, query) {
    this.suggestions = results;
    this.activeIndex = -1;
    this.list.innerHTML = '';
    const doc = this.input.ownerDocument;

    if (!results.length) {
      const empty = doc.createElement('li');
      empty.className = 'ruian-ac-empty';
      empty.setAttribute('role', 'option');
      empty.textContent = 'Nic nenalezeno';
      this.list.appendChild(empty);
      this._show();
      return;
    }

    results.forEach((item, index) => {
      const li = doc.createElement('li');
      li.className = 'ruian-ac-option';
      li.id = `${this.listId}-opt-${index}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.appendChild(highlight(doc, item.label, query));
      // mousedown fires before the input's blur, so selection isn't cut off.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._select(index);
      });
      li.addEventListener('mouseenter', () => this._setActive(index));
      this.list.appendChild(li);
    });

    this._show();
  }

  _handleKey(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!this.open) this._scheduleQuery();
        this._move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._move(-1);
        break;
      case 'Enter':
        if (this.open && this.activeIndex >= 0) {
          e.preventDefault();
          this._select(this.activeIndex);
        }
        break;
      case 'Escape':
        this._close();
        break;
      default:
        break;
    }
  }

  _move(delta) {
    if (!this.suggestions.length) return;
    const count = this.suggestions.length;
    let next = this.activeIndex + delta;
    if (next < 0) next = count - 1;
    if (next >= count) next = 0;
    this._setActive(next);
  }

  _setActive(index) {
    const options = this.list.querySelectorAll('.ruian-ac-option');
    options.forEach((el, i) => {
      const active = i === index;
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    this.activeIndex = index;
    const active = options[index];
    if (active) {
      this.input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  _select(index) {
    const item = this.suggestions[index];
    if (!item) return;
    this.input.value = item.label;
    if (item.code != null) this.input.dataset.code = String(item.code);
    if (item.lat != null) this.input.dataset.lat = String(item.lat);
    if (item.lng != null) this.input.dataset.lng = String(item.lng);
    this._close();

    if (typeof this.options.onSelect === 'function') {
      this.options.onSelect(item);
    }
    this.input.dispatchEvent(
      new CustomEvent('ruian:select', { detail: item, bubbles: true })
    );
  }

  _show() {
    this.list.hidden = false;
    this.open = true;
    this.input.setAttribute('aria-expanded', 'true');
  }

  _close() {
    this.list.hidden = true;
    this.open = false;
    this.activeIndex = -1;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }

  destroy() {
    clearTimeout(this._timer);
    clearTimeout(this._blurTimer);
    if (this._abort) this._abort.abort();
    this.input.removeEventListener('input', this._onInput);
    this.input.removeEventListener('keydown', this._onKeyDown);
    this.input.removeEventListener('blur', this._onBlur);
    this.input.removeEventListener('focus', this._onFocus);
    if (this.list && this.list.parentNode) this.list.parentNode.removeChild(this.list);
    this.input.removeAttribute('role');
    this.input.removeAttribute('aria-autocomplete');
    this.input.removeAttribute('aria-expanded');
    this.input.removeAttribute('aria-controls');
    this.input.removeAttribute('aria-activedescendant');
  }
}

async function fetchEndpoint(endpoint, query, limit, signal) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${endpoint}${sep}q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Proxy request failed with HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function highlight(doc, text, query) {
  const fragment = doc.createDocumentFragment();
  const needle = query.trim().toLowerCase();
  if (!needle) {
    fragment.appendChild(doc.createTextNode(text));
    return fragment;
  }
  const haystack = text.toLowerCase();
  let from = 0;
  let at = haystack.indexOf(needle, from);
  while (at !== -1) {
    if (at > from) fragment.appendChild(doc.createTextNode(text.slice(from, at)));
    const mark = doc.createElement('mark');
    mark.className = 'ruian-ac-mark';
    mark.textContent = text.slice(at, at + needle.length);
    fragment.appendChild(mark);
    from = at + needle.length;
    at = haystack.indexOf(needle, from);
  }
  if (from < text.length) fragment.appendChild(doc.createTextNode(text.slice(from)));
  return fragment;
}

// --- Custom element ------------------------------------------------------
// Registered only in a browser. The typeof guard keeps Node imports clean.

if (typeof customElements !== 'undefined' && typeof HTMLElement !== 'undefined') {
  class RuianAutocompleteElement extends HTMLElement {
    connectedCallback() {
      if (this._input) return;
      this._input = this.querySelector('input') || document.createElement('input');
      this._input.type = 'text';
      if (this.hasAttribute('placeholder')) {
        this._input.placeholder = this.getAttribute('placeholder');
      }
      if (this.hasAttribute('name')) this._input.name = this.getAttribute('name');
      if (!this._input.parentNode) this.appendChild(this._input);

      this._controller = RuianAutocomplete.attach(this._input, {
        base: this.getAttribute('base') || undefined,
        layerId: numAttr(this, 'layer-id'),
        endpoint: this.getAttribute('endpoint') || undefined,
        minChars: numAttr(this, 'min-chars') ?? 2,
        debounce: numAttr(this, 'debounce') ?? 200,
        limit: numAttr(this, 'limit') ?? 10,
      });
    }

    disconnectedCallback() {
      if (this._controller) {
        this._controller.destroy();
        this._controller = null;
      }
    }

    get value() {
      return this._input ? this._input.value : '';
    }
  }

  if (!customElements.get('ruian-autocomplete')) {
    customElements.define('ruian-autocomplete', RuianAutocompleteElement);
  }
}

function numAttr(el, name) {
  if (!el.hasAttribute(name)) return undefined;
  const n = Number(el.getAttribute(name));
  return Number.isNaN(n) ? undefined : n;
}

// Expose globals for non-module CDN usage without breaking Node imports.
if (typeof globalThis !== 'undefined' && HAS_DOM) {
  globalThis.RuianAutocomplete = RuianAutocomplete;
  globalThis.RuianAddressClient = RuianAddressClient;
}
