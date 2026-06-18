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
// PIN = мастер-доступ нашего дашборда (все аккаунты). Команды Фабрики ходят по
// API-ключам (Script Property API_KEYS, см. readApiKeys_ / authContext_).
const APP_PIN = '1405';

// ===== Реестр аккаунтов (мультиаккаунт, план 2026-06-18) =====
// Один System User токен (Script Property IG_ACCESS_TOKEN) публикует во много
// IG-аккаунтов — отличается только ig_user_id. Реестр живёт в листе «аккаунты»,
// чтобы его можно было править без кода.
const ACCOUNTS_SHEET = 'аккаунты';
const ACCOUNTS_HEADER_ROW = 1;
const ACCOUNTS_FIRST_DATA_ROW = 2;
// account_id аккаунта по умолчанию = текущий goldeneggs. Запросы без account_id
// (старый дашборд) маршрутизируются на него.
const DEFAULT_ACCOUNT_ID = 'goldeneggs';

// Колонки листа «аккаунты». Имена и порядок зафиксированы — их использует
// docs-агент и runbook онбординга, не переименовывать.
const ACCOUNT_COLS = {
  account_id:  { col: 1, header: 'account_id' },
  label:       { col: 2, header: 'label' },
  ig_user_id:  { col: 3, header: 'ig_user_id' },
  fb_page_id:  { col: 4, header: 'fb_page_id' },
  team:        { col: 5, header: 'команда' },
  status:      { col: 6, header: 'статус' }
};

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
  ig_permalink:{ col: 34, header: 'IG ссылка' },
  // Instagram доп-опции публикации (2026-05-30)
  ig_first_comment: { col: 35, header: 'IG хэштеги 1-м комментом' },
  ig_collaborators: { col: 36, header: 'IG соавторы' },
  ig_location_id:   { col: 37, header: 'IG локация ID' },
  ig_location_name: { col: 38, header: 'IG локация' },
  ig_user_tags:     { col: 39, header: 'IG отметки людей' },
  ig_alt_text:      { col: 40, header: 'IG alt-текст' },
  ig_share_to_feed: { col: 41, header: 'IG Reels в ленту' },
  // Планировщик автопубликаций (2026-05-30)
  sched_attempts:   { col: 42, header: 'План: попыток' },
  sched_error:      { col: 43, header: 'План: ошибка' },
  sched_payload:    { col: 44, header: 'План: снимок (JSON)' },
  // Мультиаккаунт (2026-06-18): в какой аккаунт публикуется строка.
  // Пусто = DEFAULT_ACCOUNT_ID (goldeneggs), обратная совместимость.
  account_id:       { col: 45, header: 'account_id' }
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
  // Доп-опции IG и планировщик — узкие служебные колонки
  ['ig_first_comment','ig_collaborators','ig_location_id','ig_location_name',
   'ig_user_tags','ig_alt_text','ig_share_to_feed','sched_attempts','sched_error','sched_payload',
   'account_id']
    .forEach(f => sheet.setColumnWidth(COLS[f].col, 160));
  // Листы профилей и highlights — идемпотентно
  initProfilesSheet_();
  initHighlightsSheet_();
  // Реестр аккаунтов (мультиаккаунт) — идемпотентно, засеет дефолтный goldeneggs
  initAccountsSheet_();
  // Триггер автопубликации по расписанию (идемпотентно).
  // Если авторизация триггеров ещё не выдана — не валим initSheet, просто сообщим.
  let trigMsg = ' Триггер автопубликации поставлен (раз в 5 мин).';
  try { installScheduleTrigger(); }
  catch (e) { trigMsg = ' ⚠ Триггер НЕ поставлен (' + (e && e.message || e) + ') — запустите installScheduleTrigger() отдельно.'; }
  // Поп-ап только если есть UI-контекст (из меню таблицы). При запуске из
  // редактора Apps Script getUi() недоступен — тогда просто пишем в журнал.
  const doneMsg = 'Готово. Колонки на месте. Листы «профили» и «highlights» созданы.' + trigMsg + ' Можно запускать seedPosts() или подключать пульт.';
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

// ===== Реестр аккаунтов: инициализатор и чтение =====

/**
 * Запустите один раз из редактора Apps Script — создаёт лист «аккаунты»
 * и засевает строку аккаунта по умолчанию (goldeneggs) с текущим IG_USER_ID.
 * Идемпотентно: повторный запуск не дублирует строку и не затирает данные.
 */
function initAccountsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ACCOUNTS_SHEET);
  if (!sheet) sheet = ss.insertSheet(ACCOUNTS_SHEET);
  Object.values(ACCOUNT_COLS).forEach(function (c) {
    const cell = sheet.getRange(ACCOUNTS_HEADER_ROW, c.col);
    if (!cell.getValue()) cell.setValue(c.header);
  });
  sheet.getRange(ACCOUNTS_HEADER_ROW, 1, 1, Object.keys(ACCOUNT_COLS).length).setFontWeight('bold');
  sheet.setFrozenRows(ACCOUNTS_HEADER_ROW);
  sheet.setColumnWidth(ACCOUNT_COLS.account_id.col, 140);
  sheet.setColumnWidth(ACCOUNT_COLS.label.col, 160);
  sheet.setColumnWidth(ACCOUNT_COLS.ig_user_id.col, 200);
  sheet.setColumnWidth(ACCOUNT_COLS.fb_page_id.col, 200);
  sheet.setColumnWidth(ACCOUNT_COLS.team.col, 140);
  sheet.setColumnWidth(ACCOUNT_COLS.status.col, 100);

  // Засеваем дефолтный аккаунт, только если его ещё нет.
  const have = readAccounts_().some(function (a) { return a.account_id === DEFAULT_ACCOUNT_ID; });
  if (!have) {
    const igUserId = PropertiesService.getScriptProperties().getProperty('IG_USER_ID') || '';
    const lastCol = Object.keys(ACCOUNT_COLS).length;
    const row = new Array(lastCol).fill('');
    row[ACCOUNT_COLS.account_id.col - 1] = DEFAULT_ACCOUNT_ID;
    row[ACCOUNT_COLS.label.col - 1]      = 'GoldenEggs';
    row[ACCOUNT_COLS.ig_user_id.col - 1] = igUserId;
    row[ACCOUNT_COLS.status.col - 1]     = 'active';
    const nextRow = Math.max(sheet.getLastRow() + 1, ACCOUNTS_FIRST_DATA_ROW);
    sheet.getRange(nextRow, 1, 1, lastCol).setValues([row]);
  }
  const doneMsg = 'Лист «' + ACCOUNTS_SHEET + '» готов. Аккаунт по умолчанию «' +
    DEFAULT_ACCOUNT_ID + '» засеян (ig_user_id из IG_USER_ID).';
  try { SpreadsheetApp.getUi().alert(doneMsg); } catch (_) { Logger.log(doneMsg); }
}

/**
 * Возвращает массив объектов аккаунтов из листа «аккаунты».
 * Ключи: {account_id, label, ig_user_id, fb_page_id, команда, статус}.
 * Если листа нет — пустой массив (резолв тогда упадёт на фолбэк IG_USER_ID).
 */
function readAccounts_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ACCOUNTS_SHEET);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < ACCOUNTS_FIRST_DATA_ROW) return [];
  const lastCol = Object.keys(ACCOUNT_COLS).length;
  const values = sheet.getRange(ACCOUNTS_FIRST_DATA_ROW, 1, lastRow - ACCOUNTS_FIRST_DATA_ROW + 1, lastCol).getValues();
  const out = [];
  values.forEach(function (row) {
    const id = String(row[ACCOUNT_COLS.account_id.col - 1] || '').trim();
    if (!id) return;
    out.push({
      account_id:  id,
      label:       String(row[ACCOUNT_COLS.label.col - 1] || ''),
      ig_user_id:  String(row[ACCOUNT_COLS.ig_user_id.col - 1] || '').trim(),
      fb_page_id:  String(row[ACCOUNT_COLS.fb_page_id.col - 1] || '').trim(),
      'команда':   String(row[ACCOUNT_COLS.team.col - 1] || ''),
      'статус':    String(row[ACCOUNT_COLS.status.col - 1] || '').trim()
    });
  });
  return out;
}

// ===== Мультитенантная авторизация (API-ключи команд, план 2026-06-18) =====

// Дефолтный белый список действий для командного ключа (когда в записи ключа
// нет поля actions). Узкий намеренно: чтение нашего листа «инст» (read /
// readProfiles) сюда НЕ входит, чтобы чужая команда не видела наш контент.
// Расширяется точечно через поле actions в записи ключа (см. readApiKeys_).
const DEFAULT_KEY_ACTIONS = ['upload', 'publishNow', 'ping'];

/**
 * Читает реестр API-ключей из Script Property API_KEYS.
 * Формат записи ключа:
 *   { "team": "...", "accounts": ["id1","id2"] | "*", "actions": ["upload",...] | "*" }
 *  - accounts — массив account_id или строка "*" (все аккаунты);
 *  - actions  — необязательный белый список действий (массив строк).
 *               Спец-значение ["*"] или "*" = все действия (доверенная интеграция).
 *               Если поле опущено — командному ключу доступен только дефолтный
 *               узкий набор DEFAULT_KEY_ACTIONS: upload / publishNow / ping.
 * Пример (одной строкой, как хранится в Script Property API_KEYS):
 *   {"key_factory_a":{"team":"FactoryA","accounts":["acc_a"]},
 *    "key_admin":{"team":"admin","accounts":"*","actions":["*"]}}
 * Если свойства нет или оно битое — пустой объект (тогда ключи не работают,
 * но мастер-PIN продолжает работать).
 */
function readApiKeys_() {
  const raw = PropertiesService.getScriptProperties().getProperty('API_KEYS');
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (_) {
    return {};
  }
}

/**
 * Разбирает payload в контекст авторизации.
 *  - мастер (наш дашборд) по APP_PIN: { master:true, accounts:'*', actions:'*' };
 *  - команда по apiKey из API_KEYS:
 *      { master:false, team, accounts:[...] | '*', actions:[...] | '*' },
 *    где actions — белый список действий: либо явный из записи ключа, либо
 *    дефолтный DEFAULT_KEY_ACTIONS; спец-значение "*" = все действия.
 *  - иначе null (отказ).
 */
function authContext_(payload) {
  if (payload.pin && payload.pin === APP_PIN) {
    return { master: true, team: 'master', accounts: '*', actions: '*' };
  }
  if (payload.apiKey) {
    const keys = readApiKeys_();
    const entry = keys[payload.apiKey];
    if (entry) {
      // actions: явный список из записи ключа, иначе дефолтный узкий набор.
      // "*" (строкой или ["*"]) = все действия для доверенной интеграции.
      let actions;
      if (entry.actions === '*' ||
          (Array.isArray(entry.actions) && entry.actions.indexOf('*') !== -1)) {
        actions = '*';
      } else if (Array.isArray(entry.actions)) {
        actions = entry.actions.map(function (a) { return String(a); });
      } else {
        actions = DEFAULT_KEY_ACTIONS.slice();
      }
      return {
        master: false,
        team: entry.team || '',
        accounts: (entry.accounts === '*' ? '*' : (entry.accounts || [])),
        actions: actions
      };
    }
  }
  return null;
}

/**
 * Проверяет, разрешён ли запрошенный account_id для контекста.
 * Незаполненный account_id трактуется как DEFAULT_ACCOUNT_ID (старый дашборд,
 * команда с дефолтом в списке). Мастер и "*" разрешают всё.
 */
function authAllowsAccount_(ctx, accountId) {
  if (!ctx) return false;
  if (ctx.master || ctx.accounts === '*') return true;
  const id = String(accountId || '').trim() || DEFAULT_ACCOUNT_ID;
  const list = Array.isArray(ctx.accounts) ? ctx.accounts : [];
  return list.indexOf(id) !== -1;
}

/**
 * Проверяет, входит ли действие в разрешённый для контекста набор.
 * Мастер и ctx.actions === '*' разрешают любое действие. Для командного ключа —
 * белый список (явный из записи ключа или дефолтный DEFAULT_KEY_ACTIONS).
 * Пустое action трактуется как 'read' (так же, как в диспатче handle_).
 */
function authAllowsAction_(ctx, action) {
  if (!ctx) return false;
  if (ctx.master || ctx.actions === '*') return true;
  const act = String(action || 'read');
  const list = Array.isArray(ctx.actions) ? ctx.actions : [];
  return list.indexOf(act) !== -1;
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
    // Авторизация: мастер-PIN (наш дашборд) ИЛИ API-ключ команды (Фабрика).
    const ctx = authContext_(payload);
    if (!ctx) {
      return json_({ ok: false, error: 'Bad PIN', code: 'PIN_REQUIRED' });
    }

    // Набор действий: мастер может всё, командный ключ — только белый список
    // (по умолчанию DEFAULT_KEY_ACTIONS). Проверяем ДО выполнения действия,
    // чтобы read/readProfiles и прочее не утекали по чужому ключу.
    if (!authAllowsAction_(ctx, payload.action)) {
      return json_({ ok: false, error: 'Действие «' +
        String(payload.action || 'read') + '» не разрешено для этого ключа.',
        code: 'ACTION_NOT_ALLOWED' });
    }

    // Действия с явным account_id — enforce доступ ключа к запрошенному аккаунту.
    // Для schedule/unschedule, если account_id не передан, берём из строки листа.
    const WRITE_ACCOUNT_ACTIONS = {
      publishInstagram: true, publishInstagramReels: true, publishNow: true,
      schedulePost: true, unschedulePost: true
    };
    if (WRITE_ACCOUNT_ACTIONS[payload.action]) {
      let reqAccount = payload.accountId || payload.account_id || '';
      if (!reqAccount && (payload.action === 'schedulePost' || payload.action === 'unschedulePost') && payload.rowIndex) {
        reqAccount = accountIdOfRow_(payload.rowIndex);
      }
      if (!authAllowsAccount_(ctx, reqAccount)) {
        return json_({ ok: false, error: 'Нет доступа к аккаунту «' +
          (String(reqAccount || '').trim() || DEFAULT_ACCOUNT_ID) + '».', code: 'ACCESS_DENIED' });
      }
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
    if (payload.action === 'publishInstagramReels') {
      const r = publishInstagramReels_(payload);
      return json_({ ok: true, igPostId: r.igPostId, permalink: r.permalink });
    }
    if (payload.action === 'publishNow') {
      const r = publishNow_(payload);
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
    if (payload.action === 'schedulePost') {
      const r = schedulePost_(payload.rowIndex, payload.snapshot);
      return json_({ ok: true, scheduled: r });
    }
    if (payload.action === 'unschedulePost') {
      const r = unschedulePost_(payload.rowIndex);
      return json_({ ok: true, unscheduled: r });
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
      ig_permalink: String(row[COLS.ig_permalink.col - 1] || ''),
      ig_first_comment: String(row[COLS.ig_first_comment.col - 1] || ''),
      ig_collaborators: String(row[COLS.ig_collaborators.col - 1] || ''),
      ig_location_id: String(row[COLS.ig_location_id.col - 1] || ''),
      ig_location_name: String(row[COLS.ig_location_name.col - 1] || ''),
      ig_user_tags: String(row[COLS.ig_user_tags.col - 1] || ''),
      ig_alt_text: String(row[COLS.ig_alt_text.col - 1] || ''),
      ig_share_to_feed: String(row[COLS.ig_share_to_feed.col - 1] || ''),
      sched_attempts: Number(row[COLS.sched_attempts.col - 1]) || 0,
      sched_error: String(row[COLS.sched_error.col - 1] || ''),
      account_id: String(row[COLS.account_id.col - 1] || '')
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

/**
 * account_id из строки публикаций ('' = дефолтный аккаунт).
 * Используется планировщиком и enforce-проверкой schedule/unschedule.
 */
function accountIdOfRow_(rowIndex) {
  if (!rowIndex || rowIndex < FIRST_DATA_ROW) return '';
  return String(getSheet_().getRange(rowIndex, COLS.account_id.col).getValue() || '').trim();
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

/**
 * Резолвит креды публикации для аккаунта. Токен ОДИН на все аккаунты
 * (System User, Script Property IG_ACCESS_TOKEN); из реестра берётся только
 * ig_user_id по account_id.
 *
 *  - accountId пуст → DEFAULT_ACCOUNT_ID (обратная совместимость со старым дашбордом).
 *  - account_id ищется в листе «аккаунты»; должен иметь статус 'active'.
 *  - Фолбэк: если листа «аккаунты» ещё нет (старая установка до initAccountsSheet_),
 *    дефолтный аккаунт резолвится напрямую из Script Property IG_USER_ID.
 *
 * Возвращает { igUserId, token, accountId } — форма, совместимая с хелперами
 * igCreate.../igPublish... (они принимают этот creds-объект как есть).
 */
function igCredsFor_(accountId) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('IG_ACCESS_TOKEN');
  if (!token) {
    throw new Error('Нет IG_ACCESS_TOKEN в Script Properties (Project Settings → Script Properties).');
  }
  const id = String(accountId || '').trim() || DEFAULT_ACCOUNT_ID;

  const accounts = readAccounts_();
  // Фолбэк до создания реестра: дефолтный аккаунт берёт ig_user_id из старого свойства.
  if (!accounts.length && id === DEFAULT_ACCOUNT_ID) {
    const igUserId = props.getProperty('IG_USER_ID');
    if (!igUserId) {
      throw new Error('Нет IG_USER_ID в Script Properties и лист «' + ACCOUNTS_SHEET +
        '» ещё не создан. Запустите initAccountsSheet_() или задайте IG_USER_ID.');
    }
    return { igUserId: igUserId, token: token, accountId: id };
  }

  const acc = accounts.filter(function (a) { return a.account_id === id; })[0];
  if (!acc) {
    // Фолбэк для дефолта, если реестр есть, но строки goldeneggs в нём нет.
    if (id === DEFAULT_ACCOUNT_ID) {
      const igUserId = props.getProperty('IG_USER_ID');
      if (igUserId) return { igUserId: igUserId, token: token, accountId: id };
    }
    throw new Error('Аккаунт «' + id + '» не найден в листе «' + ACCOUNTS_SHEET + '».');
  }
  if (acc['статус'] && acc['статус'] !== 'active') {
    throw new Error('Аккаунт «' + id + '» неактивен (статус: ' + acc['статус'] + ').');
  }
  if (!acc.ig_user_id) {
    throw new Error('У аккаунта «' + id + '» не заполнен ig_user_id в листе «' + ACCOUNTS_SHEET + '».');
  }
  return { igUserId: acc.ig_user_id, token: token, accountId: id };
}

/**
 * Тонкий шим обратной совместимости: креды дефолтного аккаунта.
 * Оставлен для diagToken/testIgContainer/diagReels/testIgReelsContainer,
 * которым не нужен явный account_id.
 */
function igProps_() {
  return igCredsFor_(DEFAULT_ACCOUNT_ID);
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
/** Разбирает «@a, @b c» в массив чистых username без @. */
function igParseHandles_(s) {
  return String(s || '').split(/[\s,;]+/)
    .map(function (x) { return x.replace(/^@+/, '').trim(); })
    .filter(Boolean);
}

/** Строка-флаг → boolean (true/yes/1/on/да). */
function igBool_(s) {
  return /^(true|yes|1|on|да)$/i.test(String(s || '').trim());
}

/** Соавторы и геометка — для одиночного фото, родителя карусели и Reels (НЕ для детей карусели). */
function igAddParentOpts_(payload, opts) {
  if (!opts) return;
  if (opts.collaborators && opts.collaborators.length) {
    // Instagram разрешает максимум 3 соавтора — лишних тихо отбрасываем.
    payload.collaborators = JSON.stringify(opts.collaborators.slice(0, 3));
  }
  if (opts.locationId) payload.location_id = String(opts.locationId);
}

/** Отметки людей и alt-текст — для фото-контейнеров (одиночное фото и дочерние карусели). */
function igAddPhotoOpts_(payload, opts) {
  if (!opts) return;
  if (opts.userTags && opts.userTags.length) {
    payload.user_tags = JSON.stringify(opts.userTags.map(function (u) {
      return { username: u, x: 0.5, y: 0.5 };
    }));
  }
  if (opts.altText) payload.alt_text = String(opts.altText);
}

function igCreateImageContainer_(creds, imageUrl, caption, isCarouselItem, opts) {
  const payload = { image_url: imageUrl, access_token: creds.token };
  if (caption) payload.caption = caption;
  if (isCarouselItem) payload.is_carousel_item = 'true';
  igAddPhotoOpts_(payload, opts);                 // отметки/alt — и на одиночном, и на детях
  if (!isCarouselItem) igAddParentOpts_(payload, opts); // соавторы/гео — только не на детях
  const data = igGraphPost_(GRAPH_BASE + GRAPH_VERSION + '/' + creds.igUserId + '/media', payload);
  if (!data.id) throw new Error('Instagram: контейнер создан без id');
  return data.id;
}

/** Собирает контейнер карусели из готовых дочерних id. Возвращает creation_id. */
function igCreateCarouselContainer_(creds, childIds, caption, opts) {
  const payload = {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    access_token: creds.token
  };
  if (caption) payload.caption = caption;
  igAddParentOpts_(payload, opts);                // соавторы/гео — на родителе карусели
  const data = igGraphPost_(GRAPH_BASE + GRAPH_VERSION + '/' + creds.igUserId + '/media', payload);
  if (!data.id) throw new Error('Instagram: контейнер карусели создан без id');
  return data.id;
}

/** Отправляет первый комментарий к опубликованному медиа (хэштеги). Не критично. */
function igPostComment_(creds, mediaId, message) {
  if (!message) return;
  try {
    igGraphPost_(GRAPH_BASE + GRAPH_VERSION + '/' + mediaId + '/comments', {
      message: message, access_token: creds.token
    });
  } catch (e) {
    Logger.log('Первый комментарий не отправлен: ' + (e && e.message || e));
  }
}

/**
 * Собирает опции IG-публикации из строки листа.
 * Возвращает объект, понятный igAddParentOpts_/igAddPhotoOpts_ и Reels.
 */
function igOptionsFromRow_(rowIndex) {
  const sheet = getSheet_();
  const get = function (key) { return String(sheet.getRange(rowIndex, COLS[key].col).getValue() || '').trim(); };
  const shareRaw = get('ig_share_to_feed').toLowerCase();
  let shareToFeed = null; // null = не слать параметр (дефолт API = в ленте)
  if (/^(false|no|0|нет)$/.test(shareRaw)) shareToFeed = false;
  else if (/^(true|yes|1|да)$/.test(shareRaw)) shareToFeed = true;
  const coverCell = get('cover').split('#')[0].trim();
  const coverId = extractDriveId_(coverCell);
  return {
    collaborators: igParseHandles_(get('ig_collaborators')),
    locationId: get('ig_location_id'),
    userTags: igParseHandles_(get('ig_user_tags')),
    altText: get('ig_alt_text'),
    coverUrl: coverId ? driveDirectUrl_(coverId, 1440) : coverCell,
    shareToFeed: shareToFeed,
    firstComment: ''
  };
}

/**
 * Единый сборщик подписи + опций для планировщика и fallback.
 * При включённом «хэштеги первым комментом» подпись идёт без хэштегов,
 * а хэштеги уходят в options.firstComment.
 */
function buildCaptionAndOptions_(rowIndex) {
  const sheet = getSheet_();
  const mediaCell = String(sheet.getRange(rowIndex, COLS.media.col).getValue() || '');
  const mediaUrls = mediaCell.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
  const txt = String(sheet.getRange(rowIndex, COLS.text.col).getValue() || '').trim();
  const tags = String(sheet.getRange(rowIndex, COLS.hashtags.col).getValue() || '').trim();
  const firstCommentOn = igBool_(sheet.getRange(rowIndex, COLS.ig_first_comment.col).getValue());
  const options = igOptionsFromRow_(rowIndex);
  let caption;
  if (firstCommentOn && tags) {
    caption = txt;
    options.firstComment = tags;
  } else {
    caption = txt + (tags ? '\n\n' + tags : '');
  }
  return { caption: caption, mediaUrls: mediaUrls, options: options };
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
  const creds = igCredsFor_(payload.accountId || payload.account_id);
  const rowIndex = payload.rowIndex;
  let urls = payload.mediaUrls;
  let caption = payload.caption;
  let options = payload.options;

  // Fallback из строки листа для всего, чего не передал фронт
  if (rowIndex && ((!urls || !urls.length) || caption === undefined || caption === null || !options)) {
    const built = buildCaptionAndOptions_(rowIndex);
    if (!urls || !urls.length) urls = built.mediaUrls;
    if (caption === undefined || caption === null) caption = built.caption;
    if (!options) options = built.options;
  }
  caption = String(caption || '');
  options = options || {};

  // Чистим URL (убираем #-метаданные имени/размера)
  const cleaned = (urls || [])
    .map(function (u) { return String(u || '').split('#')[0].trim(); })
    .filter(Boolean);
  if (!cleaned.length) throw new Error('Нет медиа для публикации.');

  // Тип файла определяем по Drive MIME (надёжно для ссылок без расширения).
  const videoCount = cleaned.filter(igIsDriveVideo_).length;
  if (videoCount) {
    if (cleaned.length === 1) return igDoReels_(creds, cleaned[0], caption, rowIndex, options);
    throw new Error('Видео публикуется только по одному (как Reels). Оставьте в «Медиа» один видеофайл или только фото.');
  }

  // Фото/карусель: строим прямые ссылки на полноразмерные картинки
  const imageUrls = cleaned.map(function (u) {
    const id = extractDriveId_(u);
    return id ? driveDirectUrl_(id, 1440) : u;
  });

  let creationId;
  if (imageUrls.length === 1) {
    creationId = igCreateImageContainer_(creds, imageUrls[0], caption, false, options);
  } else {
    // Дети карусели получают только отметки/alt; соавторы/гео — на родителе.
    const childOpts = { userTags: options.userTags, altText: options.altText };
    const children = imageUrls.map(function (url) {
      return igCreateImageContainer_(creds, url, '', true, childOpts);
    });
    creationId = igCreateCarouselContainer_(creds, children, caption, options);
  }

  const igPostId = igPublishContainer_(creds, creationId);
  igPostComment_(creds, igPostId, options.firstComment);
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
 * Видео это или картинка. Сначала спрашиваем у Google Drive реальный MIME-тип
 * (надёжно для ссылок без расширения), при недоступности — фолбэк по расширению.
 */
function igIsDriveVideo_(cleanUrl) {
  const id = extractDriveId_(cleanUrl);
  if (id) {
    try {
      const mime = DriveApp.getFileById(id).getMimeType() || '';
      if (mime.indexOf('video/') === 0) return true;
      if (mime.indexOf('image/') === 0) return false;
    } catch (_) {}
  }
  return /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i.test(cleanUrl);
}

/** Создаёт REELS-контейнер для одного видео. Возвращает creation_id. */
function igCreateReelsContainer_(creds, videoUrl, caption, opts) {
  const payload = { media_type: 'REELS', video_url: videoUrl, access_token: creds.token };
  if (caption) payload.caption = caption;
  if (opts) {
    igAddParentOpts_(payload, opts);              // соавторы/гео
    if (opts.coverUrl) payload.cover_url = String(opts.coverUrl); // своя обложка Reels
    if (opts.shareToFeed === true) payload.share_to_feed = 'true';
    else if (opts.shareToFeed === false) payload.share_to_feed = 'false';
  }
  const data = igGraphPost_(GRAPH_BASE + GRAPH_VERSION + '/' + creds.igUserId + '/media', payload);
  if (!data.id) throw new Error('Instagram: REELS-контейнер создан без id');
  return data.id;
}

/**
 * Ждёт готовности видео-контейнера (видео обрабатывается асинхронно).
 * Поллит status_code до FINISHED. На ERROR/таймаут — читаемая ошибка.
 * Транскодинг reels обычно ~50 c; держим запас до ~150 c (лимит Apps Script — 6 мин).
 */
function igWaitContainerReady_(creds, creationId) {
  for (let attempt = 0; attempt < 30; attempt++) {
    Utilities.sleep(5000);
    const url = GRAPH_BASE + GRAPH_VERSION + '/' + creationId +
      '?fields=status_code,status&access_token=' + encodeURIComponent(creds.token);
    const resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    let data = {};
    try { data = JSON.parse(resp.getContentText()); } catch (_) {}
    const status = data.status_code || '';
    if (status === 'FINISHED') return;
    if (status === 'ERROR') {
      const detail = String(data.status || 'ERROR');
      // 2207082/2207001 — временный сбой серверов Instagram, лечится повтором.
      if (/2207082|2207001/.test(detail)) {
        throw new Error('Временный сбой Instagram (' + detail + '). Это не про ваше видео — просто нажмите «Опубликовать» ещё раз через 1–2 минуты.');
      }
      throw new Error('Instagram не смог обработать видео: ' + detail +
        '. Проверьте формат: MP4/MOV (H.264 + AAC), вертикаль 9:16, 3–90 c.');
    }
  }
  throw new Error('Instagram слишком долго обрабатывает видео (>2.5 мин). Попробуйте ещё раз или опубликуйте вручную.');
}

/**
 * Публикация Reels в Instagram по запросу из пульта.
 * payload: { rowIndex, caption, videoUrl }. Один видеофайл = один Reels.
 * Контейнер REELS → ожидание готовности → media_publish → permalink.
 * После успеха пишет в строку: статус published, ig_post_id, ig_permalink.
 */
function publishInstagramReels_(payload) {
  const creds = igCredsFor_(payload.accountId || payload.account_id);
  const rowIndex = payload.rowIndex;
  let videoUrl = payload.videoUrl;
  let caption = payload.caption;
  let options = payload.options;

  // Fallback из строки листа, если фронт не передал
  if (rowIndex && (!videoUrl || caption === undefined || caption === null || !options)) {
    const built = buildCaptionAndOptions_(rowIndex);
    const VIDEO_RE = /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i;
    if (!videoUrl) {
      videoUrl = built.mediaUrls.filter(function (u) { return VIDEO_RE.test(u); })[0] || '';
    }
    if (caption === undefined || caption === null) caption = built.caption;
    if (!options) options = built.options;
  }
  caption = String(caption || '');
  options = options || {};
  const clean = String(videoUrl || '').split('#')[0].trim();
  if (!clean) throw new Error('Нет видео для публикации.');
  return igDoReels_(creds, clean, caption, rowIndex, options);
}

/**
 * Action `publishNow` — тонкий алиас немедленной публикации с явным accountId.
 * Маршрутизирует на Reels или фото/карусель по типу медиа из payload и
 * переиспользует существующую логику (publishInstagramReels_ / publishInstagram_),
 * не дублируя её. Креды/enforce аккаунта уже разрешены в handle_.
 *
 * Маршрут на Reels, если: payload.videoUrl задан, ИЛИ payload.mediaType in
 * {'reels','video'}. Иначе — publishInstagram_ (который сам авто-детектит видео
 * по Drive MIME, если медиа берётся из строки).
 */
function publishNow_(payload) {
  const mt = String(payload.mediaType || '').toLowerCase();
  if (payload.videoUrl || mt === 'reels' || mt === 'video') {
    return publishInstagramReels_(payload);
  }
  return publishInstagram_(payload);
}

/**
 * Ядро публикации Reels: чистый URL видео → REELS-контейнер → ожидание
 * готовности → media_publish → permalink → запись результата в строку.
 * Переиспользуется и явным action, и авто-детектом в publishInstagram_.
 */
function igDoReels_(creds, cleanVideoUrl, caption, rowIndex, options) {
  options = options || {};
  // Обложку Reels фронт не считает — берём из строки (колонка «Обложка»).
  if (!options.coverUrl && rowIndex) {
    const coverCell = String(getSheet_().getRange(rowIndex, COLS.cover.col).getValue() || '').split('#')[0].trim();
    const coverId = extractDriveId_(coverCell);
    if (coverId) options.coverUrl = driveDirectUrl_(coverId, 1440);
    else if (coverCell) options.coverUrl = coverCell;
  }
  const id = extractDriveId_(cleanVideoUrl);

  // Файлы >100 МБ Drive не отдаёт напрямую (заглушка антивируса) — Meta качает
  // не видео, а HTML, и валится с 2207082. Ловим заранее с понятным текстом.
  if (id) {
    let sizeMb = 0;
    try { sizeMb = DriveApp.getFileById(id).getSize() / (1024 * 1024); } catch (_) {}
    if (sizeMb > 100) {
      throw new Error('Видео ' + Math.round(sizeMb) + ' МБ — больше 100 МБ Google Drive не отдаёт напрямую, и Instagram не может его скачать. Сожмите видео до <100 МБ (например, экспортом в 1080p) и замените файл.');
    }
  }

  const directUrl = id ? driveVideoUrl_(id) : cleanVideoUrl;

  // Создание + обработка с одним авто-повтором на временный сбой Instagram
  // (2207082/2207001). Повтор безопасен — публикации до этого момента ещё нет.
  let creationId;
  for (let tryNo = 1; tryNo <= 2; tryNo++) {
    try {
      creationId = igCreateReelsContainer_(creds, directUrl, caption, options);
      igWaitContainerReady_(creds, creationId);
      break;
    } catch (e) {
      const msg = String(e && e.message || e);
      if (tryNo < 2 && /Временный сбой|2207082|2207001/.test(msg)) {
        Utilities.sleep(15000);
        continue;
      }
      throw e;
    }
  }

  const igPostId = igPublishContainer_(creds, creationId);
  igPostComment_(creds, igPostId, options.firstComment);
  const permalink = igPermalink_(creds, igPostId);

  if (rowIndex) {
    const sheet = getSheet_();
    sheet.getRange(rowIndex, COLS.status.col).setValue('published');
    sheet.getRange(rowIndex, COLS.ig_post_id.col).setValue(igPostId);
    if (permalink) sheet.getRange(rowIndex, COLS.ig_permalink.col).setValue(permalink);
  }

  return { igPostId: igPostId, permalink: permalink };
}

// ===================================================================
// Планировщик автопубликаций — план plans/2026-05-30-zaplanirovannye-publikacii.md
// ===================================================================

const SCHED_TRIGGER_FN = 'runScheduledPublishing';
const SCHED_MAX_ATTEMPTS = 3;             // попыток на пост, потом status=error
const SCHED_TIME_BUDGET_MS = 4.5 * 60000; // запас до лимита Apps Script (6 мин)

/**
 * Идемпотентно ставит time-driven триггер автопубликации раз в 5 минут.
 * Вызывается из initSheet(). Старые одноимённые триггеры удаляются.
 */
function installScheduleTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === SCHED_TRIGGER_FN) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(SCHED_TRIGGER_FN).timeBased().everyMinutes(5).create();
}

/**
 * Тик планировщика. Находит посты status='scheduled' с наступившим временем
 * и публикует их в Instagram. При сбое — повтор на следующих тиках до
 * SCHED_MAX_ATTEMPTS, затем status='error' + причина в sched_error.
 * LockService защищает от наложения с длинным Reels-поллингом.
 */
function runScheduledPublishing() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return; // предыдущий тик ещё работает — пропускаем
  const startedAt = new Date().getTime();
  try {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < FIRST_DATA_ROW) return;
    const now = new Date().getTime();
    const lastCol = Math.max.apply(null, Object.values(COLS).map(function (c) { return c.col; }));
    const values = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, lastCol).getValues();

    // Собираем «созревшие» запланированные строки, сортируем по времени
    const due = [];
    values.forEach(function (row, i) {
      if (String(row[COLS.status.col - 1] || '') !== 'scheduled') return;
      const dt = row[COLS.datetime.col - 1];
      const when = dt instanceof Date ? dt.getTime() : Date.parse(dt);
      if (!when || when > now) return;
      due.push({ rowIndex: FIRST_DATA_ROW + i, when: when });
    });
    due.sort(function (a, b) { return a.when - b.when; });

    for (let k = 0; k < due.length; k++) {
      if (new Date().getTime() - startedAt > SCHED_TIME_BUDGET_MS) break; // не упираемся в лимит
      publishScheduledRow_(sheet, due[k].rowIndex);
    }
  } finally {
    lock.releaseLock();
  }
}

/** Публикует одну запланированную строку, ведёт счётчик попыток и ошибки. */
function publishScheduledRow_(sheet, rowIndex) {
  try {
    // Снимок, замороженный при планировании (то, что видел Дмитрий в превью):
    // подпись, медиа, опции. Если снимка нет — publishInstagram_ соберёт из строки.
    // account_id строки определяет, в какой аккаунт публиковать (пусто = дефолт).
    const payload = { rowIndex: rowIndex, account_id: accountIdOfRow_(rowIndex) };
    const snapRaw = String(sheet.getRange(rowIndex, COLS.sched_payload.col).getValue() || '');
    if (snapRaw) {
      try {
        const snap = JSON.parse(snapRaw);
        if (snap.caption !== undefined) payload.caption = snap.caption;
        if (snap.mediaUrls) payload.mediaUrls = snap.mediaUrls;
        if (snap.options) payload.options = snap.options;
      } catch (_) {}
    }
    // publishInstagram_ сам определит фото/карусель/Reels по Drive MIME
    // и при успехе проставит published + ссылку.
    publishInstagram_(payload);
    sheet.getRange(rowIndex, COLS.sched_error.col).setValue('');
  } catch (err) {
    const attempts = (Number(sheet.getRange(rowIndex, COLS.sched_attempts.col).getValue()) || 0) + 1;
    sheet.getRange(rowIndex, COLS.sched_attempts.col).setValue(attempts);
    const msg = String(err && err.message || err);
    if (attempts >= SCHED_MAX_ATTEMPTS) {
      sheet.getRange(rowIndex, COLS.status.col).setValue('error');
      sheet.getRange(rowIndex, COLS.sched_error.col).setValue(
        'После ' + attempts + ' попыток: ' + msg);
    } else {
      // оставляем scheduled — повтор на следующем тике
      sheet.getRange(rowIndex, COLS.sched_error.col).setValue(
        'Попытка ' + attempts + '/' + SCHED_MAX_ATTEMPTS + ': ' + msg);
    }
  }
}

/**
 * Action: пометить пост на автопубликацию. Проверяет медиа и будущее время.
 * snapshot (опц.) = { caption, mediaUrls, options } — то, что видел Дмитрий
 * в превью; замораживается в строку, чтобы пост улетел ровно в этом виде.
 */
function schedulePost_(rowIndex, snapshot) {
  if (!rowIndex || rowIndex < FIRST_DATA_ROW) throw new Error('Bad rowIndex: ' + rowIndex);
  const sheet = getSheet_();
  const media = String(sheet.getRange(rowIndex, COLS.media.col).getValue() || '').trim();
  if (!media) throw new Error('Нет медиа — нечего публиковать. Пусть Аня прикрепит картинку или видео.');
  const dt = sheet.getRange(rowIndex, COLS.datetime.col).getValue();
  const when = dt instanceof Date ? dt.getTime() : Date.parse(dt);
  if (!when) throw new Error('Не задана дата/время публикации.');
  sheet.getRange(rowIndex, COLS.status.col).setValue('scheduled');
  sheet.getRange(rowIndex, COLS.sched_attempts.col).setValue(0);
  sheet.getRange(rowIndex, COLS.sched_error.col).setValue('');
  sheet.getRange(rowIndex, COLS.sched_payload.col).setValue(snapshot ? JSON.stringify(snapshot) : '');
  return { rowIndex: rowIndex, when: when, past: when <= new Date().getTime() };
}

/** Action: снять пост с автопубликации (вернуть в «Готов»). */
function unschedulePost_(rowIndex) {
  if (!rowIndex || rowIndex < FIRST_DATA_ROW) throw new Error('Bad rowIndex: ' + rowIndex);
  const sheet = getSheet_();
  sheet.getRange(rowIndex, COLS.status.col).setValue('ready');
  sheet.getRange(rowIndex, COLS.sched_attempts.col).setValue(0);
  sheet.getRange(rowIndex, COLS.sched_error.col).setValue('');
  sheet.getRange(rowIndex, COLS.sched_payload.col).setValue('');
  return { rowIndex: rowIndex };
}

/**
 * ДИАГНОСТИКА ТОКЕНА (запускать из редактора Apps Script: Run → diagToken).
 * Ничего не публикует и ничего не меняет. Спрашивает у Meta /debug_token про
 * текущий IG_ACCESS_TOKEN и печатает в лог:
 *   - тип (PAGE / USER / …),
 *   - валиден ли сейчас,
 *   - expires_at          — когда истекает САМ токен (0 = никогда),
 *   - data_access_expires_at — когда истекает доступ к данным (ограничение
 *     Facebook Login, ~90 дней; может стоять даже у «вечного» page-токена),
 *   - права (scopes).
 *
 * Секрет не покидает Apps Script: app access token собирается из
 * IG_APP_ID|IG_APP_SECRET прямо здесь и используется для самого запроса.
 */
function diagToken() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('IG_ACCESS_TOKEN');
  const appId = props.getProperty('IG_APP_ID');
  const appSecret = props.getProperty('IG_APP_SECRET');
  if (!token) throw new Error('Нет IG_ACCESS_TOKEN в Script Properties.');
  if (!appId || !appSecret) {
    throw new Error('Нет IG_APP_ID или IG_APP_SECRET в Script Properties (нужны, чтобы проверить токен).');
  }

  const appAccessToken = appId + '|' + appSecret;
  const url = GRAPH_BASE + GRAPH_VERSION + '/debug_token'
    + '?input_token=' + encodeURIComponent(token)
    + '&access_token=' + encodeURIComponent(appAccessToken);

  const resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch (_) {}

  if (code !== 200 || !parsed.data) {
    Logger.log('❌ Не удалось проверить токен. HTTP %s. Ответ: %s', code, text);
    return text;
  }

  const d = parsed.data;
  const fmt = function (ts) {
    const n = Number(ts);
    if (!n) return 'Никогда (0)';
    const date = new Date(n * 1000);
    const days = Math.round((n * 1000 - Date.now()) / 86400000);
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
      + ' (через ' + days + ' дн.)';
  };

  Logger.log('=== Диагностика токена IG_ACCESS_TOKEN ===');
  Logger.log('Тип:               %s', d.type || '(нет)');
  Logger.log('Валиден сейчас:    %s', d.is_valid ? 'да ✅' : 'НЕТ ❌');
  Logger.log('App ID:            %s', d.app_id || '(нет)');
  Logger.log('Истекает токен:    %s', fmt(d.expires_at));
  Logger.log('Истекает доступ:   %s', fmt(d.data_access_expires_at));
  Logger.log('Права (scopes):    %s', (d.scopes || []).join(', '));
  if (d.error) Logger.log('⚠️ Ошибка токена: %s', JSON.stringify(d.error));

  const tokenNever = !Number(d.expires_at);
  const dataNever = !Number(d.data_access_expires_at);
  if (d.is_valid && tokenNever && dataNever) {
    Logger.log('➡️ ВЫВОД: токен бессрочный по обоим полям. По сроку публикация не отвалится.');
  } else if (d.is_valid && tokenNever && !dataNever) {
    Logger.log('➡️ ВЫВОД: сам токен не истекает, НО доступ к данным истекает (дата выше). '
      + 'Это ограничение Facebook Login. Для гарантированной вечности — System User токен.');
  } else {
    Logger.log('➡️ ВЫВОД: токен истекает или невалиден. Нужен System User токен (вечный) '
      + 'либо авто-обновление по таймеру.');
  }
  return text;
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

/**
 * Прямая ссылка на ВИДЕО Google Drive — для Meta Reels.
 * Картиночный трюк lh3.googleusercontent.com/d/ID видео не отдаёт.
 * Форма drive.usercontent.google.com + confirm=t отдаёт байты без редиректа
 * и без заглушки антивируса для файлов до ~100 МБ (надёжнее, чем uc?export).
 */
function driveVideoUrl_(fileId) {
  return 'https://drive.usercontent.google.com/download?id=' + fileId + '&export=download&confirm=t';
}

/**
 * ДИАГНОСТИКА Reels (Run → diagReels). НЕ публикует.
 * Находит первый пост, чьё медиа — видео ПО MIME (как продакшн), и печатает
 * всё, что нужно для разбора 2207082: размер, MIME, доступность файла и —
 * главное — что реально отдаёт video_url (настоящие байты mp4 или HTML-заглушку).
 */
function diagReels() {
  const creds = igProps_();
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) throw new Error('В листе нет постов.');
  const vals = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1,
    Math.max(COLS.media.col, COLS.title.col)).getValues();

  // Ищем видео так же, как продакшн — по Drive MIME, а не по имени.
  let videoUrl = '', title = '', fileId = '';
  for (let i = 0; i < vals.length && !videoUrl; i++) {
    const lines = String(vals[i][COLS.media.col - 1] || '').split(/\n+/)
      .map(function (s) { return s.trim().split('#')[0]; }).filter(Boolean);
    for (let j = 0; j < lines.length; j++) {
      if (igIsDriveVideo_(lines[j])) {
        videoUrl = lines[j]; title = String(vals[i][COLS.title.col - 1] || '');
        fileId = extractDriveId_(lines[j]); break;
      }
    }
  }
  if (!videoUrl) { Logger.log('❌ Видео по MIME не найдено ни в одном посте.'); return 'no video'; }
  Logger.log('Пост: «%s»', title);
  Logger.log('URL из таблицы: %s', videoUrl);
  Logger.log('Drive ID: %s', fileId || '(не Drive-ссылка)');

  // 1) Доступ к файлу, размер, MIME
  if (fileId) {
    try {
      const f = DriveApp.getFileById(fileId);
      Logger.log('Имя: %s | MIME: %s | Размер: %s МБ | Доступ: %s',
        f.getName(), f.getMimeType(), (f.getSize() / 1048576).toFixed(1),
        f.getSharingAccess());
    } catch (e) {
      Logger.log('❌ Нет доступа к файлу через DriveApp: %s (значит и размер не читается, и Meta может не скачать)', e && e.message || e);
    }
  }

  // 2) Что реально отдаёт ссылка для Meta
  const directUrl = fileId ? driveVideoUrl_(fileId) : videoUrl;
  Logger.log('video_url для Meta: %s', directUrl);
  const resp = UrlFetchApp.fetch(directUrl, { method: 'get', muteHttpExceptions: true, followRedirects: true });
  const code = resp.getResponseCode();
  const ct = resp.getHeaders()['Content-Type'] || resp.getHeaders()['content-type'] || '(нет)';
  const bytes = resp.getContent();
  Logger.log('HTTP %s | Content-Type: %s | Размер ответа: %s КБ', code, ct, Math.round(bytes.length / 1024));
  const head = resp.getContentText().slice(0, 200).replace(/\s+/g, ' ');
  if (/^\s*</.test(resp.getContentText()) || /text\/html/i.test(ct)) {
    Logger.log('❌ Ссылка отдала HTML, а не видео (заглушка/страница входа). Вот начало: %s', head);
    Logger.log('→ Причина 2207082: Meta качает HTML вместо mp4. Файл слишком большой или папка не публична.');
  } else if (/video\//i.test(ct)) {
    Logger.log('✅ Ссылка отдаёт настоящее видео (%s). Значит дело НЕ в скачивании — смотрим формат/кодек/длину или временный сбой Meta.', ct);
  } else {
    Logger.log('⚠ Неоднозначный Content-Type. Начало ответа: %s', head);
  }
  return 'done';
}

/**
 * ТЕСТ Фазы 0 (запускать из редактора Apps Script: Run → testIgReelsContainer).
 * Берёт первый пост, у которого медиа — видео (.mp4/.mov/…), строит video_url
 * по варианту A, создаёт REELS-контейнер и опрашивает его готовность.
 * НЕ публикует. Главная проверка: скачает ли Meta видео с Google Drive.
 * Имя БЕЗ «_», чтобы функция была видна в списке «Выполнить».
 */
function testIgReelsContainer() {
  const VIDEO_RE = /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i;
  const creds = igProps_();
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) throw new Error('В листе нет постов.');

  const mediaCol = COLS.media.col;
  const titleCol = COLS.title.col;
  const vals = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, Math.max(mediaCol, titleCol)).getValues();

  // Имя файла (с .mp4) лежит в #n=...-метаданных, а не в самом Drive-URL.
  // Парсим имя как фронт и проверяем расширение и в имени, и в URL.
  function nameOf_(raw) {
    const hi = raw.indexOf('#');
    if (hi < 0) return '';
    let name = '';
    raw.slice(hi + 1).split('&').forEach(function (kv) {
      const eq = kv.indexOf('=');
      if (kv.slice(0, eq) === 'n') {
        try { name = decodeURIComponent(kv.slice(eq + 1).replace(/\+/g, ' ')); }
        catch (_) { name = kv.slice(eq + 1); }
      }
    });
    return name;
  }

  let videoUrl = '', title = '', foundRow = 0;
  const seen = [];
  for (let i = 0; i < vals.length && !videoUrl; i++) {
    const lines = String(vals[i][mediaCol - 1] || '').split(/\n+/)
      .map(function (s) { return s.trim(); }).filter(Boolean);
    for (let j = 0; j < lines.length; j++) {
      const raw = lines[j];
      const url = raw.split('#')[0];
      const name = nameOf_(raw);
      seen.push(name || url);
      if (VIDEO_RE.test(name) || VIDEO_RE.test(url)) {
        videoUrl = url; title = String(vals[i][titleCol - 1] || ''); foundRow = FIRST_DATA_ROW + i; break;
      }
    }
  }
  Logger.log('Просмотрено медиа-файлов: %s. Имена: %s', seen.length, seen.join(' | ') || '(пусто)');
  if (!videoUrl) throw new Error('Не нашёл видео в поле «Медиа» ни у одного поста. Список найденных файлов — в логе выше. Прикрепи mp4 в карточку reels (именно в «Медиа», не в «Обложку»).');

  const fileId = extractDriveId_(videoUrl);
  if (!fileId) throw new Error('Не смог извлечь Drive ID из: ' + videoUrl);

  const directUrl = driveVideoUrl_(fileId);
  Logger.log('Пост: «%s» (строка %s)', title, foundRow);
  Logger.log('Drive ID: %s', fileId);
  Logger.log('video_url для Meta: %s', directUrl);

  // 1) Создаём REELS-контейнер
  const createResp = UrlFetchApp.fetch(GRAPH_BASE + GRAPH_VERSION + '/' + creds.igUserId + '/media', {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      media_type: 'REELS',
      video_url: directUrl,
      caption: '[ТЕСТ Reels — не опубликовано] ' + title,
      access_token: creds.token
    }
  });
  Logger.log('Создание контейнера — HTTP %s', createResp.getResponseCode());
  Logger.log('Ответ Meta: %s', createResp.getContentText());
  if (createResp.getResponseCode() !== 200) {
    Logger.log('❌ Контейнер не создан. Скорее всего Meta не смогла скачать видео (Drive отдал HTML-заглушку или нет доступа). Переходим к варианту B (прокси).');
    return createResp.getContentText();
  }
  const container = JSON.parse(createResp.getContentText());
  const creationId = container.id;
  Logger.log('Контейнер создан: %s. Ждём обработки видео…', creationId);

  // 2) Поллинг готовности: video обрабатывается асинхронно
  let status = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    Utilities.sleep(5000);
    const stResp = UrlFetchApp.fetch(
      GRAPH_BASE + GRAPH_VERSION + '/' + creationId +
      '?fields=status_code,status&access_token=' + encodeURIComponent(creds.token),
      { method: 'get', muteHttpExceptions: true }
    );
    const st = JSON.parse(stResp.getContentText());
    status = st.status_code || '';
    Logger.log('Попытка %s: status_code=%s status=%s', attempt + 1, status, st.status || '');
    if (status === 'FINISHED') {
      Logger.log('✅ УСПЕХ: Meta скачала и обработала видео. Вариант A работает — можно строить Фазу 1. Контейнер НЕ опубликован.');
      return stResp.getContentText();
    }
    if (status === 'ERROR') {
      Logger.log('❌ Meta вернула ERROR при обработке. Видео скачалось, но формат/кодек не подошёл (нужен H.264/AAC, MP4/MOV, 9:16). Детали выше.');
      return stResp.getContentText();
    }
  }
  Logger.log('⏱ Таймаут ожидания (status=%s). Видео может быть слишком длинным/тяжёлым, либо Drive отдаёт медленно.', status);
  return 'TIMEOUT status=' + status;
}
