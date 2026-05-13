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

// PIN-код для доступа к пульту. Замените на свой и переразверните Web App.
// Любой запрос без правильного PIN получит {ok:false, code:'PIN_REQUIRED'}.
const APP_PIN = '1405';

// Карта колонок (1-based). При initSheet() недостающие создаются автоматически.
// Base-поля = Instagram (главная платформа). Для FB/TG/TT/YT/VK — override-блоки.
const COLS = {
  datetime:    { col: 1,  header: 'Дата, время публикации' },
  title:       { col: 2,  header: 'Публикация' },
  mode:        { col: 3,  header: 'Режим' },
  text:        { col: 4,  header: 'Текст (IG / база)' },
  media:       { col: 5,  header: 'Медиа (IG / база)' },
  cover:       { col: 6,  header: 'Обложка (IG / база)' },
  status:      { col: 7,  header: 'Статус' },
  hashtags:    { col: 8,  header: 'Хэштеги (IG / база)' },
  owner:       { col: 9,  header: 'Ответственный' },
  checks:      { col: 10, header: 'Чек-лист (JSON)' },
  notes:       { col: 11, header: 'Заметки' },
  platforms:   { col: 12, header: 'Площадки' },
  // Facebook override
  text_fb:     { col: 13, header: 'Текст FB' },
  hashtags_fb: { col: 14, header: 'Хэштеги FB' },
  media_fb:    { col: 15, header: 'Медиа FB' },
  cover_fb:    { col: 16, header: 'Обложка FB' },
  // Telegram override
  text_tg:     { col: 17, header: 'Текст TG' },
  hashtags_tg: { col: 18, header: 'Хэштеги TG' },
  media_tg:    { col: 19, header: 'Медиа TG' },
  cover_tg:    { col: 20, header: 'Обложка TG' },
  // TikTok override
  text_tt:     { col: 21, header: 'Текст TT' },
  hashtags_tt: { col: 22, header: 'Хэштеги TT' },
  media_tt:    { col: 23, header: 'Медиа TT' },
  cover_tt:    { col: 24, header: 'Обложка TT' },
  // YouTube override
  text_yt:     { col: 25, header: 'Текст YT' },
  hashtags_yt: { col: 26, header: 'Хэштеги YT' },
  media_yt:    { col: 27, header: 'Медиа YT' },
  cover_yt:    { col: 28, header: 'Обложка YT' },
  // VK override
  text_vk:     { col: 29, header: 'Текст VK' },
  hashtags_vk: { col: 30, header: 'Хэштеги VK' },
  media_vk:    { col: 31, header: 'Медиа VK' },
  cover_vk:    { col: 32, header: 'Обложка VK' }
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
  sheet.setColumnWidth(COLS.platforms.col, 160);
  // Override-колонки — узкие, чтобы шапка не растягивалась
  ['text_fb','hashtags_fb','media_fb','cover_fb',
   'text_tg','hashtags_tg','media_tg','cover_tg',
   'text_tt','hashtags_tt','media_tt','cover_tt',
   'text_yt','hashtags_yt','media_yt','cover_yt',
   'text_vk','hashtags_vk','media_vk','cover_vk'].forEach(f => sheet.setColumnWidth(COLS[f].col, 180));
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
    row[COLS.datetime.col - 1]  = new Date(item[0]);
    row[COLS.title.col - 1]     = item[1];
    row[COLS.mode.col - 1]      = item[2];
    row[COLS.status.col - 1]    = 'draft';
    row[COLS.owner.col - 1]     = 'Аня';
    row[COLS.platforms.col - 1] = 'Instagram, Facebook';
    return row;
  });
  const startRow = Math.max(sheet.getLastRow() + 1, FIRST_DATA_ROW);
  sheet.getRange(startRow, 1, rows.length, lastCol).setValues(rows);
  sheet.getRange(startRow, COLS.datetime.col, rows.length, 1).setNumberFormat('dd.MM.yyyy HH:mm');
  ui.alert('Готово! Залито ' + rows.length + ' постов. Откройте пульт и нажмите «Подключить и загрузить».');
}

/** GET — закрыт, чтобы не было бэкдора в обход PIN. */
function doGet(e) {
  return json_({ ok: false, error: 'GET disabled. Use POST with PIN.' });
}

/** POST — принять команду на чтение/запись. Тело — JSON. */
function doPost(e) {
  let payload = {};
  try { payload = JSON.parse(e.postData.contents); } catch (_) {}
  return handle_(payload);
}

function handle_(payload) {
  try {
    if (!payload.pin || payload.pin !== APP_PIN) {
      return json_({ ok: false, error: 'Bad PIN', code: 'PIN_REQUIRED' });
    }
    if (payload.action === 'ping') {
      return json_({ ok: true });
    }
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
    if (payload.action === 'upload') {
      const r = uploadFile_(payload);
      return json_({ ok: true, url: r.url, fileId: r.fileId, name: r.name });
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
    const post = {
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
      notes: String(row[COLS.notes.col - 1] || ''),
      platforms: String(row[COLS.platforms.col - 1] || '')
    };
    // Override-поля по платформам
    ['fb','tg','tt','yt','vk'].forEach(function(s) {
      ['text','hashtags','media','cover'].forEach(function(f) {
        const key = f + '_' + s;
        post[key] = String(row[COLS[key].col - 1] || '');
      });
    });
    posts.push(post);
  });
  return posts;
}

/** Загрузить файл в общую папку Drive и вернуть публичную ссылку. */
function uploadFile_(p) {
  if (!p || !p.dataBase64) throw new Error('Нет данных файла');
  if (!p.folderUrl) throw new Error('Не указана папка Drive (в Настройках пульта)');
  const m = String(p.folderUrl).match(/folders\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error('Не получилось распознать папку Drive в URL');
  const folder = DriveApp.getFolderById(m[1]);
  const bytes = Utilities.base64Decode(p.dataBase64);
  const blob = Utilities.newBlob(bytes, p.mimeType || 'application/octet-stream', p.filename || 'upload');
  const file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // Иногда нужно установить только access, отдельно permission. Тихо игнорим, ссылка всё равно вернётся.
  }
  return {
    url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    fileId: file.getId(),
    name: file.getName()
  };
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
