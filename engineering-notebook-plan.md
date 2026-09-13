# Engineering Notebook App — Project Brief

## Concept

A personal engineering calculation notebook that runs in the browser. It should feel like writing on graph paper — handwritten fonts, rough sketched lines, lined pages — but be neat, structured, and reliable enough to trust with years of professional work.

---

## Technology Stack

| Concern | Choice | Reason |
|---|---|---|
| Hosting | GitHub Pages | Free, permanent, no maintenance, accessible from any browser |
| Data storage | Google Drive (via API) | Files are yours, auto-backed up, accessible from any device forever |
| File format | JSON | Human-readable, never becomes obsolete, independent of the app |
| Math rendering | KaTeX | Renders proper equations client-side, lightweight |
| Sketch rendering | Rough.js | Gives lines and shapes a natural hand-drawn quality |
| Handwriting font | Caveat + Patrick Hand (Google Fonts) | Neat but personal; free |
| Build approach | Vanilla HTML/CSS/JS | No framework dependency, single file deployable |

---

## Data Architecture

### File format
Each calculation sheet is saved as a `.json` file in the user's Google Drive inside a dedicated folder (e.g. `/EngineeringNotebook/`).

### Folder structure (in Google Drive)
```
/EngineeringNotebook/
  footing-grid-c-d3.json
  beam-deflection-office-b2.json
  column-buckling-level-3.json
  ...
```

### JSON schema per file
```json
{
  "id": "uuid-v4",
  "title": "Footing bending — grid C/D3",
  "created": "2026-09-09T10:00:00Z",
  "modified": "2026-09-09T14:32:00Z",
  "status": "draft",
  "tags": ["footing", "bending", "level-3"],
  "linkedSheets": ["uuid-of-other-sheet"],
  "blocks": [
    {
      "id": "block-uuid",
      "type": "text",
      "content": "..."
    },
    {
      "id": "block-uuid",
      "type": "sketch",
      "operations": [ ... ]
    }
  ]
}
```

### Block types
- `text` — typed calculations and notes, supports KaTeX math syntax
- `sketch` — stores drawing operations as vectors (not flattened images), so they stay editable and sharp forever

### Sketch operations stored as vectors
Store each drawing action as a data object, not a rasterised image. Example:
```json
{ "tool": "line", "x1": 100, "y1": 50, "x2": 300, "y2": 50, "roughness": 1.3 }
{ "tool": "rect", "x": 80, "y": 120, "w": 240, "h": 60 }
{ "tool": "freehand", "points": [[x,y], [x,y], ...] }
{ "tool": "dimension", "x1": 100, "y1": 200, "x2": 340, "y2": 200, "label": "B = 2000 mm" }
{ "tool": "arrow", "x1": 200, "y1": 40, "x2": 200, "y2": 120 }
{ "tool": "circle", "cx": 200, "cy": 150, "r": 40 }
```

---

## Features

### Phase 1 — Core notebook (build first)

**Writing blocks**
- Click to add a text block anywhere on the page
- Typed in handwriting font (Caveat)
- Supports KaTeX math — wrap in `$...$` for inline, `$$...$$` for display
- Blocks can be reordered by dragging

**Sketch blocks**
- Click to add a sketch block
- Drawing tools: line, rectangle, circle, arrow, freehand
- Snap-to-grid toggle (optional grid alignment when drawing)
- Rough.js renders all shapes with hand-drawn quality
- Roughness level: ~1.2–1.5 for engineering sketches (neat but not mechanical)

**Page appearance**
- Graph paper background (CSS linear-gradient, blue grid lines)
- Red margin line on left side
- Dark mode — graph paper adapts (dark background, lighter lines)

**Saving to Google Drive**
- On first use: Google OAuth login, one-time permission to access Drive folder
- Auto-save on every change (debounced ~2 seconds after last edit)
- Files saved as JSON to `/EngineeringNotebook/` in user's Drive
- Each save is a full overwrite of the file (Drive handles versioning)

**File browser**
- Sidebar listing all sheets in the Drive folder
- Shows title, date modified, status badge, tags
- Click to open, click + to create new sheet

**Tagging**
- Add/remove tags per sheet
- Tag input on the sheet header
- Filter sheets in file browser by tag

**Search**
- Search bar in file browser
- Searches across: title, tags, and text block content
- Results highlight matching terms

**Calc sheet status**
- Three states: `Draft`, `Checked`, `Superseded`
- Set via a dropdown on the sheet header
- Displayed as a badge in the file browser
- In formal view, shown as a watermark across the page

**Dark mode**
- Toggle in the app header
- Preference saved to localStorage
- Graph paper lines adjust to remain visible on dark background

---

### Phase 2 — Polish layer (build after Phase 1 is stable)

**Revision history**
- Google Drive natively stores file versions — expose this via the Drive API
- "History" button on each sheet shows a list of previous saves with timestamps
- Click any version to preview it (read-only), with option to restore

**Linked sheets**
- On any text block, type `[[` to trigger a sheet picker
- Select a sheet — inserts a clickable reference link inline
- Clicking it opens that sheet in a new tab or side panel
- Stored in the JSON as a UUID reference, resolved to current title on render

**Dimension tool**
- Dedicated tool in the sketch toolbar
- Click start point, click end point — draws a proper dimension line with arrows and auto-placed label
- Label is editable after placement
- Stores as a `dimension` operation in the sketch block

**Shareable read-only link**
- "Share" button generates a URL:
  `https://yourusername.github.io/engineering-notebook?file=DRIVE_FILE_ID`
- The Drive file must be set to "anyone with link can view" — app prompts this automatically
- Recipient opens the link, sees the sheet in read-only mode (toolbar greyed out)
- No login required for the recipient

**App view vs formal document view**
- Toggle button visible in both owner and read-only views
- App view: graph paper background, margin line, notebook feel
- Formal view: clean white background, title + date metadata header, status watermark, no toolbar
- Toggle is client-side only — does not affect the saved file

**Print to PDF**
- "Print" button switches to formal view then triggers browser print dialog
- Print stylesheet hides all UI chrome (toolbar, sidebar, file browser)
- Page breaks inserted between blocks sensibly
- Output looks like a professional calculation sheet

---

## Google Drive API Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. "Engineering Notebook")
3. Enable the **Google Drive API**
4. Create OAuth 2.0 credentials — type: Web Application
5. Add your GitHub Pages URL as an authorised origin:
   `https://yourusername.github.io`
6. Copy the **Client ID** into the app config
7. The app uses the **Google Identity Services** library for sign-in (no backend needed — fully client-side OAuth)
8. Scopes needed: `https://www.googleapis.com/auth/drive.file` (only accesses files the app creates — not your entire Drive)

---

## Hosting on GitHub Pages

1. Create a free account at [github.com](https://github.com)
2. Create a new repository (e.g. `engineering-notebook`)
3. Upload the app files (initially just `index.html`)
4. Go to repository Settings → Pages → Source: main branch
5. Your app is live at: `https://yourusername.github.io/engineering-notebook`
6. Any future update: edit the file on GitHub → site updates within ~60 seconds

---

## App Structure (suggested file layout)

```
/engineering-notebook/
  index.html          ← entire app (Phase 1 can be single file)
  /src/               ← split into modules as it grows
    drive.js          ← Google Drive API calls
    sketch.js         ← Rough.js drawing logic
    blocks.js         ← block add/edit/reorder logic
    search.js         ← tagging and search
    render.js         ← KaTeX math rendering
  /styles/
    app.css           ← main styles
    print.css         ← print/formal view stylesheet
```

---

## Key Design Decisions Already Made

- **No backend, no database** — the app is purely client-side HTML/JS. Google Drive is the only external service.
- **Data independence** — if the app ever breaks or GitHub Pages disappears, all your JSON files are sitting in your Google Drive untouched. You could open them in any text editor or build a new viewer.
- **Vector sketches, not images** — sketch blocks store drawing operations, not pixels. This means sketches are always editable, always sharp, and file sizes stay small.
- **No localStorage for data** — only preferences (dark mode toggle) go in localStorage. All calc content goes to Drive.
- **JSON over binary** — files will be readable and recoverable in 20 years without the app.

---

## Visual Design Reference

**Fonts**
- Caveat (400, 600 weight) — main handwriting font for calculations
- Patrick Hand — annotations and side notes

**Graph paper**
```css
background-color: #fdfaf4;
background-image:
  linear-gradient(rgba(160,190,220,0.3) 1px, transparent 1px),
  linear-gradient(90deg, rgba(160,190,220,0.3) 1px, transparent 1px);
background-size: 28px 28px;
```

**Margin line**
```css
position: absolute;
left: 2.4rem;
width: 1.5px;
background: rgba(220, 150, 150, 0.5);
```

**Rough.js settings for engineering sketches**
```js
roughness: 1.3       // slightly wobbly, not chaotic
strokeWidth: 2       // structural lines
strokeWidth: 1       // dimension/annotation lines
fillStyle: 'hachure' // for filled shapes (concrete hatching etc.)
```

**Colour palette (annotation colours)**
- Dimensions: `#7733aa` (purple)
- Forces/loads: `#c05050` (red)
- Reactions/results: `#2a6e4a` (green)
- Annotations: `#5c6b7a` (muted blue-grey)

---

## Starting Prompt for Claude Code

When you open Claude Code in VSCode, use this to get started:

> "I am building a personal engineering calculation notebook web app. It is a single-page app with no backend — all data saves to Google Drive via the client-side API. Read the file `engineering-notebook-plan.md` in full before writing any code. Start by building Phase 1: the core notebook with text blocks, sketch blocks using Rough.js, graph paper styling, Google Drive save/load, file browser, tagging, search, sheet status, and dark mode. Build it as a clean modular HTML/JS app. Do not use any frameworks — vanilla JS only."
