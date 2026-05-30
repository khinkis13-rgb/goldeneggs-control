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

// Листы для вкладки «Страницы»
const PROFILES_SHEET = 'профили';
const HIGHLIGHTS_SHEET = 'highlights';
const PROFILES_HEADER_ROW = 1;
const PROFILES_FIRST_DATA_ROW = 2;

const PLATFORMS_ALL = ['Instagram','Facebook','Telegram','TikTok','YouTube','VK'];

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
  cover_vk:    { col: 32, header: 'Обложка VK' },
  // Instagram publish result (Этап 2.0)
  ig_post_id:  { col: 33, header: 'IG post id' },
  ig_permalink:{ col: 34, header: 'IG ссылка' }
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
  sheet.setColumnWidth(COLS.ig_post_id.col, 160);
  sheet.setColumnWidth(COLS.ig_permalink.col, 260);
  // Листы профилей и highlights — идемпотентно
  initProfilesSheet_();
  initHighlightsSheet_();
  // Поп-ап только если есть UI-контекст (из меню таблицы). При запуске из
  // редактора Apps Script getUi() недоступен — тогда просто пишем в журнал.
  const doneMsg = 'Готово. Колонки на месте. Листы «профили» и «highlights» созданы. Можно запускать seedPosts() или подключать пульт.';
  try {
    SpreadsheetApp.getUi().alert(doneMsg);
  } catch (_) {
    Logger.log(doneMsg);
  }
}

// ===== Профили (вкладка «Страницы») =====

const PROFILE_COLS = {
  platform:     { col: 1,  header: 'Платформа' },
  handle:       { col: 2,  header: '@handle' },
  display_name: { col: 3,  header: 'Название' },
  profile_url:  { col: 4,  header: 'URL профиля' },
  avatar_url:   { col: 5,  header: 'Аватар' },
  cover_url:    { col: 6,  header: 'Обложка' },
  bio:          { col: 7,  header: 'Био' },
  link_in_bio:  { col: 8,  header: 'Ссылка в bio' },
  description:  { col: 9,  header: 'Описание' },
  extra_links:  { col: 10, header: 'Доп. ссылки' },
  updated_at:   { col: 11, header: 'Обновлено' },
  notes:        { col: 12, header: 'Заметки' }
};

const HIGHLIGHT_COLS = {
  id:           { col: 1, header: 'ID' },
  platform:     { col: 2, header: 'Платформа' },
  title:        { col: 3, header: 'Название' },
  cover_url:    { col: 4, header: 'Обложка' },
  order_idx:    { col: 5, header: 'Порядок' },
  content_note: { col: 6, header: 'Что внутри' },
  link:         { col: 7, header: 'Ссылка' },
  updated_at:   { col: 8, header: 'Обновлено' }
};

function initProfilesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PROFILES_SHEET);
  if (!sheet) sheet = ss.insertSheet(PROFILES_SHEET);
  Object.values(PROFILE_COLS).forEach(c => {
    const cell = sheet.getRange(PROFILES_HEADER_ROW, c.col);
    if (!cell.getValue()) cell.setValue(c.header);
  });
  sheet.getRange(PROFILES_HEADER_ROW, 1, 1, Object.keys(PROFILE_COLS).length).setFontWeight('bold');
  sheet.setFrozenRows(PROFILES_HEADER_ROW);
  sheet.setColumnWidth(PROFILE_COLS.platform.col, 110);
  sheet.setColumnWidth(PROFILE_COLS.handle.col, 160);
  sheet.setColumnWidth(PROFILE_COLS.display_name.col, 180);
  sheet.setColumnWidth(PROFILE_COLS.profile_url.col, 220);
  sheet.setColumnWidth(PROFILE_COLS.avatar_url.col, 220);
  sheet.setColumnWidth(PROFILE_COLS.cover_url.col, 220);
  sheet.setColumnWidth(PROFILE_COLS.bio.col, 280);
  sheet.setColumnWidth(PROFILE_COLS.link_in_bio.col, 220);
  sheet.setColumnWidth(PROFILE_COLS.description.col, 320);
  sheet.setColumnWidth(PROFILE_COLS.extra_links.col, 240);
  sheet.setColumnWidth(PROFILE_COLS.updated_at.col, 140);
  sheet.setColumnWidth(PROFILE_COLS.notes.col, 220);
  // Пред-создаём строки для всех 6 платформ, если их ещё нет
  const existing = readProfiles_();
  const haveSet = {};
  existing.forEach(p => { haveSet[p.platform] = true; });
  const lastCol = Math.max.apply(null, Object.values(PROFILE_COLS).map(c => c.col));
  let nextRow = Math.max(sheet.getLastRow() + 1, PROFILES_FIRST_DATA_ROW);
  PLATFORMS_ALL.forEach(plat => {
    if (haveSet[plat]) return;
    const row = new Array(lastCol).fill('');
    row[PROFILE_COLS.platform.col - 1] = plat;
    sheet.getRange(nextRow, 1, 1, lastCol).setValues([row]);
    nextRow++;
  });
}

function initHighlightsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HIGHLIGHTS_SHEET);
  if (!sheet) sheet = ss.insertSheet(HIGHLIGHTS_SHEET);
  Object.values(HIGHLIGHT_COLS).forEach(c => {
    const cell = sheet.getRange(PROFILES_HEADER_ROW, c.col);
    if (!cell.getValue()) cell.setValue(c.header);
  });
  sheet.getRange(PROFILES_HEADER_ROW, 1, 1, Object.keys(HIGHLIGHT_COLS).length).setFontWeight('bold');
  sheet.setFrozenRows(PROFILES_HEADER_ROW);
  sheet.setColumnWidth(HIGHLIGHT_COLS.id.col, 220);
  sheet.setColumnWidth(HIGHLIGHT_COLS.platform.col, 110);
  sheet.setColumnWidth(HIGHLIGHT_COLS.title.col, 200);
  sheet.setColumnWidth(HIGHLIGHT_COLS.cover_url.col, 220);
  sheet.setColumnWidth(HIGHLIGHT_COLS.order_idx.col, 80);
  sheet.setColumnWidth(HIGHLIGHT_COLS.content_note.col, 320);
  sheet.setColumnWidth(HIGHLIGHT_COLS.link.col, 220);
  sheet.setColumnWidth(HIGHLIGHT_COLS.updated_at.col, 140);
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
    if (payload.action === 'publishInstagram') {
      const r = publishInstagram_(payload);
      return json_({ ok: true, igPostId: r.igPostId, permalink: r.permalink });
    }
    if (payload.action === 'upload') {
      const r = uploadFile_(payload);
      return json_({ ok: true, url: r.url, fileId: r.fileId, name: r.name });
    }
    if (payload.action === 'zipMedia') {
      const r = zipMedia_(payload);
      return json_(r);
    }
    if (payload.action === 'readProfiles') {
      return json_({
        ok: true,
        profiles: readProfiles_(),
        highlights: readHighlights_(),
        serverTime: new Date().toISOString()
      });
    }
    if (payload.action === 'saveProfile') {
      const r = saveProfile_(payload.profile || {});
      return json_({ ok: true, profile: r });
    }
    if (payload.action === 'saveHighlight') {
      const r = saveHighlight_(payload.highlight || {});
      return json_({ ok: true, highlight: r });
    }
    if (payload.action === 'deleteHighlight') {
      const r = deleteHighlight_(payload.id);
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
      platforms: String(row[COLS.platforms.col - 1] || ''),
      ig_post_id: String(row[COLS.ig_post_id.col - 1] || ''),
      ig_permalink: String(row[COLS.ig_permalink.col - 1] || '')
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

/**
 * Собирает все указанные файлы (Drive-id или внешние http(s)) в один ZIP,
 * сохраняет в папку Drive из настроек (или в корень My Drive) и возвращает
 * прямую ссылку на скачивание.
 *
 * Вход:
 *   p.urls       — массив строк (URL Drive или http(s))
 *   p.filename   — основа имени архива без .zip
 *   p.folderUrl  — URL папки Drive (опционально)
 *
 * Выход: { ok, url, viewUrl, fileId, count, requested, sizeBytes, skipped[] }
 */
function zipMedia_(p) {
  const urls = (p && p.urls) || [];
  if (!urls.length) throw new Error('Нет ссылок для архивации');

  // Куда сохранять архив
  let folder = null;
  if (p.folderUrl) {
    const m = String(p.folderUrl).match(/folders\/([a-zA-Z0-9_-]+)/);
    if (m) {
      try { folder = DriveApp.getFolderById(m[1]); } catch (_) {}
    }
  }
  if (!folder) folder = DriveApp.getRootFolder();

  // Чистим архивы старше 24 ч в той же папке
  try { cleanupOldZips_(folder); } catch (_) {}

  const blobs = [];
  const skipped = [];
  const usedNames = {};

  urls.forEach(function(rawUrl, idx) {
    const u = String(rawUrl || '').split('#')[0].trim();
    if (!u) return;
    let blob = null;
    let baseName = '';

    const id = extractDriveId_(u);
    if (id) {
      try {
        const file = DriveApp.getFileById(id);
        blob = file.getBlob();
        baseName = file.getName();
      } catch (err) {
        skipped.push({ url: u, reason: 'Drive: ' + (err && err.message || err) });
        return;
      }
    } else if (/^https?:\/\//i.test(u)) {
      try {
        const resp = UrlFetchApp.fetch(u, { muteHttpExceptions: true, followRedirects: true });
        const code = resp.getResponseCode();
        if (code >= 400) { skipped.push({ url: u, reason: 'HTTP ' + code }); return; }
        blob = resp.getBlob();
        const tail = u.split('/').pop() || ('file_' + (idx + 1));
        baseName = decodeURIComponent(tail.split('?')[0] || ('file_' + (idx + 1)));
      } catch (err) {
        skipped.push({ url: u, reason: 'fetch: ' + (err && err.message || err) });
        return;
      }
    } else {
      skipped.push({ url: u, reason: 'не Drive и не http(s)' });
      return;
    }

    let nm = baseName || ('file_' + (idx + 1));
    if (usedNames[nm]) {
      const dot = nm.lastIndexOf('.');
      const stem = dot > 0 ? nm.slice(0, dot) : nm;
      const ext = dot > 0 ? nm.slice(dot) : '';
      let i = 2;
      while (usedNames[stem + '_' + i + ext]) i++;
      nm = stem + '_' + i + ext;
    }
    usedNames[nm] = true;
    blob.setName(nm);
    blobs.push(blob);
  });

  if (!blobs.length) {
    return { ok: false, error: 'Ни один файл не удалось получить', requested: urls.length, skipped: skipped };
  }

  const stem = sanitizeFilename_(p.filename || 'media');
  const zipName = 'goldeneggs-zip-' + stem + '-' + nowStamp_() + '.zip';
  const zipBlob = Utilities.zip(blobs, zipName);
  const file = folder.createFile(zipBlob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (_) {}
  const fileId = file.getId();
  return {
    ok: true,
    url: 'https://drive.google.com/uc?export=download&id=' + fileId,
    viewUrl: 'https://drive.google.com/file/d/' + fileId + '/view',
    fileId: fileId,
    count: blobs.length,
    requested: urls.length,
    sizeBytes: file.getSize(),
    skipped: skipped
  };
}

function extractDriveId_(url) {
  if (!url) return '';
  const s = String(url);
  let m = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return '';
}

function sanitizeFilename_(s) {
  return String(s || '').replace(/[^\p{L}\p{N}_\-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'media';
}

function nowStamp_() {
  const d = new Date();
  function p(n) { return n < 10 ? '0' + n : '' + n; }
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function cleanupOldZips_(folder) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const it = folder.getFiles();
  let processed = 0;
  while (it.hasNext() && processed < 50) {
    const f = it.next();
    processed++;
    const name = f.getName();
    if (name.indexOf('goldeneggs-zip-') !== 0) continue;
    if (f.getLastUpdated().getTime() > cutoff) continue;
    try { f.setTrashed(true); } catch (_) {}
  }
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

function getProfilesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PROFILES_SHEET);
  if (!sheet) { initProfilesSheet_(); sheet = ss.getSheetByName(PROFILES_SHEET); }
  return sheet;
}

function getHighlightsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HIGHLIGHTS_SHEET);
  if (!sheet) { initHighlightsSheet_(); sheet = ss.getSheetByName(HIGHLIGHTS_SHEET); }
  return sheet;
}

function readProfiles_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROFILES_SHEET);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < PROFILES_FIRST_DATA_ROW) return [];
  const lastCol = Math.max.apply(null, Object.values(PROFILE_COLS).map(c => c.col));
  const values = sheet.getRange(PROFILES_FIRST_DATA_ROW, 1, lastRow - PROFILES_FIRST_DATA_ROW + 1, lastCol).getValues();
  const out = [];
  values.forEach((row, i) => {
    const plat = String(row[PROFILE_COLS.platform.col - 1] || '');
    if (!plat) return;
    const p = { rowIndex: PROFILES_FIRST_DATA_ROW + i };
    Object.keys(PROFILE_COLS).forEach(f => {
      const raw = row[PROFILE_COLS[f].col - 1];
      if (f === 'updated_at' && raw instanceof Date) p[f] = raw.toISOString();
      else p[f] = String(raw || '');
    });
    out.push(p);
  });
  return out;
}

function saveProfile_(profile) {
  if (!profile || !profile.platform) throw new Error('Не указана платформа');
  const sheet = getProfilesSheet_();
  const existing = readProfiles_();
  const match = existing.filter(p => p.platform === profile.platform)[0];
  const lastCol = Math.max.apply(null, Object.values(PROFILE_COLS).map(c => c.col));
  const rowIndex = match ? match.rowIndex : Math.max(sheet.getLastRow() + 1, PROFILES_FIRST_DATA_ROW);
  const nowIso = new Date().toISOString();
  Object.keys(PROFILE_COLS).forEach(f => {
    if (f === 'updated_at') {
      sheet.getRange(rowIndex, PROFILE_COLS[f].col).setValue(nowIso);
      return;
    }
    if (profile[f] !== undefined && profile[f] !== null) {
      sheet.getRange(rowIndex, PROFILE_COLS[f].col).setValue(profile[f]);
    } else if (!match) {
      sheet.getRange(rowIndex, PROFILE_COLS[f].col).setValue('');
    }
  });
  return { rowIndex: rowIndex, platform: profile.platform, updated_at: nowIso };
}

function readHighlights_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(HIGHLIGHTS_SHEET);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < PROFILES_FIRST_DATA_ROW) return [];
  const lastCol = Math.max.apply(null, Object.values(HIGHLIGHT_COLS).map(c => c.col));
  const values = sheet.getRange(PROFILES_FIRST_DATA_ROW, 1, lastRow - PROFILES_FIRST_DATA_ROW + 1, lastCol).getValues();
  const out = [];
  values.forEach((row, i) => {
    const id = String(row[HIGHLIGHT_COLS.id.col - 1] || '');
    if (!id) return;
    const h = { rowIndex: PROFILES_FIRST_DATA_ROW + i };
    Object.keys(HIGHLIGHT_COLS).forEach(f => {
      const raw = row[HIGHLIGHT_COLS[f].col - 1];
      if (f === 'updated_at' && raw instanceof Date) h[f] = raw.toISOString();
      else if (f === 'order_idx') h[f] = Number(raw) || 0;
      else h[f] = String(raw || '');
    });
    out.push(h);
  });
  out.sort((a, b) => (a.order_idx - b.order_idx) || a.id.localeCompare(b.id));
  return out;
}

function saveHighlight_(highlight) {
  if (!highlight || !highlight.platform) throw new Error('Не указана платформа');
  const sheet = getHighlightsSheet_();
  const existing = readHighlights_();
  let id = String(highlight.id || '');
  let rowIndex;
  if (id) {
    const match = existing.filter(h => h.id === id)[0];
    rowIndex = match ? match.rowIndex : Math.max(sheet.getLastRow() + 1, PROFILES_FIRST_DATA_ROW);
  } else {
    id = Utilities.getUuid();
    rowIndex = Math.max(sheet.getLastRow() + 1, PROFILES_FIRST_DATA_ROW);
  }
  const nowIso = new Date().toISOString();
  const values = {
    id: id,
    platform: highlight.platform,
    title: highlight.title !== undefined ? highlight.title : '',
    cover_url: highlight.cover_url !== undefined ? highlight.cover_url : '',
    order_idx: highlight.order_idx !== undefined ? Number(highlight.order_idx) || 0 : 0,
    content_note: highlight.content_note !== undefined ? highlight.content_note : '',
    link: highlight.link !== undefined ? highlight.link : '',
    updated_at: nowIso
  };
  Object.keys(HIGHLIGHT_COLS).forEach(f => {
    sheet.getRange(rowIndex, HIGHLIGHT_COLS[f].col).setValue(values[f]);
  });
  return { rowIndex: rowIndex, id: id, platform: highlight.platform, updated_at: nowIso };
}

function deleteHighlight_(id) {
  if (!id) throw new Error('Нет id');
  const sheet = getHighlightsSheet_();
  const existing = readHighlights_();
  const match = existing.filter(h => h.id === String(id))[0];
  if (!match) return { id: id, missing: true };
  sheet.deleteRow(match.rowIndex);
  return { id: id };
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===================================================================
// Instagram publishing (Этап 2.0) — план plans/2026-05-26-avtopublikaciya-v-instagram.md
// ===================================================================

const GRAPH_VERSION = 'v23.0';
const GRAPH_BASE = 'https://graph.facebook.com/';

/** Читает токен и IG Business Account ID из Script Properties. */
function igProps_() {
  const props = PropertiesService.getScriptProperties();
  const igUserId = props.getProperty('IG_USER_ID');
  const token = props.getProperty('IG_ACCESS_TOKEN');
  if (!igUserId || !token) {
    throw new Error('Нет IG_USER_ID или IG_ACCESS_TOKEN в Script Properties (Project Settings → Script Properties).');
  }
  return { igUserId: igUserId, token: token };
}

/**
 * Прямая ссылка на ПОЛНОРАЗМЕРНУЮ картинку Google Drive — для Meta.
 * Drive thumbnail (sz=w400) Meta не скачает; нужен реальный JPEG/PNG публичной папки.
 */
function driveDirectUrl_(fileId, px) {
  return 'https://lh3.googleusercontent.com/d/' + fileId + '=w' + (px || 1440);
}

/**
 * Один вызов Graph API (POST). Разбирает ответ Meta и кидает читаемую ошибку.
 */
function igGraphPost_(url, payload) {
  const resp = UrlFetchApp.fetch(url, { method: 'post', muteHttpExceptions: true, payload: payload });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  if (code !== 200 || data.error) {
    const e = data.error || {};
    const parts = [];
    if (e.message) parts.push(e.message);
    if (e.error_user_msg) parts.push(e.error_user_msg);
    if (!parts.length) parts.push('HTTP ' + code);
    let msg = parts.join(' — ');
    if (e.code) msg += ' (code ' + e.code + (e.error_subcode ? '/' + e.error_subcode : '') + ')';
    throw new Error('Instagram: ' + msg);
  }
  return data;
}

/** Создаёт media-контейнер для одного фото. Возвращает creation_id. */
function igCreateImageContainer_(creds, imageUrl, caption, isCarouselItem) {
  const payload = { image_url: imageUrl, access_token: creds.token };
  if (caption) payload.caption = caption;
  if (isCarouselItem) payload.is_carousel_item = 'true';
  const data = igGraphPost_(GRAPH_BASE + GRAPH_VERSION + '/' + creds.igUserId + '/media', payload);
  if (!data.id) throw new Error('Instagram: контейнер создан без id');
  return data.id;
}

/** Собирает контейнер карусели из готовых дочерних id. Возвращает creation_id. */
function igCreateCarouselContainer_(creds, childIds, caption) {
  const payload = {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    access_token: creds.token
  };
  if (caption) payload.caption = caption;
  const data = igGraphPost_(GRAPH_BASE + GRAPH_VERSION + '/' + creds.igUserId + '/media', payload);
  if (!data.id) throw new Error('Instagram: контейнер карусели создан без id');
  return data.id;
}

/** Публикует готовый контейнер. Возвращает id опубликованного медиа. */
function igPublishContainer_(creds, creationId) {
  const data = igGraphPost_(GRAPH_BASE + GRAPH_VERSION + '/' + creds.igUserId + '/media_publish', {
    creation_id: creationId,
    access_token: creds.token
  });
  if (!data.id) throw new Error('Instagram: публикация без id');
  return data.id;
}

/** Тянет permalink опубликованного поста. Не критично — при ошибке вернёт ''. */
function igPermalink_(creds, mediaId) {
  try {
    const url = GRAPH_BASE + GRAPH_VERSION + '/' + mediaId +
      '?fields=permalink&access_token=' + encodeURIComponent(creds.token);
    const resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    const data = JSON.parse(resp.getContentText());
    return data.permalink || '';
  } catch (_) {
    return '';
  }
}

/**
 * Фаза 2 — публикация поста в Instagram по запросу из пульта.
 * payload: { rowIndex, caption, mediaUrls[] }.
 *  - mediaUrls/caption приходят с фронта (то, что видно в превью). Если их нет —
 *    fallback: берём из строки листа (медиа + текст + хэштеги базовых IG-колонок).
 *  - 1 фото → контейнер → media_publish; 2+ → дочерние контейнеры → CAROUSEL → publish.
 * После успеха пишет в строку: статус published, ig_post_id, ig_permalink.
 * Возвращает { igPostId, permalink }.
 */
function publishInstagram_(payload) {
  const creds = igProps_();
  const rowIndex = payload.rowIndex;
  let urls = payload.mediaUrls;
  let caption = payload.caption;

  // Fallback из строки листа, если фронт не передал
  if ((!urls || !urls.length) && rowIndex) {
    const sheet = getSheet_();
    const mediaCell = String(sheet.getRange(rowIndex, COLS.media.col).getValue() || '');
    urls = mediaCell.split(/\n+/);
    if (caption === undefined || caption === null) {
      const txt = String(sheet.getRange(rowIndex, COLS.text.col).getValue() || '').trim();
      const tags = String(sheet.getRange(rowIndex, COLS.hashtags.col).getValue() || '').trim();
      caption = txt + (tags ? '\n\n' + tags : '');
    }
  }
  caption = String(caption || '');

  // Чистим URL (убираем #-метаданные имени/размера) и строим прямые ссылки для Meta
  const imageUrls = (urls || [])
    .map(function (u) { return String(u || '').split('#')[0].trim(); })
    .filter(Boolean)
    .map(function (u) {
      const id = extractDriveId_(u);
      return id ? driveDirectUrl_(id, 1440) : u;
    });

  if (!imageUrls.length) throw new Error('Нет картинок для публикации.');

  let creationId;
  if (imageUrls.length === 1) {
    creationId = igCreateImageContainer_(creds, imageUrls[0], caption, false);
  } else {
    const children = imageUrls.map(function (url) {
      return igCreateImageContainer_(creds, url, '', true);
    });
    creationId = igCreateCarouselContainer_(creds, children, caption);
  }

  const igPostId = igPublishContainer_(creds, creationId);
  const permalink = igPermalink_(creds, igPostId);

  // Запись результата в строку
  if (rowIndex) {
    const sheet = getSheet_();
    sheet.getRange(rowIndex, COLS.status.col).setValue('published');
    sheet.getRange(rowIndex, COLS.ig_post_id.col).setValue(igPostId);
    if (permalink) sheet.getRange(rowIndex, COLS.ig_permalink.col).setValue(permalink);
  }

  return { igPostId: igPostId, permalink: permalink };
}

/**
 * ТЕСТ Фазы 1 (запускать из редактора Apps Script: Run → testIgContainer_).
 * Берёт первую картинку первого поста с медиа, создаёт media-контейнер в IG
 * и логирует результат. НЕ публикует — на странице ничего не появляется.
 * Проверяет главную гипотезу: примет ли Meta ссылку lh3.googleusercontent.com.
 * Имя БЕЗ завершающего «_» — иначе Apps Script считает функцию приватной
 * и не показывает её в выпадающем списке «Выполнить».
 */
function testIgContainer() {
  const creds = igProps_();
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) throw new Error('В листе нет постов.');

  const mediaCol = COLS.media.col;
  const titleCol = COLS.title.col;
  const vals = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, Math.max(mediaCol, titleCol)).getValues();

  let mediaCell = '', title = '', foundRow = 0;
  for (let i = 0; i < vals.length; i++) {
    const cell = String(vals[i][mediaCol - 1] || '').trim();
    if (cell) { mediaCell = cell; title = String(vals[i][titleCol - 1] || ''); foundRow = FIRST_DATA_ROW + i; break; }
  }
  if (!mediaCell) throw new Error('Не нашёл ни одного поста с медиа.');

  const firstUrl = mediaCell.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean)[0];
  const fileId = extractDriveId_(firstUrl);
  if (!fileId) throw new Error('Не смог извлечь Drive ID из: ' + firstUrl);

  const imageUrl = driveDirectUrl_(fileId, 1440);
  Logger.log('Пост: «%s» (строка %s)', title, foundRow);
  Logger.log('Drive ID: %s', fileId);
  Logger.log('image_url для Meta: %s', imageUrl);

  const endpoint = GRAPH_BASE + GRAPH_VERSION + '/' + creds.igUserId + '/media';
  const resp = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      image_url: imageUrl,
      caption: '[ТЕСТ контейнера — не опубликовано] ' + title,
      access_token: creds.token
    }
  });
  const code = resp.getResponseCode();
  Logger.log('HTTP %s', code);
  Logger.log('Ответ Meta: %s', resp.getContentText());

  if (code === 200) {
    Logger.log('✅ УСПЕХ: Meta приняла ссылку, контейнер создан (creation_id выше). НЕ опубликован.');
  } else {
    Logger.log('❌ Meta отвергла. Частые причины: картинку не скачать (доступ к папке), формат не JPEG/PNG, соотношение сторон вне 4:5…1.91:1.');
  }
  return resp.getContentText();
}
