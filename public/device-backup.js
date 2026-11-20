(() => {
  'use strict';

  const threadPrefix = 'trafficqa:local:v1:thread:';
  const routePrefix = 'trafficqa:favorites:v1:route:';
  const kind = 'trafficqa-device-backup';
  const maxFile = 8 * 1024 * 1024;
  const modes = ['auto', 'data', 'knowledge', 'travel'];
  const travelFields = ['city', 'origin', 'destination', 'transport', 'action', 'road', 'strategy', 'origin_id', 'destination_id', 'station_id'];
  const limits = {
    thread: {count: 100, chars: 1500000},
    route: {count: 100, chars: 200000},
  };
  const malformed = () => Error('备份包含无效记录或格式不受支持，未导入。');
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const list = (value, limit) => Array.isArray(value) ? value.slice(0, limit) : [];
  const text = (value, size = 200) => typeof value === 'string' ? value.slice(0, size) : '';
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const flag = value => typeof value === 'boolean' ? value : undefined;
  const idValid = id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id);

  function strings(value, fields, length = 200) {
    if (!object(value)) return {};
    return Object.fromEntries(fields.filter(key => typeof value[key] === 'string').map(key => [key, text(value[key], length)]));
  }

  function webUrl(value) {
    try {
      const url = new URL(text(value, 1200));
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch {
      return '';
    }
  }

  function mapImage(value) {
    const url = text(value?.url, 500);
    if (!/^\/api\/metro\/map\.svg\?/.test(url)) return null;
    return {url, ...strings(value, ['alt', 'caption'], 500)};
  }

  function chartOption(value) {
    if (!object(value) || !Array.isArray(value.xAxis?.data)) return undefined;
    const categories = list(value.xAxis.data, 200).map(item => text(String(item ?? ''), 100));
    const series = list(value.series, 6).filter(item => ['line', 'bar'].includes(item?.type) && Array.isArray(item.data))
      .map(item => ({type: item.type, name: text(item.name), data: list(item.data, categories.length).map(number)}));
    if (!categories.length || !series.length) return undefined;
    return {
      tooltip: {trigger: 'axis', renderMode: 'richText'},
      grid: {left: 65, right: 22, bottom: 55, top: 25},
      xAxis: {type: 'category', data: categories, axisLabel: {hideOverlap: true}},
      yAxis: {type: 'value', name: text(value.yAxis?.name)},
      series,
    };
  }

  function cleanReply(value) {
    if (!object(value)) throw malformed();
    const out = {
      ...strings(value, ['answer', 'error', 'notice', 'sql'], 30000),
      ...strings(value, ['domain', 'engine', 'queried_at', 'retrieved_at'], 100),
      ok: flag(value.ok),
      needs_input: flag(value.needs_input),
      unavailable: flag(value.unavailable),
    };
    if (object(value.slots)) out.slots = strings(value.slots, travelFields);
    if (object(value.evidence)) out.evidence = strings(value.evidence, ['kind', 'label', 'date_label', 'date_value', 'note'], 500);
    if (Array.isArray(value.columns)) out.columns = list(value.columns, 50).map(column => text(column, 180));
    if (Array.isArray(value.rows)) out.rows = list(value.rows, 200).filter(Array.isArray)
      .map(row => row.slice(0, 50).map(cell => typeof cell === 'string' ? text(cell, 2400) : number(cell)));
    if (Array.isArray(value.sources)) out.sources = list(value.sources, 30).filter(object)
      .map(source => ({...strings(source, ['title', 'document', 'excerpt'], 2400), url: webUrl(source.url)}));
    if (Array.isArray(value.images)) out.images = list(value.images, 6).map(mapImage).filter(Boolean);
    if (object(value.metro_route)) {
      const route = value.metro_route;
      out.metro_route = {
        ...strings(route, ['city', 'origin', 'destination', 'origin_id', 'destination_id']),
        stops: number(route.stops), transfers: number(route.transfers),
        segments: list(route.segments, 30).filter(object).map(segment => ({
          ...strings(segment, ['line', 'color', 'direction', 'origin', 'destination']),
          stops: number(segment.stops), stations: list(segment.stations, 250).map(item => text(item)),
        })),
      };
    }
    if (Array.isArray(value.route_options)) out.route_options = list(value.route_options, 3).filter(object).map(option => ({
      distance_km: number(option.distance_km), duration_minutes: number(option.duration_minutes),
      fare_yuan: number(option.fare_yuan), walking_meters: number(option.walking_meters),
      steps_truncated: flag(option.steps_truncated),
      steps: list(option.steps, 60).filter(object).map(step => ({
        ...strings(step, ['kind', 'line', 'direction', 'origin', 'destination', 'instruction'], 1200),
        stops: number(step.stops), via_stops: number(step.via_stops), distance_meters: number(step.distance_meters),
        alternative_lines: list(step.alternative_lines, 20).map(item => text(item)),
      })),
    }));
    if (object(value.clarification)) out.clarification = {
      field: text(value.clarification.field), question: text(value.clarification.question, 8000),
      options: list(value.clarification.options, 48).filter(option => object(option?.travel))
        .map(option => ({...strings(option, ['label', 'description']), travel: strings(option.travel, travelFields)})),
    };
    out.chart = chartOption(value.chart);
    return out;
  }

  function threadRecord(value) {
    if (!Array.isArray(value.turns) || !value.turns.length || value.turns.length > 200 ||
        !Number.isFinite(value.created_at) || !Number.isFinite(value.updated_at)) throw malformed();
    const turns = value.turns.map(turn => {
      if (!idValid(turn?.id) || !Number.isFinite(turn.created_at) || typeof turn.question !== 'string' || !turn.question.trim()) {
        throw malformed();
      }
      return {id: turn.id, question: text(turn.question, 8000), created_at: turn.created_at, reply: cleanReply(turn.reply)};
    });
    return {
      schema: 1, id: value.id, title: text(value.title, 60) || text(turns[0].question, 60),
      created_at: value.created_at, updated_at: value.updated_at, deleted_at: number(value.deleted_at),
      mode: modes.includes(value.mode) ? value.mode : 'auto', turns,
    };
  }

  function routeRecord(value) {
    const route = window.TrafficFavorites.normalize(value.route);
    const validDate = date => typeof date === 'string' && Number.isFinite(Date.parse(date));
    if (!validDate(value.created_at) || !validDate(value.updated_at) ||
        value.deleted_at != null && !validDate(value.deleted_at)) throw malformed();
    const deleted_at = value.deleted_at ?? null;
    return {schema: 1, id: value.id, created_at: value.created_at, updated_at: value.updated_at, deleted_at, route};
  }

  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > maxFile) throw Error('备份文件太大，无法读取。');
    try {
      const backup = JSON.parse(raw.replace(/^\uFEFF/, ''));
      if (backup.schema !== 1 || ![kind, 'trafficqa-local-backup'].includes(backup.kind) ||
          !Array.isArray(backup.records) || backup.records.length > 200) throw malformed();
      const seen = new Set();
      return backup.records.map(({key, value}) => {
        const category = typeof key === 'string' && key.startsWith(threadPrefix) ? 'thread'
          : typeof key === 'string' && key.startsWith(routePrefix) && backup.kind === kind ? 'route' : '';
        const data = typeof value === 'string' ? JSON.parse(value) : value;
        const prefix = category === 'thread' ? threadPrefix : routePrefix;
        if (!category || !object(data) || data.schema !== 1 || !idValid(data.id) || key !== prefix + data.id || seen.has(key)) throw malformed();
        seen.add(key);
        const record = category === 'thread' ? threadRecord(data) : routeRecord(data);
        return {key, category, value: JSON.stringify(record)};
      });
    } catch {
      throw malformed();
    }
  }

  function create(storage) {
    function read() {
      const records = [];
      try {
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (key?.startsWith(threadPrefix) || key?.startsWith(routePrefix)) records.push({key, value: storage.getItem(key)});
        }
      } catch {
        throw Error('当前浏览器无法读取本机记录。');
      }
      return records;
    }

    function plan(raw) {
      const incoming = parse(raw);
      const current = read();
      const existing = new Set(current.map(record => record.key));
      const routeSignature = record => window.TrafficFavorites.signature(JSON.parse(record.value).route);
      const routes = new Set();
      for (const record of current) {
        if (record.key.startsWith(routePrefix)) try { routes.add(routeSignature(record)); } catch {}
      }
      const additions = incoming.filter(record => {
        if (existing.has(record.key)) return false;
        if (record.category === 'route') {
          const signature = routeSignature(record);
          if (routes.has(signature)) return false;
          routes.add(signature);
        }
        return true;
      });
      const metrics = {thread: 0, route: 0, skipped: incoming.length - additions.length};
      for (const category of ['thread', 'route']) {
        const prefix = category === 'thread' ? threadPrefix : routePrefix;
        const added = additions.filter(record => record.category === category);
        metrics[category] = added.length;
        const combined = current.filter(record => record.key.startsWith(prefix)).concat(added);
        if (added.length && (combined.length > limits[category].count ||
            combined.reduce((sum, record) => sum + record.key.length + record.value.length, 0) > limits[category].chars)) {
          throw Error('导入后会超过本机存储上限。请先保留备份并整理本机记录。');
        }
      }
      return {additions, metrics};
    }

    return {
      backup() {
        return JSON.stringify({schema: 1, kind, exported_at: new Date().toISOString(), records: read()});
      },
      preview(raw) { return plan(raw).metrics; },
      restore(raw) {
        const {additions, metrics} = plan(raw);
        const written = [];
        try {
          for (const entry of additions) {
            if (storage.getItem(entry.key) !== null) throw Error('Local records changed.');
            storage.setItem(entry.key, entry.value);
            written.push(entry);
          }
        } catch {
          for (const entry of written) {
            try {
              if (storage.getItem(entry.key) === entry.value) storage.removeItem(entry.key);
            } catch {}
          }
          throw Error('存储空间不足或本机记录已变化，导入未完成。现有记录保留。');
        }
        return metrics;
      },
    };
  }

  let storage;
  try { storage = window.localStorage; } catch {}
  window.TrafficDeviceBackup = {create, store: create(storage), maxFile};

  const get = id => document.getElementById(id);
  const panel = get('device-backup-panel');
  if (!panel) return;
  const contents = get('device-backup-data');
  const picker = get('device-backup-file');
  const restore = get('device-backup-restore');
  const status = get('device-backup-status');
  let previewed = '', fileVersion = 0;
  const store = window.TrafficDeviceBackup.store;
  const total = result => result.thread + result.route;
  function showPreview() {
    previewed = '';
    restore.hidden = true;
    try {
      const result = store.preview(contents.value);
      previewed = contents.value;
      restore.hidden = total(result) === 0;
      status.textContent = total(result)
        ? '可导入 '+result.thread+' 段对话、'+result.route+' 条路线，跳过 '+result.skipped+' 条重复记录。'
        : '文件中没有需要新增的记录，跳过 '+result.skipped+' 条重复记录。';
    } catch (error) {
      status.textContent = error.message;
    }
  }

  get('device-backup-make').onclick = () => {
    fileVersion++;
    previewed = '';
    restore.hidden = true;
    try {
      contents.value = store.backup();
      status.textContent = '备份已生成，内容包含问答和收藏。';
    } catch (error) {
      status.textContent = error.message;
    }
  };
  get('device-backup-copy').onclick = async () => {
    if (!contents.value) return;
    try {
      await navigator.clipboard.writeText(contents.value);
      status.textContent = '已复制，请将内容保存到自己的文件。';
    } catch {
      contents.focus();
      contents.select();
      status.textContent = '请长按复制，或按 Ctrl+C 复制已选内容。';
    }
  };
  get('device-backup-download').onclick = () => {
    try {
      const file = new Blob([store.backup()], {type: 'application/json;charset=utf-8'});
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'traffic-smart-qa-backup.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = '已请求下载。若未出现文件，可生成并复制备份。';
    } catch (error) {
      status.textContent = error.message;
    }
  };
  picker.onchange = async () => {
    const version = ++fileVersion;
    previewed = '';
    restore.hidden = true;
    const file = picker.files[0];
    if (!file) return;
    picker.value = '';
    if (file.size > maxFile) {
      status.textContent = '备份文件太大，最大支持 8 MB。';
      return;
    }
    try {
      const raw = await file.text();
      if (version !== fileVersion) return;
      contents.value = raw;
      showPreview();
    } catch {
      if (version === fileVersion) status.textContent = '文件读取失败。你也可以复制备份文字并粘贴到文本框。';
    }
  };
  contents.oninput = () => {
    fileVersion++;
    previewed = '';
    restore.hidden = true;
    status.textContent = '';
  };
  get('device-backup-preview').onclick = showPreview;
  restore.onclick = () => {
    if (!previewed || previewed !== contents.value) return;
    try {
      const result = store.restore(previewed);
      previewed = '';
      restore.hidden = true;
      status.textContent = '已导入 '+result.thread+' 段对话、'+result.route+' 条路线，跳过 '+result.skipped+' 条重复记录。';
      window.dispatchEvent(new Event('traffic-device-restore'));
    } catch (error) {
      status.textContent = error.message;
    }
  };
  get('local-dialog').addEventListener('close', () => {
    fileVersion++;
    contents.value = '';
    previewed = '';
    restore.hidden = true;
    status.textContent = '';
    panel.open = false;
  });
})();
