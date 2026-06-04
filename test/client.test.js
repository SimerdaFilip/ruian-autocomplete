import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuianAddressClient } from '../ruian-autocomplete.js';
import { FIXTURE_FEATURE } from './pure.test.js';

function stubFetch(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      json: async () => body,
    };
  };
  return { fetch, calls };
}

test('search maps features into suggestions', async () => {
  const { fetch, calls } = stubFetch({ features: [FIXTURE_FEATURE] });
  const client = new RuianAddressClient({ fetch });
  const out = await client.search('Jankovcova', 5);

  assert.equal(out.length, 1);
  assert.equal(out[0].code, 25958895);
  assert.equal(out[0].zip, '170 00');
  assert.match(calls[0].url, /resultRecordCount=5/);
  assert.ok(decodeURIComponent(calls[0].url).includes("LIKE UPPER('%Jankovcova%')"));
});

test('search returns [] when there are no features', async () => {
  const { fetch } = stubFetch({ features: [] });
  const client = new RuianAddressClient({ fetch });
  assert.deepEqual(await client.search('xyz'), []);
});

test('search throws on the ArcGIS error envelope', async () => {
  const { fetch } = stubFetch({ error: { code: 400, message: 'Invalid query' } });
  const client = new RuianAddressClient({ fetch });
  await assert.rejects(() => client.search('boom'), /RUIAN error 400: Invalid query/);
});

test('search throws on non-ok HTTP', async () => {
  const { fetch } = stubFetch({}, { ok: false, status: 503 });
  const client = new RuianAddressClient({ fetch });
  await assert.rejects(() => client.search('x'), /HTTP 503/);
});

test('byCode builds the code URL and returns one suggestion', async () => {
  const { fetch, calls } = stubFetch({ features: [FIXTURE_FEATURE] });
  const client = new RuianAddressClient({ fetch });
  const out = await client.byCode(25958895);

  assert.ok(decodeURIComponent(calls[0].url).includes('kod=25958895'));
  assert.equal(out.code, 25958895);
  assert.equal(out.label, 'Jankovcova 1522/53, Holešovice, 17000 Praha 7');
});

test('byCode returns null when nothing matches', async () => {
  const { fetch } = stubFetch({ features: [] });
  const client = new RuianAddressClient({ fetch });
  assert.equal(await client.byCode(1), null);
});

test('constructor rejects a missing fetch', () => {
  assert.throws(() => new RuianAddressClient({ fetch: null }), /requires a fetch/);
});
