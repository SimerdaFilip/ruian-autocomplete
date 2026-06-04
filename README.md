# @simerda/ruian-autocomplete

[![npm version](https://img.shields.io/npm/v/@simerda/ruian-autocomplete)](https://www.npmjs.com/package/@simerda/ruian-autocomplete)
[![npm downloads](https://img.shields.io/npm/dm/@simerda/ruian-autocomplete)](https://www.npmjs.com/package/@simerda/ruian-autocomplete)
[![license](https://img.shields.io/npm/l/@simerda/ruian-autocomplete)](./LICENSE)
[![CI](https://github.com/SimerdaFilip/ruian-autocomplete/actions/workflows/ci.yml/badge.svg)](https://github.com/SimerdaFilip/ruian-autocomplete/actions/workflows/ci.yml)

Czech address autocomplete — straight from the browser, no backend.

Czech address autocomplete that talks to the **ČÚZK RÚIAN** address service
straight from the browser. Zero dependencies, no build step, plain ES modules.
The widget gives you full addresses, the RÚIAN address-point code, PSČ, and WGS84
coordinates.

## What it does

- Type-ahead over the official RÚIAN address register (every address point in CZ).
- **Direct mode** by default — queries ČÚZK from the browser. ČÚZK enables CORS, so
  no proxy is required.
- **Proxy mode** — point it at your own endpoint if you want caching, rate limiting,
  or to hide the upstream.
- Accessible ARIA combobox: keyboard navigation, screen-reader roles, substring
  highlighting.
- A pure, testable core (`RuianAddressClient` + helpers) with no DOM dependency.

## Install

```sh
npm i @simerda/ruian-autocomplete
```

Or with no build at all — import the module directly in a page:

```html
<link rel="stylesheet" href="https://unpkg.com/@simerda/ruian-autocomplete/ruian-autocomplete.css" />
<script type="module">
  import { RuianAutocomplete } from 'https://unpkg.com/@simerda/ruian-autocomplete/ruian-autocomplete.js';
  RuianAutocomplete.attach(document.querySelector('#address'));
</script>
```

## Quick start

### Custom element

```html
<link rel="stylesheet" href="ruian-autocomplete.css" />
<script type="module" src="ruian-autocomplete.js"></script>

<ruian-autocomplete placeholder="Začněte psát adresu…" name="address"></ruian-autocomplete>

<script type="module">
  document.addEventListener('ruian:select', (e) => {
    console.log(e.detail); // suggestion object
  });
</script>
```

### Programmatic `attach()`

```js
import { RuianAutocomplete } from '@simerda/ruian-autocomplete';
import '@simerda/ruian-autocomplete/css';

const controller = RuianAutocomplete.attach(document.querySelector('#address'), {
  minChars: 2,
  debounce: 200,
  limit: 10,
  onSelect(suggestion) {
    console.log(suggestion.code, suggestion.lat, suggestion.lng);
  },
});

// later
controller.destroy();
```

### Just the client (no UI)

```js
import { RuianAddressClient } from '@simerda/ruian-autocomplete';

const client = new RuianAddressClient();
const hits = await client.search('Jankovcova Praha', 5);
const one = await client.byCode(25958895);
```

## Data-source modes

- **Direct (default)** — omit `endpoint`. The widget uses `RuianAddressClient` to
  query ČÚZK directly. Works in the browser because ČÚZK sends CORS headers.
- **Proxy** — pass `endpoint`. The widget calls `GET ${endpoint}?q=…&limit=…` and
  expects a JSON array of suggestion objects. The `simerda/ruian` PHP package ships a
  ready-made `SuggestHandler` that returns exactly this shape, so you can drop it in as
  a proxy.

```js
RuianAutocomplete.attach(input, { endpoint: '/api/ruian/suggest' });
```

## Suggestion object

```ts
{
  code: number | null;             // RÚIAN address-point code (kod)
  label: string;                   // full human-readable address (adresa)
  houseNumber: number | null;      // číslo domovní
  orientationNumber: string | null;// číslo orientační (may carry a letter)
  zip: string | null;              // formatted PSČ, e.g. "170 00"
  streetCode: number | null;       // street code (ulice)
  lat: number | null;              // WGS84 latitude
  lng: number | null;              // WGS84 longitude
}
```

## The `ruian:select` event

On selection the widget fills the input with `label`, mirrors `code`/`lat`/`lng` onto
`input.dataset`, calls your `onSelect`, and dispatches a bubbling
`CustomEvent('ruian:select', { detail: suggestion })`.

```js
input.addEventListener('ruian:select', (e) => {
  const { code, lat, lng } = e.detail;
});
```

## Options

| Option     | Default       | Description                                             |
| ---------- | ------------- | ------------------------------------------------------- |
| `endpoint` | —             | Proxy URL; if set, switches to proxy mode.              |
| `source`   | —             | Custom `(query, limit, signal) => Promise<suggestion[]>`. |
| `base`     | ČÚZK MapServer| Override the ArcGIS base URL (direct mode).             |
| `layerId`  | `1`           | RÚIAN layer (1 = AdresniMisto).                         |
| `minChars` | `2`           | Minimum input length before querying.                   |
| `debounce` | `200`         | Debounce in ms.                                         |
| `limit`    | `10`          | Max suggestions.                                        |
| `onSelect` | —             | Callback `(suggestion) => void`.                        |
| `messages` | English       | UI strings, e.g. `{ noResults: 'No results found' }`.   |

All user-facing text defaults to English. Override it through `messages`:

```js
RuianAutocomplete.attach(input, {
  messages: { noResults: 'Nic nenalezeno' }, // e.g. switch to Czech
});
```

Custom-element attributes mirror these: `endpoint`, `base`, `layer-id`, `min-chars`,
`debounce`, `limit`, `placeholder`, `name`, `no-results`.

## Theming

Style via CSS custom properties on the `.ruian-ac` wrapper. The combobox `<input>`
stays yours.

```css
.ruian-ac {
  --ruian-ac-bg: #fff;
  --ruian-ac-border: #d0d7de;
  --ruian-ac-radius: 8px;
  --ruian-ac-option-hover: #f3f6fb;
  --ruian-ac-option-active: #e7f0ff;
  --ruian-ac-highlight: #1f6feb;
}
```

## Examples

See [`examples/index.html`](./examples/index.html) — both the custom element and a
programmatic `attach()`, direct ČÚZK mode, with a live readout wired through the
`ruian:select` event. Open it in a browser; no server needed.

## Tests

No dev dependencies. The suite runs on Node's built-in test runner:

```sh
node --test
```

## License

MIT © Filip Šimerda
