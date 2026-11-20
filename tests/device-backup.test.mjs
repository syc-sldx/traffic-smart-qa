import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const scripts = await Promise.all(['favorites-store', 'local-history', 'device-backup'].map(name => readFile('public/' + name + '.js', 'utf8')));
const threadKey = id => 'trafficqa:local:v1:thread:' + id;
const routeKey = id => 'trafficqa:favorites:v1:route:' + id;
const historySetting = 'trafficqa:local:v1:settings';
const journey = {city: '南京', origin: '南京南站', destination: '新街口', action: 'metro', transport: 'transit'};

function browser() {
  const records = new Map();
  const localStorage = {
    get length() { return records.size; },
    key(index) { return [...records.keys()][index]; },
    getItem(key) { return records.get(key) ?? null; },
    setItem(key, value) { records.set(key, value); },
    removeItem(key) { records.delete(key); },
  };
  const window = {localStorage};
  const context = vm.createContext({window, localStorage, URL, document: {getElementById: () => null}});
  scripts.forEach(source => vm.runInContext(source, context));
  let id = 0;
  return {
    storage: localStorage,
    backup: window.TrafficDeviceBackup.store,
    history: window.TrafficLocalHistory.create(localStorage, () => 'thread-' + ++id, () => 1800000000000),
    favorites: window.TrafficFavorites.create(localStorage, () => 'route-' + ++id, () => 1800000000000),
  };
}

function insertHistory(browser, answer = '1号线直达') {
  return browser.history.append(null, '南京南站怎么去新街口', {ok: true, domain: 'travel', answer});
}

const portable = value => JSON.parse(JSON.stringify(value));

test('portable backup restores conversations and routes while ignoring duplicates and preference flags', () => {
  const from = browser();
  const item = insertHistory(from);
  from.favorites.add(journey);
  from.history.enabled(false);
  const raw = from.backup.backup();
  assert.doesNotMatch(raw, /trafficqa:local:v1:settings/);
  const to = browser();
  assert.deepEqual(portable(to.backup.preview(raw)), {thread: 1, route: 1, skipped: 0});
  assert.equal(to.history.count(), 0);
  assert.deepEqual(portable(to.backup.restore(raw)), {thread: 1, route: 1, skipped: 0});
  assert.equal(to.history.get(item.id).turns[0].reply.answer, '1号线直达');
  assert.equal(to.favorites.find(journey).route.destination, '新街口');
  assert.equal(to.storage.getItem(historySetting), null);
  assert.deepEqual(portable(to.backup.restore(raw)), {thread: 0, route: 0, skipped: 2});
});

test('legacy history imports without overwriting overlapping IDs or enabling history saving', () => {
  const from = browser();
  const item = insertHistory(from);
  const to = browser();
  insertHistory(to, '现有记录');
  to.history.enabled(false);
  assert.deepEqual(portable(to.backup.restore(from.history.backup())), {thread: 0, route: 0, skipped: 1});
  assert.equal(to.history.get(item.id).turns[0].reply.answer, '现有记录');
  assert.equal(to.history.enabled(), false);
  const clean = browser();
  assert.equal(clean.backup.restore(from.history.backup()).thread, 1);
});

test('invalid or unsafe content cannot write unrelated keys and opt-in import removes provider metadata', () => {
  const from = browser();
  const item = insertHistory(from);
  const doc = JSON.parse(from.backup.backup());
  const record = JSON.parse(doc.records[0].value);
  record.turns[0].reply.slots = {city: '南京', origin_location: '123,45'};
  record.turns[0].reply.report_url = '/reports/private?token=example';
  record.turns[0].reply.images = [{url: 'https://external.example/collect'}];
  record.turns[0].reply.sources = [{title: '来源', url: 'javascript:alert(1)'}];
  doc.records[0].value = record;
  const to = browser();
  assert.throws(() => to.backup.restore(JSON.stringify({...doc, records: [...doc.records, {key: 'unrelated', value: record}]})), /无效/);
  assert.equal(to.history.count(), 0);
  to.backup.restore(JSON.stringify(doc));
  const imported = to.storage.getItem(threadKey(item.id));
  assert.doesNotMatch(imported, /123,45|token=|external\.example|javascript:/);
  assert.equal(to.history.get(item.id).turns[0].reply.slots.city, '南京');
});

test('a quota error rolls back new entries and preserves existing records', () => {
  const from = browser();
  const item = insertHistory(from);
  const favorite = from.favorites.add(journey);
  const to = browser();
  to.history.enabled(false);
  const initialSetting = to.storage.getItem(historySetting);
  const write = to.storage.setItem;
  to.storage.setItem = (key, value) => {
    if (key === routeKey(favorite.id)) throw Error('Full');
    write(key, value);
  };
  assert.throws(() => to.backup.restore(from.backup.backup()), /未完成/);
  assert.equal(to.storage.getItem(threadKey(item.id)), null);
  assert.equal(to.storage.getItem(routeKey(favorite.id)), null);
  assert.equal(to.storage.getItem(historySetting), initialSetting);
});
