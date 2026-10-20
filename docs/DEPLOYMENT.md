# Deploying CivicEye to production

These instructions target a Linux server (Ubuntu 24.04 or similar) running PostgreSQL, Redis, Nginx, Daphne (ASGI) and Celery, with the mobile app built through EAS. Adapt them to your platform (a managed database, S3-compatible storage, a container platform and so on).

## 1. Backend

```bash
sudo apt install python3.12-venv postgresql redis-server nginx
sudo -u postgres createuser civiceye -P
sudo -u postgres createdb civiceye -O civiceye

git clone <repo> /srv/civiceye && cd /srv/civiceye/backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then edit it, see below
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py setup_reference_data   # then review it in Django admin
python manage.py createsuperuser
```

### Production `.env`

```ini
DEBUG=False
SECRET_KEY=<50+ random characters: python -c "import secrets;print(secrets.token_urlsafe(64))">
ALLOWED_HOSTS=api.civiceye.example.gov
CSRF_TRUSTED_ORIGINS=https://api.civiceye.example.gov
DATABASE_URL=postgres://civiceye:<password>@localhost:5432/civiceye
SECURE_SSL_REDIRECT=True

USE_S3=True
AWS_STORAGE_BUCKET_NAME=civiceye-media
AWS_S3_REGION_NAME=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# AWS_S3_ENDPOINT_URL=https://<minio-or-other-s3-compatible-host>

EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.gov
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=...
EMAIL_HOST_PASSWORD=...
DEFAULT_FROM_EMAIL=CivicEye <no-reply@civiceye.example.gov>

CELERY_TASK_ALWAYS_EAGER=False
CELERY_BROKER_URL=redis://localhost:6379/0

EXPO_PUSH_ENABLED=True
EXPO_ACCESS_TOKEN=<optional: Expo push security token>
```

- **`DEBUG=False`** turns on HSTS, secure cookies, `X-Frame-Options: DENY` and the HTTPS redirect, and restricts Swagger to staff users.
- **Media storage.** With `USE_S3=True`, the bucket stays private (`default_acl=private`) and the API returns signed URLs that expire.
- **CORS.** The mobile app does not need CORS. Only set `CORS_ALLOWED_ORIGINS` if you add a browser client.

### Processes (systemd)

`/etc/systemd/system/civiceye-web.service`
```ini
[Unit]
Description=CivicEye API (Daphne ASGI)
After=network.target postgresql.service

[Service]
User=civiceye
WorkingDirectory=/srv/civiceye/backend
EnvironmentFile=/srv/civiceye/backend/.env
ExecStart=/srv/civiceye/backend/.venv/bin/daphne -b 127.0.0.1 -p 8000 --proxy-headers config.asgi:application
Restart=always

[Install]
WantedBy=multi-user.target
```

`civiceye-worker.service`: `ExecStart=.../celery -A config worker -l info`
`civiceye-beat.service`: `ExecStart=.../celery -A config beat -l info`

Celery Beat runs `run_scheduled_jobs` every 15 minutes. It marks SLA breaches, applies the verification timeout and sends durability checks. Without Celery, use cron instead:

```cron
*/15 * * * * cd /srv/civiceye/backend && .venv/bin/python manage.py run_scheduled_jobs
```

### Nginx (HTTPS)

```nginx
server {
    listen 443 ssl http2;
    server_name api.civiceye.example.gov;
    ssl_certificate     /etc/letsencrypt/live/api.civiceye.example.gov/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.civiceye.example.gov/privkey.pem;

    client_max_body_size 50M;           # up to 5 photos × 8 MB per request
    location /static/ { alias /srv/civiceye/backend/staticfiles/; }
    location /media/  { alias /srv/civiceye/backend/media/; }   # only when USE_S3=False
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
server { listen 80; server_name api.civiceye.example.gov; return 301 https://$host$request_uri; }
```

Get a certificate with `sudo certbot --nginx -d api.civiceye.example.gov`.

### Deploying an update

```bash
git pull && . .venv/bin/activate && pip install -r requirements.txt
python manage.py migrate --noinput
python manage.py collectstatic --noinput
sudo systemctl restart civiceye-web civiceye-worker civiceye-beat
```

### Backups

```cron
# Nightly compressed database dump, keep 30 days
0 2 * * * pg_dump -Fc civiceye > /backups/civiceye-$(date +\%F).dump && find /backups -name 'civiceye-*.dump' -mtime +30 -delete
```

Turn on bucket versioning (or snapshot the media directory), and test a restore with `pg_restore -d civiceye_restore <file>` at least once a quarter.

### Logging and monitoring

- Daphne and Django log to stdout/journald. Ship these logs to your log platform.
- The logs never contain tokens or passwords, and the access log format leaves out query strings.
- Monitor the `/api/configuration/` endpoint (public and cheap) for uptime, along with Celery worker liveness and disk/database usage.
- Optional: add Sentry (`sentry-sdk[django]`) with `send_default_pii=False`.

## 2. Authority web dashboard

```bash
cd web
echo "VITE_API_URL=https://api.civiceye.example.gov" > .env
npm ci && npm run build          # static files in web/dist
```

Serve `web/dist` from any static host, for example Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name dashboard.civiceye.example.gov;
    root /srv/civiceye/web/dist;
    location / { try_files $uri /index.html; }          # client-side routing
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org https://api.civiceye.example.gov https://<your-media-bucket-host>; connect-src https://api.civiceye.example.gov; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}
```

On the backend, allow the dashboard's origin:

```ini
CORS_ALLOWED_ORIGINS=https://dashboard.civiceye.example.gov
```

## 3. Mobile app (EAS)

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest init                # creates the EAS project; set EAS_PROJECT_ID from its output
npx eas-cli@latest build:configure
```

Set these as EAS environment variables (`npx eas-cli env:create`) or in `.env`:

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://api.civiceye.example.gov` |
| `EAS_PROJECT_ID` | Needed for Expo push tokens |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Maps SDK for Android key, restricted to the package name and SHA-1 |
| `GOOGLE_MAPS_IOS_API_KEY` | Optional; iOS uses Apple Maps by default |
| `ANDROID_PACKAGE` / `IOS_BUNDLE_ID` | Store identifiers |

```bash
npx eas-cli@latest build --profile production --platform android
npx eas-cli@latest build --profile production --platform ios
npx eas-cli@latest submit --platform android
```

### Push notifications

- **Android.** Upload the FCM v1 service-account key with `npx eas-cli credentials`.
- **iOS.** EAS creates the APNs key during the first build.
- **Backend.** Set `EXPO_PUSH_ENABLED=True`. Tokens are registered automatically after login, and dead tokens are deactivated.

## 4. Production checklist

- [ ] `DEBUG=False`, a long random `SECRET_KEY`, and `ALLOWED_HOSTS` / `CSRF_TRUSTED_ORIGINS` set to real hostnames.
- [ ] PostgreSQL via `DATABASE_URL`; `python manage.py migrate` run.
- [ ] HTTPS enforced (certificate, `SECURE_SSL_REDIRECT=True`, HSTS active).
- [ ] Private S3 bucket (`USE_S3=True`) with versioning, or a backed-up media directory.
- [ ] An SMS provider configured for citizen OTP sign-in (`SMS_BACKEND`, e.g. Twilio), and a real OTP tested end to end.
- [ ] Every officer and supervisor has a username, a strong password and the correct service areas (jurisdiction).
- [ ] Celery worker and beat running, or the cron job installed; check that `run_scheduled_jobs` logs every 15 minutes.
- [ ] Nightly database backups, with a tested restore.
- [ ] Demo data **not** loaded: run `setup_reference_data` + `createsuperuser` only (`seed_demo` is for testing). Delete demo accounts if they were ever created.
- [ ] A real superuser created. Authority accounts created in Django admin with the correct department and service areas.
- [ ] Categories, SLAs, departments and emergency numbers reviewed for your city.
- [ ] Feature flags and `PlatformConfiguration` (verification timeout, reopen window) reviewed.
- [ ] `EXPO_PUSH_ENABLED=True`, with FCM/APNs credentials in EAS.
- [ ] Mobile app built with `EXPO_PUBLIC_API_URL` pointing at HTTPS, and a restricted Google Maps key.
- [ ] Web dashboard built with `VITE_API_URL` pointing at HTTPS, served with a CSP, and its origin listed in `CORS_ALLOWED_ORIGINS`.
- [ ] `python manage.py check --deploy` passes.
- [ ] Throttle rates (`THROTTLE_*`) tuned to your traffic.
