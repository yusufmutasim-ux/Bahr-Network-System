const { test } = require('node:test');
const assert = require('node:assert/strict');
const { coordsFromUrl, resolveMapLink } = require('../src/maplink');

test('parses common Google Maps link shapes', () => {
  assert.deepEqual(coordsFromUrl('https://www.google.com/maps/place/X/@30.04,31.22,17z/data=!3m1!4b1!8m2!3d30.0459705!4d31.2243097'), { lat: 30.0459705, lng: 31.2243097 });
  assert.deepEqual(coordsFromUrl('https://maps.google.com/?q=27.9158,34.3300'), { lat: 27.9158, lng: 34.33 });
  assert.deepEqual(coordsFromUrl('30.0444, 31.2357'), { lat: 30.0444, lng: 31.2357 });
  assert.equal(coordsFromUrl('https://example.com'), null);
});

test('follows short-link redirects but only to Google hosts', async () => {
  const hops = {
    'https://maps.app.goo.gl/abc': 'https://www.google.com/maps/place/Office/@27.91,34.32,17z/data=!3d27.9158!4d34.33',
  };
  const fakeFetch = async (url) => ({
    headers: { get: (h) => (h === 'location' ? hops[String(url)] || null : null) },
    text: async () => '',
  });
  assert.deepEqual(await resolveMapLink('https://maps.app.goo.gl/abc', fakeFetch), { lat: 27.9158, lng: 34.33 });
  // Never follows links to non-Google hosts (no SSRF).
  let called = false;
  await resolveMapLink('https://evil.example/x', async () => { called = true; });
  assert.equal(called, false);
});
