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
   not list **Build Windows setup**, **Build Windows portable** and **Build Mac app**, create
   each workflow file with
   **Add file → Create new file**, type its name (for example
   `.github/workflows/build-mac.yml`), paste in the file's text, and commit.

## 2. Get the Windows app

There are two Windows versions, each with its own build. Run the one you need (or both):

| Build (in the **Actions** tab) | Download at the bottom of the run | What it is |
|---|---|---|
| **Build Windows setup** | **ID-Card-Studio-Windows-Setup** → `ID-Card-Studio-Setup-1.0.0.exe` | The installer (Start menu, desktop shortcut, uninstall) |
| **Build Windows portable** | **ID-Card-Studio-Windows-Portable** → `ID-Card-Studio-Portable-1.0.0.exe` | Runs without installing, for example from a USB stick; keeps its files next to the `.exe` |

1. **Actions** tab → choose the build → **Run workflow** → **Run workflow**.
2. Wait about 5–10 minutes for the green check mark, open the run, and download the file at
   the bottom.
3. Double-click the installer. Because the app is not signed with a paid certificate,
   Windows may show **"Windows protected your PC"**. Click **More info → Run anyway**. This
   happens only once.

## Installing on school computers (no warnings)

Windows warns about apps from the internet that are not signed by a known publisher. On
school computers you can avoid this for free:

**A. Intune** (Apps → Windows → Add → *Windows app (Win32)*)
1. Wrap the installer with Microsoft's *Win32 Content Prep Tool*:
   `IntuneWinAppUtil.exe -c <folder with the setup> -s ID-Card-Studio-Setup-1.0.0.exe -o <output folder>`
2. Install command: `ID-Card-Studio-Setup-1.0.0.exe /S /allusers`
3. Uninstall command: `"%ProgramFiles%\ID Card Studio\Uninstall ID Card Studio.exe" /S /allusers`
4. Install behavior: **System**. Detection rule: file `%ProgramFiles%\ID Card Studio\ID Card Studio.exe` exists.

Apps installed this way show no SmartScreen warning.

**B. One computer:** right-click the setup file → **Properties** → tick **Unblock** → **OK**,
then run it.

**C. Optional: sign the app with a free school certificate** (for Group Policy, or computers
where people run the setup themselves)
1. On a Windows PC, open **PowerShell** and run (change the name if you like):
   ```
   $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Harmony Public Schools" -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(5)
   $pw = Read-Host "Choose a password" -AsSecureString
   Export-PfxCertificate -Cert $cert -FilePath "$env:USERPROFILE\Desktop\IDCardStudio-signing.pfx" -Password $pw
   Export-Certificate -Cert $cert -FilePath "$env:USERPROFILE\Desktop\IDCardStudio-signing.cer"
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\Desktop\IDCardStudio-signing.pfx")) | Set-Clipboard
   ```
2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**:
   - `WIN_CSC_LINK`: paste (the certificate was copied to the clipboard in step 1)
   - `WIN_CSC_KEY_PASSWORD`: the password you chose
3. Run **Build Windows setup** (and/or **Build Windows portable**) again. The app is now
   signed by your school.
4. Make the school computers trust it: in **Group Policy Management**, edit a policy for the
   computers → *Computer Configuration → Policies → Windows Settings → Security Settings →
   Public Key Policies*, and import `IDCardStudio-signing.cer` into both **Trusted Root
   Certification Authorities** and **Trusted Publishers**.

Keep the `.pfx` file and its password safe (it can sign programs in your school's name), and
delete the copy on the Desktop once the secret is saved. Computers outside the school do not
trust this certificate.

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
`npm install`, then `npm run dist:setup` or `npm run dist:portable` (on Windows; `npm run
dist` makes both) or `npm run dist:mac` (on a Mac). The files
are in the new `dist` folder.

---

## 4. Using it

**The ID Card Studio folder.** The first time the app starts, it asks where to keep your
files: **Documents**, or **Choose a folder…** for any other place: the Desktop, another drive
(`D:\`), a folder you made yourself, or a shared OneDrive / Google Drive / Dropbox / network
folder. Change it any time with **File → Change Data Folder…**.

- An **empty folder** you choose (for example one you just made) is used as it is.
- A **drive** or a folder that already has other things in it (Desktop, Documents…) gets an
  **ID Card Studio** folder inside it, so your files stay together.
- A folder that already has ID Card Studio files (from another computer) is used as it is.

**Renaming or moving the folder** (for example to `ID CARD STUDIO 2026-2027`): close the app,
rename or move the folder in File Explorer / Finder, and open the app. It says the folder was
not found; click **Find the folder…** and choose the renamed folder.

Open the folder and its parts from the **File** menu. The examples below use Windows `\`; on
a Mac it is `/`.

```
ID Card Studio\
  Data\          ← your CSV files (a "Sample Students.csv" is added the first time)
  Designs\       ← designs saved in Design Studio
  Photos\
    Students\    ← one folder per list; photos are saved here automatically
      _Deleted\  ← photos of deleted people and replaced photos are moved here, never erased
  .studio\       ← each list's card design and column matching (used by every computer)
  settings.json  ← your lists, their settings and the school name (back this up with the rest)
```

**Using the same lists on several computers**

1. Put the folder somewhere every computer can reach: a school network drive, or a OneDrive,
   Google Drive or Dropbox folder that is synced on each computer.
2. On the first computer: **File → Change Data Folder…**, choose the shared folder, and click
   **Copy my files there**. The app restarts and uses the shared folder. (Your old folder is
   not changed.)
3. On each other computer: install the app, and when it asks, click **Choose a folder…**
   and pick the same folder (on a computer that already uses the app: **File → Change Data
   Folder…**). Lists, designs, photos and the school name are all there; no setup needed.
4. A person or photo added on one computer appears on the others when you come back to the
   app window, or with **⚙ Settings → Refresh data**. With OneDrive / Google Drive / Dropbox,
   wait until the sync has finished.

Avoid editing **the same list on two computers at the very same moment**; with a cloud folder
two saves within a few seconds can overwrite each other or create a "conflicted copy".
Taking photos on one computer while printing on another is fine.

**Files from other places are copied in automatically:**
- A **CSV file** you choose is copied into `Data`.
- A **design** you open with **Other file…** (in Design Studio or Design Mapping) is copied
  into `Designs`. Opening the same file again does not make a second copy.
- A **photo** you upload for a person (**Upload photo**) or take with the camera is saved in
  that list's `Photos` folder.

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
- `.github/workflows/`: `build-windows-setup.yml`, `build-windows-portable.yml` and
  `build-mac.yml`. Pushing a tag such as
  `v1.0.1` also creates a Release with the files attached.
- New version: change `version` in `package.json`, then run the workflows again.
