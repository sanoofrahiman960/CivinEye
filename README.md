# CivicEye — civic issue reporting and resolution

Citizens photograph a civic problem, CivicEye attaches the GPS location, and the complaint is routed to the right department. Officers acknowledge it, work on it and upload **location-checked** resolution photos. The citizen then confirms the fix or reopens the complaint. Thirty days later CivicEye asks whether the fix has lasted.

| Part | Stack |
|---|---|
| `backend/` | Python 3.10+, Django 5.2, Django REST Framework, SimpleJWT, drf-spectacular, Celery (optional) |
| `mobile/` | Expo SDK 58, React Native 0.88, TypeScript, React Navigation, Zustand, Axios, react-native-maps (citizen and authority app) |
| `web/` | React 19, TypeScript, Vite, React Router, Leaflet, Recharts (authority web dashboard; see [web/README.md](web/README.md)) |
| Database | Local SQLite file in development; PostgreSQL in production (`DATABASE_URL`) |

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the architecture, data model, lifecycle and security.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) covers production deployment and includes a checklist.
- [docs/CivicEye.postman_collection.json](docs/CivicEye.postman_collection.json) runs through the API end to end.

---

## 1. Run the backend

```powershell
cd backend
py -3.10 -m venv .venv          # or: python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env          # macOS/Linux: cp .env.example .env  (then set SECRET_KEY)
python manage.py migrate
python manage.py setup_reference_data    # departments, categories, SLAs, emergency numbers (no users, no issues)
python manage.py createsuperuser         # your administrator account
python manage.py runserver 0.0.0.0:8001   # Daphne (ASGI); plain `runserver` also defaults to port 8001
```

Or run Daphne directly: `daphne -b 0.0.0.0 -p 8001 config.asgi:application`.

The backend runs on **Daphne** (ASGI). WhiteNoise serves the admin's static files, so no separate web server is needed in development. `manage.py runserver` runs through Daphne and defaults to port 8001 (see `apps/core/management/commands/runserver.py`).

- **API:** http://127.0.0.1:8001/api/
- **Swagger docs:** http://127.0.0.1:8001/api/docs/
- **Django admin:** http://127.0.0.1:8001/admin/ (sign in with your superuser)

Port 8001 is used because 8000 is often taken by other local projects. The mobile app expects 8001 by default.

**Accounts and sign-in (no demo data).**

| Who | How they sign in | How the account is created |
|---|---|---|
| Citizens | **Mobile number + one-time SMS code (OTP).** No password. | Themselves, in the app: the first OTP sign-in creates the account and asks for their name. |
| Officers and supervisors | **Username + password** | By the administrator: Django admin → **Users** → **Add**. Set the username, password, role, department and **service areas**. |
| Administrator | **Username + password** | `python manage.py createsuperuser` |

- Staff can't sign themselves up or reset a forgotten password. The administrator resets it in Django admin (**Users → the user → Reset password**). Staff can change their own password after signing in.
- **SMS in development:** OTP codes are printed in the backend console (`SMS to +91…: 123456 is your CivicEye sign-in code`). For real SMS, set `SMS_BACKEND=apps.accounts.sms.TwilioSMSBackend` and the `TWILIO_*` variables in `backend/.env`, or add a backend for your SMS provider in `apps/accounts/sms.py`.

**Multi-level administration (state → district → taluk → panchayat / municipality).**
- Service areas form a tree, for example *Kerala → Ernakulam (District) → Kanayannur (Taluk) → Kumbalanghi (Grama Panchayat)*, or *Ernakulam → Kochi (Corporation)*. Each issue goes to the **deepest** area containing its GPS point.
- **Admins are scoped by area.** A role Admin with **no** area is the state (global) admin and sees everything. An Admin assigned to Ernakulam is the district admin: they see every issue in the district, across all departments and every taluk, panchayat and municipality below it.
- **Each admin manages their own team** in the web dashboard under **Team**. They can create sub-admins, supervisors and officers for areas inside their jurisdiction, edit them, reset passwords, and deactivate accounts. They can't reach staff outside their area, create a state admin, or change their own role or areas. Every change is audit-logged.
- **Routing goes to the nearest level with staff.** A panchayat issue goes to that panchayat's officers; if there are none yet, to the taluk's, then the district's, then the nearest area admin. Issues are never lost while regions are onboarded.
- **Areas:** the state admin adds them in Django admin (**Service areas**: name, level, parent, boundary) or imports official boundaries in bulk:
  ```powershell
  python manage.py import_areas districts.geojson --level DISTRICT --name-field DISTRICT --parent kerala
  python manage.py import_areas taluks.geojson --level TALUK --name-field TALUK --auto-parent
  python manage.py import_areas panchayats.geojson --level GRAMA_PANCHAYAT --name-field LSGI --auto-parent --dry-run
  ```
  `--auto-parent` places each area inside the deepest existing area that contains it. Import top-down, and use `--dry-run` to preview.
- **Kerala is already imported:** 1 state, 14 districts, 77 taluks, 6 corporations, 85 municipalities and 940 grama panchayats, with boundaries from `backend/data/kerala/*.geojson`. To refresh them, or to add another state:
  ```powershell
  python manage.py fetch_osm_boundaries --region IN-KL --out data/kerala   # add --wards for ward boundaries
  python manage.py import_areas data/kerala/state.geojson --level STATE
  python manage.py import_areas data/kerala/districts.geojson --level DISTRICT --parent kerala
  python manage.py import_areas data/kerala/taluks.geojson --level TALUK --auto-parent
  python manage.py import_areas data/kerala/corporations.geojson --level CORPORATION --auto-parent
  python manage.py import_areas data/kerala/municipalities.geojson --level MUNICIPALITY --auto-parent
  python manage.py import_areas data/kerala/grama_panchayats.geojson --level GRAMA_PANCHAYAT --auto-parent
  ```
  Boundary data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database Licence (ODbL). Show this attribution wherever the boundaries are displayed. Check them against the official LSGD boundaries before relying on them legally.
- **District admins:** `<district>.admin` (for example `ernakulam.admin`) exists for each of the 14 districts. Their initial passwords are in `backend/credentials/district-admins.csv`, which is git-ignored. Give each one to the right person privately, ask them to change it under **Profile**, then delete the file.

**Location-based routing (jurisdiction).**
- Every issue is matched to the **service area** containing its GPS location, for example Kochi.
- Officers and supervisors only see, get notified about, and can be assigned issues inside **their own** service areas. A Kochi officer never receives issues from another city.
- Administrators see everything.
- Issues reported outside every service area go to the administrators.
- Add an area for each city or municipality you serve in Django admin → **Service areas**. Paste the official boundary as GeoJSON polygon coordinates for exact routing.

The reference data is a starting point for Kochi/Ernakulam. Review the departments, categories, SLAs, service areas and emergency numbers in Django admin for your own city.

`python manage.py seed_demo --with-samples` still exists to create fake demo accounts and issues for testing. Never run it on real data.

**Background jobs.**
- `python manage.py run_scheduled_jobs` marks SLA breaches, auto-closes issues after the verification timeout (recorded as `AUTO_TIMEOUT`, never as citizen-confirmed) and sends "Is it still fixed?" checks.
- In development, run it by hand or from Task Scheduler/cron. Celery tasks run inline (`CELERY_TASK_ALWAYS_EAGER=True`), so Redis isn't needed.

**Password reset emails** are printed in the Daphne server console in development.

**Using PostgreSQL:** set `DATABASE_URL=postgres://user:pass@localhost:5432/civiceye` in `backend/.env`, then run `python manage.py migrate`.

### Backend tests

```powershell
cd backend
.venv\Scripts\python manage.py test apps
```

88 tests cover:
- Authentication: wrong portal, token rotation and blacklisting, password reset.
- Ownership and privacy: citizens can't see other citizens' private details, and authority endpoints are blocked for citizens.
- Department and service-area scoping.
- Valid and invalid transitions; priority changes with reasons.
- Proof-Lock: distance check, reused photos, gallery photos, supervisor override.
- Resolution evidence rules; confirmation and reopening; verification timeout.
- SLA and overdue flags.
- Internal comment privacy.
- Upload validation: type, size and EXIF stripping.
- Offline idempotency.
- "Affects me too" and durability checks.
- Notification idempotency and push delivery.
- Dashboard and CSV export.

---

## 2. Run the mobile app

```powershell
cd mobile            # always run Expo commands from inside mobile/
yarn install         # Yarn 4, using a node_modules folder (.yarnrc.yml: nodeLinker: node-modules)
yarn expo start      # or: npx expo start
```

**Testing on a phone through ngrok:** run `ngrok http 8001`, the CivicEye backend's port, not 8000. Put the https URL in `mobile/.env` as `EXPO_PUBLIC_API_URL`, and set `TRUST_X_FORWARDED_PROTO=True` in `backend/.env` so photo links come back as https.

Metro and Expo don't support Yarn Plug'n'Play, so keep `nodeLinker: node-modules` in `mobile/.yarnrc.yml`. If `expo` reports an unexpected SDK version, it is using a cached global CLI instead of the project's own: run `yarn install` inside `mobile/` first.

Then open the app in **Expo Go**: scan the QR code with your phone, or press `a` for an Android emulator or `i` for the iOS simulator on a Mac.

### Reaching the backend from a device

The app works out the API URL itself (see `src/constants/config.ts`):

| Where the app runs | URL used | What you need to do |
|---|---|---|
| Physical phone on the same Wi-Fi | `http://<your PC's LAN IP>:8001`, taken from the Expo dev server host | Start the backend bound to `0.0.0.0` (the Daphne command above does this). Allow port 8001 through Windows Firewall. `ALLOWED_HOSTS=*` is already set in the dev `.env`. |
| Android emulator | `http://10.0.2.2:8001` | Nothing |
| iOS simulator | `http://localhost:8001` | Nothing |
| Anything else or production | `EXPO_PUBLIC_API_URL` from `mobile/.env` | Copy `.env.example` to `.env` and set the URL |

To open the firewall port on Windows (run as administrator): `netsh advfirewall firewall add rule name="CivicEye API" dir=in action=allow protocol=TCP localport=8001`

### Mobile checks

```powershell
yarn typecheck        # tsc --noEmit
yarn test             # 40 Jest tests
npx expo-doctor       # dependency / config health
```

The Jest tests cover:
- Login (validation, portal, errors).
- The auth store: secure token storage and role-based session restore.
- API error handling.
- The offline queue: idempotent retries, and stopping on a network failure.
- Badge accessibility.
- Issue detail: confirming, reopening, the public view and not-found.
- The Proof-Lock resolution flow, including the supervisor override.

### Expo Go limitations

- **Push notifications.** Remote push needs a development or production build (`npx eas-cli build --profile development`) and an `EAS_PROJECT_ID`. In-app notifications, with a badge on the Notifications tab, work everywhere.
- **Maps.** These work in Expo Go without an API key. Store builds need `GOOGLE_MAPS_ANDROID_API_KEY` (see `docs/DEPLOYMENT.md`).

---

## 3. Run the authority web dashboard

```powershell
cd web
npm install
npm run dev          # http://localhost:5181
```

Sign in with your superuser, or with an officer account created in Django admin. Run `npm test` for the tests, or `npm run build` for a production bundle. Details are in [web/README.md](web/README.md).

---

## 4. What's in the app

**Citizen**
- Onboarding and role choice. Registration and login, plus password reset by emailed code.
- A four-step report flow:
  1. **Photos:** camera or gallery, compressed on the device.
  2. **Location:** GPS with a draggable map pin and the address filled in.
  3. **Details:** category, subcategory, title, description and an urgency signal.
  4. **Review.**
- Before submitting, nearby duplicates are suggested so you can say "This affects me too" instead.
- Life-threatening categories show emergency numbers first.
- With no network, reports are queued and sent automatically later.
- **My Issues:** search, status filters and sort.
- **Issue detail:** timeline, before/after slider with the Proof-Lock distance label, confirm or reopen with a reason and photos, extra evidence, comments, and the "Is it still fixed?" follow-up.
- Issue map with priority-coloured markers, text labels and filters. Locations are approximate to protect privacy.
- Notifications and profile.

**Authority**
- **Dashboard:** KPIs (new, critical and high priority, in progress, overdue, awaiting verification, reopened, closed) and charts by category, status and priority, plus the weekly or monthly trend and average and median resolution times. All figures come from real data.
- **Issue list:** search; filters for status, priority, category, department, area, officer, date and overdue; four sort orders; infinite scroll.
- **Issue detail:**
  - The reporter's contact details (authority only) and a map.
  - Status history, priority changes, assignment history, and internal versus citizen-visible comments.
  - Actions driven by the backend's `available_actions`: acknowledge, start work, resolve, change priority (reason required), assign department and officer, comment, reopen, and close (admin only).
- **Proof-Lock resolve:** an in-app camera with a ghost overlay of the original photo and GPS capture. If a photo is flagged, a supervisor can override it.
- **Reports:** per-department performance and CSV export through the share sheet.

**Administrator (Django admin)**
- Authority accounts with departments and service areas.
- Departments, including the documented exceptions for gallery photos and resolving without evidence.
- Categories with SLAs and the life-safety flag; emergency numbers.
- Feature flags and platform policies such as the verification timeout and reopen window.
- A read-only audit log.

---

## 5. Not built yet

From the extended feature list in `CivicEye_Project_Prompt.md` (section 15), this build implements:
- Proof-Lock (15.1)
- Fix durability check (15.2)
- Affects me too (15.3)
- Offline queue (15.7)
- Life-Safety Fast Lane (15.12)

Still to come:
- Neighbour witness verification (15.4)
- Hazard Radar (15.5)
- Voice notes, multi-language support and proxy reporting (15.6)
- Automatic face and number-plate blurring (15.8)
- Escalation ladder and public scorecard (15.9)
- Hotspots and QR tags (15.10, 15.13)
- Crew check-in (15.11)
- Community Fix drives (15.14)
#   C i v i n E y e  
 