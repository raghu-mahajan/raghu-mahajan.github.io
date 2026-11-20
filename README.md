# Raghu Mahajan — personal website

This repository publishes the personal website at <https://raghu-mahajan.github.io/>.

## Structure

- `/` — personal landing page
- `/projects/` — index of current projects
- `/cv/cv.pdf` — the CV, served by GitHub Pages from the separate repository `raghu-mahajan/cv`
- `/projects/type-iib-instantons/` — document collection for *Instantons in Type IIB String Theory*
- `/problems/` — *Open Problems in String Theory*, a public list anyone can add to (see below)

Each future project can be added as its own directory under `projects/`, and each project page can link to any number of HTML documents.

## Open Problems page (`/problems/`)

A public list of string theory problems, started at the ICTS Worldsheet String Theory and String Field Theory Workshop (November 2026). Anyone can add a problem with their name, email address and, optionally, an INSPIRE or Google Scholar link. Entries are stored in a Google Sheet. A small Google Apps Script ([`problems/backend/Code.gs`](problems/backend/Code.gs)) serves them to the page and saves new ones.

- `problems/index.html` is the page.
- `problems/problems.js` loads, searches and posts problems. LaTeX is rendered with KaTeX.
- `problems/config.js` holds the Apps Script web-app URL.

### One-time setup

1. Sign in to Google with a **personal** account. ICTS's Google Workspace may not allow a script to be opened to "Anyone".
2. Create a new Google Sheet, e.g. *Open Problems in String Theory*.
3. In the sheet, open **Extensions → Apps Script**. Replace the placeholder code with the contents of `problems/backend/Code.gs`, then save.
4. In the toolbar's function menu choose **`setup`** and click **Run**. Google will ask for permission. Because this is your own unpublished script, it shows "Google hasn't verified this app": click **Advanced → Go to … (unsafe) → Allow**. This creates a *Problems* tab with the column headers.
5. Click **Deploy → New deployment**. Choose the type **Web app**, set *Execute as* to **Me** and *Who has access* to **Anyone**, then click **Deploy**. Copy the **Web app URL** (it ends in `/exec`).
6. Paste that URL into `problems/config.js` as the `endpoint`, then commit and push.
7. Open <https://raghu-mahajan.github.io/problems/>, post a test problem, check that it appears in the sheet, then delete that row.

### Moderation

- **Hide an entry:** type anything (e.g. `x`) in its *Hide* column. It disappears from the page and stays in the sheet.
- **Remove an entry:** delete its row.
- **Correct an entry:** edit its cells directly.
- **Get emailed about new entries:** in the sheet, open **Tools → Notification settings → Edit notifications** and choose "Any changes are made".
- Keep the first eight columns as they are. You can add your own columns to the right.

The page has a hidden spam-trap field. The script also ignores accidental double posts and accepts at most 100 posts per hour in total (`MAX_POSTS_PER_HOUR` in `Code.gs`).

### Changing the script later

After editing the code in Apps Script, go to **Deploy → Manage deployments**, click the pencil icon, choose **Version: New version**, then click **Deploy**. The URL stays the same, so `config.js` doesn't need to change.
