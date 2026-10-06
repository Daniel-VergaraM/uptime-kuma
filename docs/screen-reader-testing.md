# Screen reader test script

Automated checks (axe, Playwright roles and names) catch missing labels and low contrast. They can't tell whether a page makes sense when it's read aloud. This script is for a person to run with a real screen reader.

## Setup

- Windows: NVDA (free, nvaccess.org) with Firefox or Chrome.
- macOS: VoiceOver (Cmd+F5) with Safari.
- Start the app with a monitor that has a few checks, so the charts and tables have content.
- Turn the screen off, or close your eyes, and use only the screen reader. Don't look at the screen to decide what's on it.

## Pages and what to check

For each page: note what is announced when the page opens, then move through it with the Tab key and with the screen reader's heading and landmark keys (NVDA: H for headings, D for landmarks).

1. **Dashboard** (`/dashboard`)
   - The page title and the status counts (Up, Down, Maintenance, Unknown) are read in order.
   - Tab reaches the search box, Status and Tags menus, and each monitor. The monitor name and its status are read.
   - Press `/`: the search box takes focus and says it is a search field.
   - Press `?`: a dialog named "Keyboard shortcuts" opens and lists the shortcuts. Escape closes it.

2. **Monitor details and analytics** (`/dashboard/<id>` then the Analytics button)
   - The KPI tiles read as a label followed by a value, such as "Uptime 100.00%".
   - Each period button (24h, 7d, 30d, 90d, 365d) says whether it is pressed.
   - Each chart is announced by its name (for example "Response time"). The chart values are not read, so the KPI tiles and the incident table carry the details. Check that this is enough to follow the page.
   - The incident table has column headers, and each row reads its status, start, end and duration.
   - The export buttons say what they export.

3. **Compare** (`/compare?ids=1,2`)
   - The comparison table reads row by row with its column headers.
   - The period buttons behave as on the analytics page.

4. **Monitor edit form** (`/edit/<id>`)
   - Every field has a label. The SLO target field reads its label and its help text.
   - The accepted status codes list announces that it is a combobox, whether it is open, and the selected values. Each selected value has a Remove control named "Remove". Check that Tab reaches it and Enter removes the value.

5. **Settings > API Keys** (`/settings/api-keys`)
   - In the new key dialog, the Access field says "Access" and lists "Full access" and "Read only".

6. **Settings > Backup** (`/settings/backup`)
   - The passphrase field is announced as a password field.
   - The file input is announced as "Backup file".
   - After choosing an encrypted file, the passphrase field for it appears and is announced.

7. **Bulk edit** (select monitors, then Actions > Bulk edit)
   - The dialog is announced by its title, "Bulk edit (N)".
   - Focus moves into the dialog when it opens, and returns to the list when it closes.

## What to report

For each problem, write down:

- the page and the step (for example "Settings > Backup, after choosing an encrypted file")
- what the screen reader said
- what you expected it to say
- the screen reader and browser versions

Send the list to the maintainers with the commit that the test was run against.

## Known limits

- The tag remove control and the multiselect list come from the vue-multiselect library. A local patch (`patches/vue-multiselect+3.0.0.patch`) makes the remove control focusable and names it "Remove" in English only.
- Chart values are not available to a screen reader. The tables and KPI tiles carry the same numbers.
