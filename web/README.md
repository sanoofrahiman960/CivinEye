# CivicEye authority web dashboard

A desktop web app for **department officers, supervisors and administrators**. It uses the same Django REST API as the mobile app. Citizens keep using the mobile app; a citizen account that signs in here gets a message pointing them to the app.

**Stack:** React 19, TypeScript, Vite 8, React Router 7, Zustand, Axios, Leaflet (OpenStreetMap, no API key), Recharts, lucide-react, Vitest.

## Run it

Start the backend first (see the root README). It must run on port 8001, and `CORS_ALLOWED_ORIGINS` must include `http://localhost:5181`; the development `.env` already does.

```powershell
cd web
npm install
npm run dev
```

Open http://localhost:5181 and sign in with an authority account: your superuser, or an officer or supervisor created in Django admin.

To point the dashboard at another backend, copy `.env.example` to `.env` and set `VITE_API_URL`.

## Pages

| Page | What it does |
|---|---|
| **Dashboard** | KPI tiles (total, awaiting review, critical/high, in progress, overdue, awaiting verification, reopened, closed); each opens the filtered issue list. Weekly or monthly trend; charts by status, priority and category; average and median resolution and acknowledgement times. |
| **Issues** | Paginated table. Search by complaint ID, title or location. Filters for status, priority, category, department, area, assigned officer, date range and overdue. Four sort orders. Filters live in the URL, so a view can be bookmarked or shared. |
| **Issue detail** | Photos with Proof-Lock results, a before/after comparison, a location map, the reporter's contact details (authority only), SLA dates, status history, priority changes, assignment history, and internal versus citizen-visible comments. Actions depend on the issue's state: acknowledge, start work, change priority, assign, resolve, reopen, close (admin only), comment, and supervisor override of flagged photos. |
| **Map** | Every issue in scope (open issues by default) on OpenStreetMap, coloured by priority, with a dark ring for overdue issues. Uses the same filters as the list. |
| **Reports & export** | Performance per department (total, open, resolved, overdue, reopen rate, average resolution time), plus a CSV download of the filtered issues. |
| **Notifications / Profile** | In-app notifications with an unread badge (checked every minute); profile details and password change. |

### Resolving from the web

Resolution photos normally come from the mobile app's **Proof-Lock camera**, which records GPS at capture time.

The dashboard can attach photos and the browser's location, but it sends them as `GALLERY` uploads. The backend rejects those with `camera_required` unless an administrator has enabled the *allow gallery resolution* exception for the department. The dashboard explains this when it happens.

If a supervisor has already accepted (overridden) a flagged photo, the issue can be resolved from the web without uploading a new one.

## Security notes

- The short-lived access token lives only in memory.
- The refresh token lives in `sessionStorage`. It is scoped to the browser tab, cleared when the tab closes, rotated on every refresh, and blacklisted on sign-out.
- Only authority roles can sign in; the backend enforces this through the `authority` portal.
- In production, serve the dashboard over HTTPS with a strict Content-Security-Policy (see `docs/DEPLOYMENT.md`).

## Checks

```powershell
npm run typecheck   # tsc -b
npm test            # vitest
npm run build       # production bundle in dist/
```
