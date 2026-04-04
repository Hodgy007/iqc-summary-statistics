# IQC Summary Statistics v3.0

A web-based Internal Quality Control (IQC) dashboard for clinical laboratory instruments. Import QC data from AU5800 and DxI analysers, compute summary statistics (Mean, SD, CV%, n), visualise trends with Levey-Jennings charts, and export audit-ready reports.

## Features

- **CSV Import** — Drag-and-drop semicolon-delimited CSV files exported from instrument software. Multiple files are merged automatically.
- **Summary Statistics** — Mean, SD, CV%, and n computed per analyte, per level, across four instruments (AU/DxI-1 through AU/DxI-4) plus a combined column.
- **CV% Colour Coding** — Green (<5%), amber (5-10%), red (>10%) for at-a-glance QC review.
- **Calculation Drill-down** — Click any stat cell to see the full formula breakdown and all data points used.
- **Levey-Jennings Charts** — Control charts with mean, +/-1SD, +/-2SD, and +/-3SD lines per analyte/level/instrument.
- **CV% Comparison Charts** — Bar charts comparing CV% across instruments.
- **Filtering** — Filter by protocol, date range, and per-analyte instrument exclusions.
- **Report Management** — Save reports to the database and reload them later. Saves all underlying raw data with each report for full reproducibility.
- **Compressed Storage** — Report data is gzip-compressed in the browser before upload (~5-10x smaller), stored as compressed TEXT. A 25MB dataset saves as ~2-3MB.
- **Filtered Saves** — Save either the current filtered view (respects protocol, date, analyte, search, and CV% filters) or the full dataset. Save dialog shows estimated size breakdown.
- **Export** — PDF reports (jsPDF), formatted XLSX (xlsx-js-style), and plain CSV.
- **User Management** — JWT-based authentication with role-based access (admin/user), permission levels (full_access/view_only), and admin approval workflow.
- **Activity Log** — Tracks all user actions (logins, data processing, exports, report save/load/delete, admin actions) with timestamps. Viewable by admins in the Settings panel.
- **Analyte Name Cleanup** — Automatically strips C_ and I_ prefixes from analyte/parameter names.
- **Serverless Warm-up** — Automatically pings API functions on page load and every 5 minutes to prevent cold start delays.
- **Responsive** — Mobile-friendly layout with wrapping header buttons and scrollable tables.
- **In-App Documentation** — View README and compliance docs directly from the app via the Docs button.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript single-page app |
| Backend | Node.js serverless functions (Vercel) |
| Database | PostgreSQL (Neon serverless) |
| Auth | JWT (jose) + bcrypt password hashing |
| Charts | Chart.js 4.4 + chartjs-plugin-annotation |
| PDF Export | jsPDF + jspdf-autotable |
| Excel Export | xlsx-js-style |
| Hosting | Vercel |

## Project Structure

```
iqc-summary-statistics/
├── public/
│   └── index.html          # Full SPA (HTML + CSS + JS)
├── api/
│   ├── auth/
│   │   ├── login.js        # POST /api/auth/login
│   │   ├── register.js     # POST /api/auth/register
│   │   ├── logout.js       # POST /api/auth/logout
│   │   └── me.js           # GET  /api/auth/me
│   ├── admin/
│   │   ├── users.js        # GET/PUT /api/admin/users
│   │   └── activity.js     # GET /api/admin/activity
│   ├── activity.js          # POST /api/activity (client-side logging)
│   ├── reports.js           # GET/POST /api/reports
│   ├── reports/
│   │   └── [id].js         # GET/DELETE /api/reports/:id
│   ├── lib/
│   │   ├── auth.js         # JWT verification middleware
│   │   └── activity.js     # Activity logging helper
│   └── setup.js            # GET/POST /api/setup (init DB tables)
├── tests/
│   ├── frontend-logic.js   # Extracted frontend functions for testing
│   ├── frontend.test.js    # Frontend unit tests (parseCSV, computeStats, etc.)
│   └── api.test.js         # API handler tests with mocked DB/auth
├── package.json
├── vercel.json             # Vercel routing config
├── jest.config.js
└── babel.config.js
```

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user. First user auto-becomes admin. |
| POST | `/api/auth/login` | Authenticate and receive HttpOnly JWT cookie. |
| POST | `/api/auth/logout` | Clear auth cookie. |
| GET | `/api/auth/me` | Get current user info (requires auth). |

### Reports

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/reports` | Any authenticated | List all saved reports. |
| POST | `/api/reports` | full_access | Save a new report. Supports compressed format (gzipped base64) or legacy uncompressed JSON. |
| GET | `/api/reports/:id` | Any authenticated | Fetch a specific report. Compressed data is sent to client for browser-side decompression. |
| PATCH | `/api/reports/:id` | full_access | Append data chunks to an existing report (legacy chunked upload support). |
| DELETE | `/api/reports/:id` | full_access | Delete a report (cascades to report_chunks). |

### Admin

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/admin/users` | admin | List all users. |
| PUT | `/api/admin/users` | admin | Update user status (approved/denied/pending) or permission (view_only/full_access). |
| GET | `/api/admin/activity` | admin | Fetch activity log (supports `limit` and `offset` query params). |

### Activity Logging

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| POST | `/api/activity` | Any authenticated | Log a client-side action (data_process, export_pdf, export_xlsx, export_csv, data_clear). |

### Setup

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/setup` | Initialise database tables (reports, users, activity_log, report_chunks). Adds compressed_data column if missing. Cleans up empty/broken reports. |

## CSV Format

Semicolon-delimited with 13 columns:

```
Protocol;Instrument;Parameter;Level;Date;Value;Target;SD;Status;Message;Comment;User;SampleId
```

Example:
```
TestProto;AU5800 1 L;Glucose;1;01/03/2025 08:00;5.5;5.0;0.3;Accepted;OK;;user1;SAMPLE1
```

## Data Processing Pipeline

1. **Parse CSV** — Split semicolon-delimited rows, extract typed fields
2. **Filter protocols** — Remove patient means, moving averages, eval protocols, and other excluded protocols
3. **Filter status** — Remove manually rejected and rerun-requested rows
4. **Map instruments** — Rename raw instrument names (e.g. `AU5800 1 L` -> `AU/DxI-1`)
5. **Override levels** — Set level to 4 for specific protocols (LAC, hsTnI, HBQC, etc.) and TPP/HBQC sample IDs
6. **Filter instruments** — Keep only known instruments (AU/DxI-1 through AU/DxI-4)
7. **Build results** — Group by parameter+level, compute stats per instrument and combined

### Statistics Calculation

- **Mean** = sum(values) / n
- **SD** = sample standard deviation (n-1 denominator)
- **CV%** = |SD / Mean| * 100

## User Roles & Permissions

| Role | Status | Permission | Capabilities |
|------|--------|------------|-------------|
| admin | approved | full_access | All features + user management panel |
| user | approved | full_access | Import, export, save/load/delete reports |
| user | approved | view_only | Import, export, view reports (no save/delete) |
| user | pending | - | Cannot access dashboard until approved by admin |
| user | denied | - | Access denied |

The first registered user automatically becomes admin with full_access.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_SECRET` | Secret key for signing JWT tokens |

## Getting Started

### Prerequisites

- Node.js 18+
- A Neon PostgreSQL database (or compatible)
- Vercel CLI (for local development)

### Setup

```bash
# Install dependencies
npm install

# Set environment variables
export DATABASE_URL="postgresql://..."
export JWT_SECRET="your-secret-key"

# Initialise database tables
# Visit /api/setup or POST to it after deploying

# Deploy to Vercel
vercel
```

### Running Tests

```bash
npm test
```

## Report Storage Architecture

Reports use a compressed storage approach to handle large datasets within Vercel's 4.5MB body size limit:

1. **Browser-side compression** — Raw data and results are gzip-compressed using the browser's `CompressionStream` API, then base64-encoded
2. **Single INSERT** — Compressed bundle (raw data + results + exclusions + filters) stored in a single `compressed_data` TEXT column
3. **Browser-side decompression** — On load, compressed data is decompressed using `DecompressionStream`
4. **Short key compression** — Raw data rows use abbreviated keys (pr/in/pa/lv/dt/v/st/si) to further reduce size

A typical 25MB dataset compresses to ~2-3MB for storage. The serverless function pre-warming strategy eliminates cold start delays (~45s reduced to ~1.5s).

## Deployment

The app is configured for Vercel with:
- `public/index.html` served as the SPA for all non-API routes
- `api/` directory auto-deployed as serverless functions
- Serverless functions configured with 60-second timeout (`maxDuration: 30` in vercel.json)
- Routing configured in `vercel.json`
