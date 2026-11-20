import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('public/travel-preferences.js', 'utf8');
function browser(storage) {
  const window = {localStorage: storage};
  vm.runInNewContext(source, {window, document: {getElementById: () => null}});
  return window.TrafficTravelPrefs;
}

test('device preference survives opening again and drops unrelated request fields', () => {
  const values = new Map();
  const storage = {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value)};
  const first = browser(storage);
  first.store.save({city: ' 苏州市 ', mode: 'transit', strategy: '3', origin: 'private place', origin_location: '101,42'});
  const reopened = browser(storage);
  const saved = reopened.store.read();
  assert.equal(saved.city, '苏州');
  assert.equal(reopened.formDefaults(saved).action, 'route');
  assert.equal(reopened.formDefaults(saved).transport, 'transit');
  assert.equal(reopened.formDefaults(saved).strategy, '3');
  assert.doesNotMatch([...values.values()].join(''), /private place|101,42/);
});

test('invalid choices preserve existing preferences and unavailable storage falls back', () => {
  let value;
  const preferences = browser({getItem: () => value, setItem: (_key, text) => {value = text;}});
  preferences.store.save({city: '上海', mode: 'walking', strategy: ''});
  assert.throws(() => preferences.store.save({city: '12,30', mode: 'walking', strategy: ''}), /城市/);
  assert.throws(() => preferences.store.save({city: '上海', mode: '__proto__', strategy: ''}), /出行方式/);
  assert.equal(preferences.store.read().city, '上海');
  assert.equal(browser(null).store.read().city, '南京');
  assert.throws(() => browser(null).store.save({city: '', mode: 'metro', strategy: ''}), /未保存/);
});
