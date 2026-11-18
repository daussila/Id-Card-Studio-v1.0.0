# ID Card Studio v1.0.0 (Windows and Mac)

The same ID Card Studio as the Google version (Card Studio with lists, Design Studio with
templates, camera with the corner guide, Adjust photo, Class filter, printing), but it runs
on your own computer:

- **Your people come from a CSV file.** Adding, editing, and deleting people in the app
  saves straight into that CSV file (new people are placed in alphabetical order).
- **Photos are saved in a folder** inside the app's data folder, one folder per list.
- **No Google account and no Control Center.** Nothing is sent anywhere.

| | **Windows** | **Mac** |
|---|---|---|
| File | `ID-Card-Studio-Setup-1.0.0.exe` (or the portable `.exe`) | `ID-Card-Studio-1.0.0-Mac-arm64.dmg` (M1 and newer) or `…-Mac-x64.dmg` (Intel) |
| Data folder | `Documents\ID Card Studio` (portable: next to the `.exe`) | `Documents/ID Card Studio` |

---

## 1. Put the project on GitHub (once)

1. Sign in at <https://github.com> and create a **new repository**, for example
   `id-card-studio`. *Private* is fine.
2. Click **uploading an existing file** and drag in **everything inside this folder**.
   Click **Commit changes**.
3. GitHub's upload page often skips the hidden `.github` folder. If the **Actions** tab does
   not list **Build Windows app** and **Build Mac app**, create each workflow file with
   **Add file → Create new file**, type its name (for example
   `.github/workflows/build-mac.yml`), paste in the file's text, and commit.

## 2. Get the Windows app

1. **Actions** tab → **Build Windows app** → **Run workflow** → **Run workflow**.
2. Wait about 5–10 minutes for the green check mark, open the run, and download
   **ID-Card-Studio-Windows** at the bottom. It contains:
   - `ID-Card-Studio-Setup-1.0.0.exe`: the installer
   - `ID-Card-Studio-Portable-1.0.0.exe`: runs without installing (for a USB stick, for example)
3. Double-click the installer. Because the app is not signed with a paid certificate,
   Windows may show **"Windows protected your PC"**. Click **More info → Run anyway**. This
   happens only once.

## 3. Get the Mac app

1. **Actions** tab → **Build Mac app** → **Run workflow** → **Run workflow**.
2. Wait about 5–10 minutes, open the run, and download **ID-Card-Studio-Mac**. It contains
   two files. Pick the one for your Mac ( → **About This Mac**):
   - **Chip: Apple M1, M2, M3, M4…** → `ID-Card-Studio-1.0.0-Mac-arm64.dmg`
   - **Processor: Intel** → `ID-Card-Studio-1.0.0-Mac-x64.dmg`
3. Open the `.dmg` and drag **ID Card Studio** onto **Applications**.
4. **First opening.** The app is not signed with a paid Apple Developer certificate, so the
   Mac blocks it the first time:
   - Double-click the app, and click **Done** (or **OK**) on the warning.
   - Open **System Settings → Privacy & Security**, scroll down, and click
     **Open Anyway** next to "ID Card Studio was blocked". Confirm with your password.
   - If the Mac says the app **"is damaged and can't be opened"**, open **Terminal** and run
     this once, then open the app again:
     ```
     xattr -cr "/Applications/ID Card Studio.app"
     ```
5. Click **OK** when the Mac asks whether ID Card Studio may use the **Documents** folder
   and the **camera**.

## Build it on your own computer (optional)

Install **Node.js LTS** from <https://nodejs.org>, open a terminal in this folder, and run
`npm install`, then `npm run dist` (on Windows) or `npm run dist:mac` (on a Mac). The files
are in the new `dist` folder.

---

## 4. Using it

**The ID Card Studio folder** is created when the app first starts (in Documents). Open it
and its folders from the **File** menu. The examples below use Windows `\`; on a Mac it is `/`.

```
ID Card Studio\
  Data\          ← your CSV files (a "Sample Students.csv" is added the first time)
  Designs\       ← designs saved in Design Studio
  Photos\
    Students\    ← one folder per list; photos are saved here automatically
      _Deleted\  ← photos of deleted people and replaced photos are moved here, never erased
  settings.json  ← your lists, their settings and the school name (back this up with the rest)
```

**School name:** click **＋ Add school name** at the top right (next to the logo), type the
name, and press Enter. Click the name to change it later.

**Setting up a list**

1. **Card Studio → ＋ New List**, then give it a name and color, and choose how photo files
   are matched: by ID number (`102345.jpg`) or full name (`Alex Smith.jpg`).
2. **Choose CSV file…** Pick your CSV file. Design Mapping opens. A CSV file from another
   place (Desktop, Downloads, a USB stick…) is **copied into the Data folder**, and the app
   saves changes in that copy from then on. The original file is not changed.
3. Pick a design (from the Designs folder, or **Other file…**), match each field to a
   column, and click **Save Design Mapping**.

**About the CSV file**

- From Excel: **File → Save As → CSV UTF-8 (Comma delimited)**. Older "CSV" and semicolon
  files work too.
- The first time you save Design Mapping, two columns are added at the end:
  **ID Card Studio Key** (a permanent code that keeps each photo with the right person) and
  **ID Card Studio Photo** (the photo's file name). Keep both columns, and keep them with
  their rows if you sort in Excel.
- **Close the CSV in Excel before adding, editing, or deleting people in the app.** Excel
  locks the file; the app tells you if it is still open.
- Changes you make in Excel (then save and close) appear when you come back to the app.
  Edit the copy in the **Data** folder (**File → Open Data Folder**).

**Photos you already have**

Copy them into the list's folder (`Photos\Students`, for example), named by ID number or full
name, depending on the list's setting. The app links them automatically.

---

## 5. Moving from the Google version

1. **People:** open the Google Sheet → **File → Download → Comma-separated values (.csv)**.
   Put the file in `ID Card Studio\Data` (or just choose it in the app; it is copied there).
2. **Photos:** in Google Drive, right-click the photo folder → **Download**. Unzip it and copy
   the photos into `ID Card Studio\Photos\<list name>` (create the list first).
3. **Designs:** copy your saved design `.json` files into `ID Card Studio\Designs`.
4. In Card Studio, create the list, choose the CSV file, and match the columns once.

The old hidden columns from Google Sheets (`_ID_CARD_RECORD_UUID`, `_ID_CARD_PHOTO_FILE_ID`)
can be deleted from the CSV; photos are re-linked by ID number or name.

---

## 6. Backup

Copy the whole **ID Card Studio** data folder (and your CSV files, if they are kept
elsewhere) to a USB stick or a network drive from time to time.

## For IT staff

- `app/`: the pages (the same pages as the Google version, adapted for local files), the
  local server `local-server.js` that replaces `Server.gs`, the CSV reader `csv.js`, and
  `platform.js` (file access).
- `electron/`: the desktop app for Windows and Mac. Files are reached only inside the data
  folder or through CSV files the person chose in the Open dialog. Pages run sandboxed on
  the secure `app://` origin.
- `scripts/copy-vendor.js` copies the barcode and QR code libraries into `app/vendor` so the
  app works offline. `scripts/mac-adhoc-sign.js` gives the Mac app a free ad-hoc signature,
  which Apple silicon Macs need.
- `.github/workflows/`: `build-windows.yml` and `build-mac.yml`. Pushing a tag such as
  `v1.0.1` also creates a Release with the files attached.
- New version: change `version` in `package.json`, then run the workflows again.
