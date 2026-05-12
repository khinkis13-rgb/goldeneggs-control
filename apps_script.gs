/**
 * Золотые яйца — backend для пульта публикаций.
 * Связывает Google-таблицу с HTML-дашбордом.
 *
 * Установка:
 *  1. В Google-таблице: Расширения → Apps Script.
 *  2. Удалите всё, что там есть. Вставьте этот код. Сохраните (Ctrl/Cmd+S).
 *  3. Нажмите «Развернуть» → «Новое развертывание».
 *     Тип: «Веб-приложение». Кто имеет доступ: «Все».
 *     Запускать от имени: «Я».
 *  4. Скопируйте URL вида https://script.google.com/macros/s/.../exec
 *     и вставьте в Настройки дашборда.
 *  5. Один раз запустите функцию initSheet() из редактора Apps Script
 *     (выберите её в выпадающем меню сверху и нажмите ▶). Google попросит
 *     разрешения — соглашайтесь.
 */

const SHEET_NAME = 'инст';      // имя листа с публикациями
const HEADER_ROW = 5;           // строка с заголовками
const FIRST_DATA_ROW = 6;       // строка, с которой начинаются посты

// Карта колонок (1-based). При initSheet() недостающие создаются автоматически.
const COLS = {
  datetime:  { col: 1, header: 'Дата, время публикации' },
  title:     { col: 2, header: 'Публикация' },
  mode:      { col: 3, header: 'Режим' },
  text:      { col: 4, header: 'Текст' },
  media:     { col: 5, header: 'Медиа' },
  cover:     { col: 6, header: 'Обложка' },
  status:    { col: 7, header: 'Статус' },
  hashtags:  { col: 8, header: 'Хэштеги' },
  owner:     { col: 9, header: 'Ответственный' },
  checks:    { col: 10, header: 'Чек-лист (JSON)' },
  notes:     { col: 11, header: 'Заметки' }
};

/** Запустите один раз из редактора Apps Script — добавит недостающие заголовки. */
function initSheet() {
  const sheet = getSheet_();
  Object.values(COLS).forEach(c => {
    const cell = sheet.getRange(HEADER_ROW, c.col);
    if (!cell.getValue()) cell.setValue(c.header);
  });
  // Жирные заголовки, фиксация шапки
  sheet.getRange(HEADER_ROW, 1, 1, Object.keys(COLS).length).setFontWeight('bold');
  sheet.setFrozenRows(HEADER_ROW);
  // Лёгкая настройка ширины
  sheet.setColumnWidth(COLS.datetime.col, 130);
  sheet.setColumnWidth(COLS.title.col, 200);
  sheet.setColumnWidth(COLS.mode.col, 140);
  sheet.setColumnWidth(COLS.text.col, 320);
  sheet.setColumnWidth(COLS.media.col, 240);
  sheet.setColumnWidth(COLS.cover.col, 200);
  sheet.setColumnWidth(COLS.status.col, 110);
  sheet.setColumnWidth(COLS.hashtags.col, 240);
  sheet.setColumnWidth(COLS.owner.col, 110);
  sheet.setColumnWidth(COLS.checks.col, 200);
  sheet.setColumnWidth(COLS.notes.col, 200);
  SpreadsheetApp.getUi().alert('Готово. Колонки на месте. Можно запускать seedPosts() или подключать пульт.');
}

/** Запустите один раз — зальёт расписание 20 постов в таблицу. */
function seedPosts() {
  const sheet = getSheet_();
  const ui = SpreadsheetApp.getUi();
  if (sheet.getLastRow() >= FIRST_DATA_ROW) {
    const r = ui.alert(
      'Внимание',
      'В таблице уже есть данные (' + (sheet.getLastRow() - FIRST_DATA_ROW + 1) +
      ' строк). Дозаписать 20 постов в конец?',
      ui.ButtonSet.YES_NO
    );
    if (r !== ui.Button.YES) return;
  }
  const SEED = [
    ['2026-05-13T09:00:00', 'Приветственный пост',         'В ленту'],
    ['2026-05-13T14:00:00', 'Трейлер 1',                   'Reels (пробный)'],
    ['2026-05-13T19:00:00', 'До премьеры остался 1 день',  'Пост + история'],
    ['2026-05-13T21:00:00', 'Трейлер 2',                   'Reels (пробный)'],
    ['2026-05-14T10:00:00', '1 серия',                     'В ленту'],
    ['2026-05-14T17:00:00', '2 серия',                     'В ленту'],
    ['2026-05-15T12:00:00', 'Рилс 1',                      'Reels (пробный)'],
    ['2026-05-16T10:00:00', '3 серия',                     'В ленту'],
    ['2026-05-16T17:00:00', '4 серия',                     'В ленту'],
    ['2026-05-17T12:00:00', 'Рилс 2',                      'Reels (пробный)'],
    ['2026-05-18T10:00:00', '5 серия',                     'В ленту'],
    ['2026-05-18T17:00:00', '6 серия',                     'В ленту'],
    ['2026-05-19T12:00:00', 'Рилс 3',                      'Reels (пробный)'],
    ['2026-05-20T10:00:00', '7 серия',                     'В ленту'],
    ['2026-05-20T17:00:00', '8 серия',                     'В ленту'],
    ['2026-05-21T12:00:00', 'Рилс 4',                      'Reels (пробный)'],
    ['2026-05-22T10:00:00', '9 серия',                     'В ленту'],
    ['2026-05-22T17:00:00', '10 серия',                    'В ленту'],
    ['2026-05-23T12:00:00', 'Рилс 5',                      'Reels (пробный)'],
    ['2026-05-23T19:00:00', 'Рилс 6',                      'Reels (пробный)']
  ];
  const lastCol = Math.max.apply(null, Object.values(COLS).map(c => c.col));
  const rows = SEED.map(function(item) {
    const row = new Array(lastCol).fill('');
    row[COLS.datetime.col - 1] = new Date(item[0]);
    row[COLS.title.col - 1]    = item[1];
    row[COLS.mode.col - 1]     = item[2];
    row[COLS.status.col - 1]   = 'draft';
    row[COLS.owner.col - 1]    = 'Аня';
    return row;
  });
  const startRow = Math.max(sheet.getLastRow() + 1, FIRST_DATA_ROW);
  sheet.getRange(startRow, 1, rows.length, lastCol).setValues(rows);
  sheet.getRange(startRow, COLS.datetime.col, rows.length, 1).setNumberFormat('dd.MM.yyyy HH:mm');
  ui.alert('Готово! Залито ' + rows.length + ' постов. Откройте пульт и нажмите «Подключить и загрузить».');
}

/** GET — отдать все посты JSON-ом. */
function doGet(e) {
  return handle_({ action: 'read' });
}

/** POST — принять команду на чтение/запись. Тело — JSON. */
function doPost(e) {
  let payload = {};
  try { payload = JSON.parse(e.postData.contents); } catch (_) {}
  return handle_(payload);
}

function handle_(payload) {
  try {
    if (payload.action === 'read' || !payload.action) {
      return json_({ ok: true, posts: readAll_(), serverTime: new Date().toISOString() });
    }
    if (payload.action === 'update') {
      const r = updateField_(payload.rowIndex, payload.field, payload.value);
      return json_({ ok: true, updated: r });
    }
    if (payload.action === 'create') {
      const r = createPost_(payload.post || {});
      return json_({ ok: true, rowIndex: r });
    }
    if (payload.action === 'delete') {
      const r = deletePost_(payload.rowIndex);
      return json_({ ok: true, deleted: r });
    }
    return json_({ ok: false, error: 'unknown action: ' + payload.action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function readAll_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) return [];
  const lastCol = Math.max.apply(null, Object.values(COLS).map(c => c.col));
  const values = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, lastCol).getValues();
  const posts = [];
  values.forEach((row, i) => {
    const dt = row[COLS.datetime.col - 1];
    const title = row[COLS.title.col - 1];
    if (!dt && !title) return;
    let checks = {};
    const checksRaw = row[COLS.checks.col - 1];
    if (checksRaw) {
      try { checks = JSON.parse(checksRaw); } catch (_) {}
    }
    posts.push({
      rowIndex: FIRST_DATA_ROW + i,
      datetime: dt instanceof Date ? dt.toISOString() : String(dt || ''),
      title: String(title || ''),
      mode: String(row[COLS.mode.col - 1] || ''),
      text: String(row[COLS.text.col - 1] || ''),
      media: String(row[COLS.media.col - 1] || ''),
      cover: String(row[COLS.cover.col - 1] || ''),
      status: String(row[COLS.status.col - 1] || 'draft') || 'draft',
      hashtags: String(row[COLS.hashtags.col - 1] || ''),
      owner: String(row[COLS.owner.col - 1] || ''),
      checks: checks,
      notes: String(row[COLS.notes.col - 1] || '')
    });
  });
  return posts;
}

function updateField_(rowIndex, field, value) {
  if (!rowIndex || rowIndex < FIRST_DATA_ROW) throw new Error('Bad rowIndex: ' + rowIndex);
  const col = COLS[field];
  if (!col) throw new Error('Unknown field: ' + field);
  const sheet = getSheet_();
  const out = field === 'checks' ? JSON.stringify(value || {}) : value;
  sheet.getRange(rowIndex, col.col).setValue(out);
  return { rowIndex: rowIndex, field: field };
}

function createPost_(post) {
  const sheet = getSheet_();
  const rowIndex = Math.max(sheet.getLastRow() + 1, FIRST_DATA_ROW);
  Object.keys(COLS).forEach(f => {
    if (post[f] !== undefined && post[f] !== null) {
      const v = f === 'checks' ? JSON.stringify(post[f] || {}) : post[f];
      sheet.getRange(rowIndex, COLS[f].col).setValue(v);
    }
  });
  return rowIndex;
}

function deletePost_(rowIndex) {
  if (!rowIndex || rowIndex < FIRST_DATA_ROW) throw new Error('Bad rowIndex: ' + rowIndex);
  const sheet = getSheet_();
  sheet.deleteRow(rowIndex);
  return rowIndex;
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Лист "' + SHEET_NAME + '" не найден');
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
