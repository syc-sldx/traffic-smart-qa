(() => {
  'use strict';

  const key = 'trafficqa:travel-preferences:v1';
  const modes = {
    metro: {action: 'metro', transport: 'transit'},
    transit: {action: 'route', transport: 'transit'},
    walking: {action: 'route', transport: 'walking'},
    driving: {action: 'route', transport: 'driving'},
  };
  const names = {metro: '地铁站间', transit: '公交地铁', walking: '步行', driving: '驾车'};
  const strategies = ['', '0', '1', '2', '3'];
  const defaults = {city: '南京', mode: 'metro', strategy: ''};
  const hasMode = mode => Object.prototype.hasOwnProperty.call(modes, mode);

  function normalize(values) {
    const city = typeof values?.city === 'string' ? values.city.trim().replace(/\s+/g, '').replace(/市$/, '') : '';
    if (city && !/^[\p{Script=Han}·]{1,20}$/u.test(city)) throw Error('请填写城市名称，例如南京。');
    if (!hasMode(values?.mode)) throw Error('请选择出行方式。');
    if (!strategies.includes(values?.strategy)) throw Error('请选择公交路线偏好。');
    return {city, mode: values.mode, strategy: values.strategy};
  }

  function create(storage) {
    return {
      read() {
        try {
          const record = JSON.parse(storage.getItem(key));
          return record?.schema === 1 ? normalize(record) : {...defaults};
        } catch {
          return {...defaults};
        }
      },
      save(values) {
        const preferences = normalize(values);
        try {
          storage.setItem(key, JSON.stringify({schema: 1, ...preferences}));
        } catch {
          throw Error('本机存储不可用，设置未保存。');
        }
        return preferences;
      },
    };
  }

  function formDefaults(preferences) {
    return {
      ...modes[preferences.mode],
      city: preferences.city,
      strategy: preferences.strategy,
    };
  }

  let storage;
  try { storage = window.localStorage; } catch {}
  window.TrafficTravelPrefs = {create, formDefaults, defaults, store: create(storage)};

  const get = id => document.getElementById(id);
  const dialog = get('travel-prefs-dialog');
  const form = get('travel-prefs-form');
  if (!dialog || !form) return;
  const inputs = ['city', 'mode', 'strategy'];
  function fill(values) {
    for (const name of inputs) get('pref-' + name).value = values[name];
  }
  function updateLabel() {
    const values = window.TrafficTravelPrefs.store.read();
    get('travel-prefs-label').textContent = [values.city, names[values.mode]].filter(Boolean).join(' · ');
  }
  function save(values) {
    const saved = window.TrafficTravelPrefs.store.save(values);
    fill(saved);
    updateLabel();
    window.TrafficChat?.applyTravelDefaults();
  }
  get('travel-prefs-open').onclick = () => {
    fill(window.TrafficTravelPrefs.store.read());
    get('travel-prefs-status').textContent = '';
    dialog.showModal();
  };
  get('travel-prefs-close').onclick = () => dialog.close();
  get('travel-prefs-reset').onclick = () => {
    fill(defaults);
    get('travel-prefs-status').textContent = '已填入初始设置，点保存后生效。';
  };
  form.onsubmit = event => {
    event.preventDefault();
    try {
      save(Object.fromEntries(inputs.map(name => [name, get('pref-' + name).value])));
      get('travel-prefs-status').textContent = '已保存，会在新对话的出行表单中使用。';
    } catch (error) {
      get('travel-prefs-status').textContent = error.message;
    }
  };
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) updateLabel();
  });
  updateLabel();
  window.TrafficChat?.applyTravelDefaults();
})();
