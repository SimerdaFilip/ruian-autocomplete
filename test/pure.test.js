import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeLike,
  buildSearchUrl,
  buildCodeUrl,
  mapFeature,
  formatZip,
} from '../ruian-autocomplete.js';

const BASE =
  'https://ags.cuzk.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer';

export const FIXTURE_FEATURE = {
  attributes: {
    kod: 25958895,
    ulice: 449423,
    cislodomovni: 1522,
    cisloorientacni: 53,
    psc: 17000,
    adresa: 'Jankovcova 1522/53, Holešovice, 17000 Praha 7',
  },
  geometry: { x: 14.452959927874597, y: 50.10849611774761 },
};

test('escapeLike doubles single quotes and trims', () => {
  assert.equal(escapeLike("O'Brien"), "O''Brien");
  assert.equal(escapeLike('  Praha  '), 'Praha');
  assert.equal(escapeLike("  a'b  "), "a''b");
});

test('buildSearchUrl assembles the ArcGIS query URL', () => {
  const url = buildSearchUrl(BASE, 1, 'Jankovcova', 7);
  assert.match(url, /\/1\/query\?/);
  assert.match(url, /f=json/);
  assert.match(url, /outSR=4326/);
  assert.match(url, /resultRecordCount=7/);
  // UPPER(adresa) LIKE UPPER('%...%') survives URL encoding.
  assert.ok(
    decodeURIComponent(url).includes("UPPER(adresa) LIKE UPPER('%Jankovcova%')")
  );
});

test('buildSearchUrl doubles quotes before encoding', () => {
  const url = buildSearchUrl(BASE, 1, "O'Brien", 10);
  // encodeURIComponent leaves ' untouched (it is URL-safe), so the doubled
  // quotes appear literally in the URL and the SQL literal stays balanced.
  assert.ok(url.includes("O''Brien"));
  assert.ok(decodeURIComponent(url).includes("UPPER('%O''Brien%')"));
});

test('buildCodeUrl filters by kod', () => {
  const url = buildCodeUrl(BASE, 1, 25958895);
  assert.match(url, /\/1\/query\?/);
  assert.ok(decodeURIComponent(url).includes('kod=25958895'));
});

test('formatZip splits a five digit psc', () => {
  assert.equal(formatZip(17000), '170 00');
  assert.equal(formatZip('17000'), '170 00');
  assert.equal(formatZip(null), null);
  assert.equal(formatZip(123), null);
});

test('mapFeature maps the verified feature shape', () => {
  const s = mapFeature(FIXTURE_FEATURE);
  assert.equal(s.code, 25958895);
  assert.equal(s.label, 'Jankovcova 1522/53, Holešovice, 17000 Praha 7');
  assert.equal(s.houseNumber, 1522);
  assert.equal(s.orientationNumber, '53');
  assert.equal(s.zip, '170 00');
  assert.equal(s.streetCode, 449423);
  assert.ok(Math.abs(s.lat - 50.10849611774761) < 1e-9);
  assert.ok(Math.abs(s.lng - 14.452959927874597) < 1e-9);
});

test('mapFeature is defensive about missing keys', () => {
  const s = mapFeature({});
  assert.equal(s.code, null);
  assert.equal(s.label, '');
  assert.equal(s.lat, null);
  assert.equal(s.lng, null);
  assert.equal(s.zip, null);
});
