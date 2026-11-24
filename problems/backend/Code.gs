/**
 * Backend for the Open Problems page: https://raghu-mahajan.github.io/problems/
 *
 * This script lives inside a Google Sheet (Extensions → Apps Script) and is
 * deployed as a web app. The page reads the list with GET and adds a problem
 * with POST. Setup steps are in the website repository's README.md.
 *
 * Moderation: to hide an entry from the page, type anything (e.g. "x") in its
 * "Hide" column. To remove it completely, delete the row.
 *
 * Anonymous problems are stored with empty Name, Email and Profile cells.
 *
 * Keep the first eight columns in the order below; you may add your own
 * columns to the right of them.
 */

const SHEET_NAME = 'Problems';
const COLUMNS = ['ID', 'Submitted', 'Title', 'Description', 'Name', 'Email', 'Profile', 'Hide'];
const COL = { id: 0, submitted: 1, title: 2, description: 3, name: 4, email: 5, profile: 6, hide: 7 };

const LIMITS = { title: 200, description: 5000, name: 120, email: 200, profile: 300 };

// Upper bound on posts from everyone combined, to stop a spam flood.
const MAX_POSTS_PER_HOUR = 100;

// Reported to the page so it can tell which features this script supports.
// Version 2 added anonymous posting.
const BACKEND_VERSION = 2;

/** Run once from the Apps Script editor to create the sheet and grant access. */
function setup() {
  getSheet_();
}

function doGet() {
  try {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    const problems = [];
    if (lastRow > 1) {
      const rows = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
      rows.forEach(function (row) {
        if (String(row[COL.hide]).trim()) return;
        const problem = rowToProblem_(row);
        if (problem.id && problem.title) problems.push(problem);
      });
    }
    return json_({ ok: true, version: BACKEND_VERSION, problems: problems });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'The list could not be loaded.' });
  }
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'The request could not be read.' });
  }
  if (!data || typeof data !== 'object') {
    return json_({ ok: false, error: 'The request could not be read.' });
  }

  // Honeypot: a field hidden from people that simple bots fill in.
  if (data.website) return json_({ ok: true, ignored: true });

  // An anonymous problem keeps no name or contact details at all.
  const anonymous = data.anonymous === true;
  const entry = {
    title: singleLine_(data.title),
    description: multiLine_(data.description),
    name: anonymous ? '' : singleLine_(data.name),
    email: anonymous ? '' : singleLine_(data.email),
    profile: anonymous ? '' : normaliseUrl_(singleLine_(data.profile)),
  };
  const problem = validate_(entry, data.consent === true, anonymous);
  if (problem) return json_({ ok: false, error: problem });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'The server is busy. Please try again in a moment.' });
  }
  try {
    const sheet = getSheet_();

    const duplicate = findRecentDuplicate_(sheet, entry);
    if (duplicate) return json_({ ok: true, problem: duplicate });

    if (!underRateLimit_()) {
      return json_({ ok: false, error: 'Too many problems have been posted in the last hour. Please try again later.' });
    }

    const id = 'p' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    const now = new Date();
    const row = sheet.getLastRow() + 1;
    const range = sheet.getRange(row, 1, 1, COLUMNS.length);
    // Plain-text format stops Sheets from turning entries into numbers, dates or formulas.
    range.setNumberFormats([['@', 'yyyy-mm-dd hh:mm', '@', '@', '@', '@', '@', '@']]);
    range.setValues([[
      id,
      now,
      escapeFormula_(entry.title),
      escapeFormula_(entry.description),
      escapeFormula_(entry.name),
      escapeFormula_(entry.email),
      escapeFormula_(entry.profile),
      '',
    ]]);
    SpreadsheetApp.flush();

    return json_({
      ok: true,
      problem: {
        id: id,
        timestamp: now.toISOString(),
        title: entry.title,
        description: entry.description,
        name: entry.name,
        email: entry.email,
        profile: entry.profile,
      },
    });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'The problem could not be saved. Please try again.' });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
  }
  return sheet;
}

function rowToProblem_(row) {
  const submitted = row[COL.submitted];
  return {
    id: String(row[COL.id]).trim(),
    timestamp: submitted instanceof Date ? submitted.toISOString() : String(submitted),
    title: unescapeFormula_(row[COL.title]),
    description: unescapeFormula_(row[COL.description]),
    name: unescapeFormula_(row[COL.name]),
    email: unescapeFormula_(row[COL.email]),
    profile: unescapeFormula_(row[COL.profile]),
  };
}

function validate_(entry, consent, anonymous) {
  if (!entry.title) return 'Please give the problem a title.';
  if (!entry.description) return 'Please describe the problem.';
  if (entry.title.length > LIMITS.title) return 'The title is too long (at most ' + LIMITS.title + ' characters).';
  if (entry.description.length > LIMITS.description) return 'The description is too long (at most ' + LIMITS.description + ' characters).';
  if (anonymous) return '';
  if (!entry.name) return 'Please enter your name.';
  if (!entry.email) return 'Please enter your email address.';
  if (entry.name.length > LIMITS.name) return 'The name is too long.';
  if (entry.email.length > LIMITS.email || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(entry.email)) {
    return 'Please enter a valid email address.';
  }
  if (entry.profile && (entry.profile.length > LIMITS.profile || !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(entry.profile))) {
    return 'Please enter a valid link to your INSPIRE or Google Scholar page, or leave it empty.';
  }
  if (!consent) return 'Please confirm that your name and contact details may be shown publicly.';
  return '';
}

/** Returns the stored problem if the same person posted the same title recently (e.g. a double click). */
function findRecentDuplicate_(sheet, entry) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const count = Math.min(20, lastRow - 1);
  const rows = sheet.getRange(lastRow - count + 1, 1, count, COLUMNS.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const problem = rowToProblem_(rows[i]);
    if (problem.title === entry.title && problem.email.toLowerCase() === entry.email.toLowerCase()) {
      return problem;
    }
  }
  return null;
}

function underRateLimit_() {
  const cache = CacheService.getScriptCache();
  const key = 'posts-' + Math.floor(Date.now() / 3600000);
  const count = Number(cache.get(key) || 0);
  if (count >= MAX_POSTS_PER_HOUR) return false;
  cache.put(key, String(count + 1), 7200);
  return true;
}

function singleLine_(value) {
  return clean_(value).replace(/\s+/g, ' ').trim();
}

function multiLine_(value) {
  return clean_(value)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clean_(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function normaliseUrl_(value) {
  if (!value) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value;
}

function escapeFormula_(value) {
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function unescapeFormula_(value) {
  return String(value === null || value === undefined ? '' : value).replace(/^'(?=[=+\-@])/, '');
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
