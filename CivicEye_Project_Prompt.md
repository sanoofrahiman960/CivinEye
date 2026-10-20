# Project Prompt: CivicEye – Smart Civic Issue Reporting and Resolution App

Act as a senior full-stack software architect, React Native developer, Python Django backend engineer, UI/UX designer, and database architect.

Build a complete, production-ready **Civic Issue Reporting and Resolution Platform** using:

- **Mobile application:** React Native with Expo and TypeScript
- **Backend:** Python Django and Django REST Framework
- **Database:** PostgreSQL
- **Authentication:** JWT authentication using SimpleJWT
- **Image storage:** Configurable local storage for development and S3-compatible cloud storage for production
- **Maps and geolocation:** React Native Maps and device location services
- **API communication:** Axios
- **State management:** Zustand or Redux Toolkit
- **Notifications:** Firebase Cloud Messaging or Expo Push Notifications
- **API documentation:** drf-spectacular / Swagger
- **Background jobs and scheduling:** Celery with Redis (Celery Beat for periodic jobs), with equivalent Django management commands so every scheduled job can also be run from cron

The application must have two separate login experiences: **Citizen/User** and **Higher Authority/Department Officer**.

The project must be functional end-to-end, not just a UI prototype. Generate the complete project structure, frontend screens, backend apps, database models, API endpoints, validation, permissions, and setup instructions.

## 1. Project overview

Create an application named CivicEye that enables citizens to report public problems by taking photographs, attaching the exact location, selecting an issue category, and submitting the complaint to the relevant authority.

Authorities can review submitted issues, prioritize them, assign them to departments, update their status, upload proof after resolving them, and close the complaint. Citizens must be able to verify the resolution or reopen the issue if the problem has not actually been fixed.

Examples of reportable issues:

- Garbage and waste dumped on roads
- Overflowing public bins
- Waterlogging and drainage problems
- Potholes and damaged roads
- Broken streetlights
- Water leakage
- Damaged public property
- Blocked drains
- Illegal dumping
- Public sanitation problems
- Other civic and social issues

## 2. User roles and authentication

Implement role-based access control.

### A. Citizen login

Citizens can:
- Register using full name, email, phone number, and password.
- Log in and log out securely.
- Reset forgotten passwords.
- Manage their profile.
- Submit new issues.
- Track their own complaints.
- View issue status and status history.
- Receive notifications when an issue changes.
- Confirm whether an issue has been resolved.
- Reopen an issue if it is not fixed.
- Add comments or upload additional evidence.
- View their complaint history.

Citizens must not be able to access authority-only screens, modify authority decisions, or resolve their own complaints.

### B. Higher authority login

Authority accounts should be created or approved by an administrator. Do not allow unrestricted public registration for privileged accounts.

Authorities can:
- Log in through a separate authority login screen.
- View a dashboard containing all complaints they are authorized to manage.
- Filter and search issues.
- View reported images, locations, descriptions, and complaint history.
- Assign complaints to departments or responsible officers.
- Change issue priorities and statuses.
- Add internal notes.
- Upload resolution photographs.
- Mark issues as resolved.
- Reopen issues when follow-up work is required.
- View resolution statistics and response times.
- Export filtered reports to CSV.

Support configurable departments such as Municipal Corporation, Public Works Department, Water Authority, Sanitation Department, and Electrical Department.

### C. System administrator

Implement an optional Django admin/system administrator role for:
- Creating authority accounts.
- Managing departments and service areas.
- Configuring issue categories.
- Managing user access.
- Reviewing audit logs and platform statistics.

## 3. Citizen application screens

Create the following polished, responsive React Native screens.

### Screen 1: Splash screen and onboarding

- CivicEye logo and application name.
- Short description: "Report it. Track it. Improve your community."
- Onboarding illustrations or icons.
- Get Started button.

### Screen 2: Role selection

Display two cards:
- Citizen / Report an Issue
- Higher Authority / Manage Issues

Each card should navigate to the appropriate authentication flow.

### Screen 3: Registration and login

- Citizen registration form.
- Citizen login.
- Authority login.
- Password visibility toggle.
- Input validation and loading indicators.
- Clear error and success messages.
- Secure JWT token handling.

### Screen 4: Citizen home dashboard

Display:
- Welcome message.
- Report New Issue button.
- My Issues.
- Open Issues.
- In Progress Issues.
- Resolved Issues.
- Recently updated complaints.
- Map or nearby reported issues, subject to privacy rules.

Use clean cards, clear icons, and an accessible color palette.

### Screen 5: Report a new issue

This is the core feature.

Implement a multi-step or single-page reporting form with:

1. **Capture photograph**
   - Open the device camera.
   - Select a photograph from the gallery.
   - Preview the selected image.
   - Retake or remove the image.
   - Allow multiple images when appropriate.
   - Compress large images before uploading.

2. **Capture location**
   - Request device location permission.
   - Obtain latitude and longitude using GPS.
   - Display the location on an interactive map.
   - Allow the citizen to move the map marker or manually select a location.
   - Support address lookup or reverse geocoding.
   - Show the selected address before submission.
   - Handle denied permissions and unavailable GPS gracefully.

3. **Issue details**
   - Issue title.
   - Description.
   - Category.
   - Optional subcategory.
   - Location/address.
   - Photograph evidence.
   - Optional additional details.

4. **Priority**
   - Let the citizen optionally indicate perceived urgency.
   - Treat this as a reported urgency signal, not the final official priority.
   - Calculate or assign the official priority using configurable rules and authority review.

5. **Submission**
   - Validate required fields.
   - Upload photographs to the backend.
   - Create a unique complaint/reference ID.
   - Display a success screen with the complaint ID, selected location, and initial status.
   - Prevent duplicate submissions caused by repeated taps or retries.

### Screen 6: My Issues

Display complaints in a list or card layout.

Each card must show:
- Complaint ID.
- Issue title.
- Category.
- Thumbnail.
- Location.
- Date reported.
- Priority badge.
- Current status.
- Last updated timestamp.

Add search, sorting, and filters:
- All
- Submitted
- Acknowledged
- In Progress
- Resolved — Awaiting Citizen Confirmation
- Closed
- Reopened

Tapping a card opens the issue details page.

### Screen 7: Issue details and tracking

Display:
- Original photograph.
- Issue description.
- Location and map.
- Complaint ID.
- Category and priority.
- Assigned department.
- Current status.
- Reported date.
- Status history and timestamps.
- Authority comments that are safe to share.
- Resolution photograph when available.
- Resolution description.
- Citizen feedback controls.

Provide a timeline, for example:

Reported → Acknowledged → In Progress → Resolved — Awaiting Verification → Closed

If the citizen believes the issue has not been fixed, show a **Reopen Issue** button when the complaint is eligible for reopening.

Require the citizen to provide a reason and optionally upload a new photograph.

After reopening:
- Change the status to Reopened.
- Record the reopening reason and timestamp.
- Notify the responsible authority.
- Return the issue to the appropriate queue.
- Preserve all previous resolution evidence and history.

Prevent reopening complaints that are not owned by the logged-in citizen.

### Screen 8: Map view

Display issue markers on a map.

Features:
- Marker colors based on priority.
- Tap a marker to see a summary.
- Filter markers by category, status, and priority.
- Show the approximate location of public complaints.
- Provide navigation to the issue details screen.

Protect citizens' personal details. Public map views should not reveal reporters' phone numbers, email addresses, or other private information.

## 4. Priority and color-coding system

Implement a configurable priority system.

Use the following initial mapping:

- **Red — Critical:** Immediate safety risk, severe flooding, dangerous road damage, or another verified emergency-level civic issue.
- **Orange — High:** Serious public inconvenience or a problem requiring urgent attention.
- **Yellow — Medium:** Significant but non-emergency maintenance issue.
- **Green — Low:** Routine maintenance or lower-urgency issue.
- **Grey — Unclassified:** Awaiting priority assessment.

Do not confuse priority with status. A resolved complaint can still have its original priority recorded.

Implement separate fields for `priority` and `status`.

Authority officers should be able to change priority with a recorded reason. Use configurable rules based on issue category, location, age, and verified risk. If an AI-based prioritization feature is added later, treat its output as a recommendation that authorized personnel can review.

## 5. Higher authority dashboard

Build a professional authority interface in React Native, using a dedicated set of screens and role-based navigation.

### Authority home dashboard

Display KPI cards:
- Total reported issues.
- New issues awaiting review.
- Critical and high-priority issues.
- Issues in progress.
- Overdue issues.
- Resolved issues awaiting citizen verification.
- Reopened issues.
- Closed issues.

Include charts showing:
- Complaints by category.
- Complaints by status.
- Complaints by priority.
- Weekly or monthly complaint trends.
- Average resolution time.

All statistics must come from real backend API data, not hardcoded sample values.

### Authority issue list

Create a paginated list of complaints, with each item showing:
- Complaint ID.
- Title and category.
- Reported image.
- Location.
- Citizen's description.
- Date reported.
- Priority.
- Status.
- Assigned department and officer.
- Days open.

Implement filters for:
- Priority.
- Status.
- Category.
- Department.
- Assigned officer.
- Date range.
- Geographic area.
- Overdue complaints.

Provide sorting by newest, oldest, highest priority, and longest unresolved.

Include a search field for complaint ID, title, and location.

### Authority issue details

When an authority selects an issue, show:
- Full original photograph.
- Description and location.
- Map coordinates.
- Reporter information restricted to authorized personnel.
- Priority and category.
- Assignment details.
- Status history.
- Internal notes.
- Citizen-visible updates.
- Resolution evidence.
- Reopening history.

Provide actions:
- Acknowledge issue.
- Change priority.
- Assign department.
- Assign officer.
- Add internal note.
- Update status.
- Upload resolution photograph.
- Submit resolution description.
- Mark as resolved.
- Reopen or reassign where permitted.

### Resolution workflow

When resolving an issue, the authority must:

1. Open the complaint.
2. Review the original report and location.
3. Update the status to In Progress when work starts.
4. Complete the required work.
5. Capture or select a photograph showing the resolved condition.
6. Add a resolution description.
7. Submit the resolution evidence.
8. Mark the complaint as Resolved — Awaiting Citizen Verification.

Require resolution evidence before allowing an issue to enter the resolved-awaiting-verification state, unless an authorized administrator explicitly enables a documented exception.

The system should preserve both the original report image and the resolution image.

After resolution:
- Notify the citizen.
- Display the resolution evidence to the citizen.
- Allow the citizen to confirm that the issue is fixed.
- Allow the citizen to reopen it with a reason and optional new evidence.

If the citizen confirms resolution, close the complaint.

If the citizen does not respond, apply a configurable verification timeout and policy. Do not silently claim that the citizen verified the issue. Any automatic closure must be identified separately in the audit history.

## 6. Issue lifecycle and business rules

Implement the following lifecycle:

Submitted → Acknowledged → In Progress → Resolved — Awaiting Citizen Verification → Closed

Additional transitions:
- Any eligible active issue → Reopened.
- Reopened → Acknowledged or In Progress.
- Ineligible transitions must be rejected by the backend.

The backend, not the mobile app alone, must enforce valid transitions and role permissions.

Every transition must store:
- Previous status.
- New status.
- Actor.
- Timestamp.
- Reason or comment.
- Relevant evidence, when applicable.

Never delete a complaint's history when its status changes.

Implement duplicate-report detection as an optional feature based on nearby coordinates, category, and a configurable time window. Suggest a possible existing complaint to the citizen without automatically discarding a legitimate new report.

Add a configurable SLA policy for acknowledgment and resolution. Mark overdue issues based on their category, priority, and applicable SLA.

Every closed issue must record a `closure_type`: `CITIZEN_CONFIRMED`, `COMMUNITY_VERIFIED` (see section 15.4), `AUTO_TIMEOUT`, or `ADMIN_CLOSED`. The citizen-facing timeline must show which one applied.

## 7. Django backend architecture

Create a clean, modular Django REST Framework backend.

Suggested project structure:

backend/
- config/
  - settings.py
  - urls.py
  - asgi.py
  - wsgi.py
  - celery.py
- apps/
  - accounts/
  - departments/
  - issues/
  - assignments/
  - notifications/
  - analytics/
  - audit/
  - core/ (feature flags, platform configuration, shared utilities)
  - community/ (supports, witness verification, durability checks)
  - escalations/
  - hotspots/
  - public/ (unauthenticated, rate-limited public endpoints)
- media/
- requirements.txt
- manage.py
- .env.example

Implement appropriate models.

### User model

Fields:
- id
- full_name
- email
- phone_number
- role
- is_active
- date_joined

Use a custom Django user model from the beginning.

### Department model

Fields:
- id
- name
- description
- contact_email
- service_area
- is_active

### Issue model

Fields:
- id
- complaint_id
- reporter
- title
- description
- category
- subcategory
- latitude
- longitude
- address
- priority
- status
- department
- assigned_officer
- created_at
- updated_at
- acknowledged_at
- started_at
- resolved_at
- closed_at
- reopened_at
- due_at
- is_overdue

Use appropriate database types, indexes, constraints, and relationships. Make the complaint ID human-readable and unique.

(Section 15 adds further fields to this model. Include them in the first migration.)

### IssueImage model

Fields:
- id
- issue
- image
- image_type (REPORT, ADDITIONAL_EVIDENCE, RESOLUTION, REOPEN_EVIDENCE)
- uploaded_by
- uploaded_at
- caption

### IssueHistory model

Fields:
- id
- issue
- previous_status
- new_status
- changed_by
- reason
- created_at

### IssueAssignment model

Fields:
- id
- issue
- department
- assigned_officer
- assigned_by
- assigned_at
- notes

Preserve previous assignments rather than overwriting the entire assignment history.

### IssueComment model

Fields:
- id
- issue
- author
- comment
- visibility (CITIZEN_VISIBLE or INTERNAL)
- created_at

Only authorized officers should be able to create or read internal comments.

### Notification model

Fields:
- id
- recipient
- issue
- title
- message
- notification_type
- is_read
- created_at

### AuditLog model

Fields:
- id
- actor
- action
- entity_type
- entity_id
- metadata
- timestamp

Create migrations and explain how to apply them.

## 8. REST API endpoints

Implement, validate, and document endpoints similar to the following.

### Authentication

- POST /api/auth/register/
- POST /api/auth/login/
- POST /api/auth/token/refresh/
- POST /api/auth/logout/
- GET /api/auth/me/
- PATCH /api/auth/profile/
- POST /api/auth/password-reset/

### Citizen issues

- POST /api/issues/
- GET /api/issues/my/
- GET /api/issues/{id}/
- POST /api/issues/{id}/additional-evidence/
- POST /api/issues/{id}/reopen/
- POST /api/issues/{id}/confirm-resolution/
- GET /api/issues/{id}/history/

### Authority issue management

- GET /api/authority/dashboard/
- GET /api/authority/issues/
- GET /api/authority/issues/{id}/
- PATCH /api/authority/issues/{id}/priority/
- POST /api/authority/issues/{id}/acknowledge/
- POST /api/authority/issues/{id}/assign/
- POST /api/authority/issues/{id}/start-work/
- POST /api/authority/issues/{id}/resolve/
- POST /api/authority/issues/{id}/reopen/
- POST /api/authority/issues/{id}/comments/
- GET /api/authority/reports/

### Notifications and configuration

- GET /api/notifications/
- PATCH /api/notifications/{id}/read/
- GET /api/departments/
- GET /api/issue-categories/
- GET /api/configuration/

Implement pagination, filtering, ordering, searching, serializers, viewsets where appropriate, and consistent error responses.

For photograph uploads, support multipart/form-data.

(Section 15 adds further endpoints.)

## 9. Security and permissions

Implement:
- JWT authentication and token refresh.
- Password hashing using Django's password framework.
- Role-based permission classes.
- Object-level access control.
- Citizen ownership checks.
- Department and service-area restrictions for officers.
- Secure image upload validation.
- File size and image type limits.
- API throttling.
- CORS configuration.
- Environment variables for secrets.
- Protection against unauthorized status changes.
- Audit logging for sensitive actions.
- Private handling of reporter contact details.

Do not store passwords or JWT tokens in plain text. Use secure token storage on mobile and short-lived access tokens. Avoid logging access tokens, passwords, or private personal information.

## 10. React Native architecture

Suggested structure:

mobile/
- src/
  - api/
    - client.ts
    - authApi.ts
    - issueApi.ts
    - authorityApi.ts
    - notificationApi.ts
    - communityApi.ts
    - publicApi.ts
  - components/
    - IssueCard.tsx
    - PriorityBadge.tsx
    - StatusBadge.tsx
    - ImageUploader.tsx
    - LocationPicker.tsx
    - LoadingState.tsx
    - EmptyState.tsx
    - BeforeAfterSlider.tsx
    - GhostOverlayCamera.tsx
    - VoiceRecorder.tsx
  - navigation/
    - RootNavigator.tsx
    - AuthNavigator.tsx
    - CitizenNavigator.tsx
    - AuthorityNavigator.tsx
  - screens/
    - auth/
    - citizen/
    - authority/
    - shared/
  - store/
  - hooks/
  - types/
  - utils/
  - constants/
  - theme/
  - i18n/
  - offline/
  - App.tsx

Use TypeScript types for API responses, reusable components, loading states, empty states, and error handling.

Create separate navigators for citizen and authority roles. After login, route users based on the authenticated role returned by the backend. Do not rely on client-side role selection as the security mechanism.

Use environment configuration for the backend API base URL. Explain how to configure the Android emulator, iOS simulator, and physical devices to reach the development server.

## 11. Notifications

Support:
- Complaint submission confirmation.
- Issue acknowledgment.
- Department assignment.
- Work started.
- Resolution evidence uploaded.
- Citizen verification requested.
- Issue reopened.
- Complaint closed.
- SLA breach or overdue alert.
- Escalation to the next authority level (section 15.9).
- Crew on the way / crew on site (section 15.11).
- Witness verification request (section 15.4).
- Fix durability check (section 15.2).
- Nearby hazard alert (section 15.5).

Use in-app notifications as a baseline. Add push notifications using Expo Notifications or Firebase Cloud Messaging.

Design notifications to be idempotent so retries do not create duplicate alerts.

## 12. UI/UX requirements

Use a modern civic-tech design.

Visual guidelines:
- Clean white or neutral backgrounds.
- Professional blue or teal primary color.
- Red, orange, yellow, green, and grey priority indicators.
- Clear status labels alongside colors.
- Accessible contrast and touch targets.
- Responsive layouts.
- Consistent spacing and typography.
- Smooth loading, success, and error states.
- Friendly empty states.
- Confirmation dialogs for critical actions.

Do not rely on color alone to communicate status or priority. Display text labels and accessible icons.

Use native mobile navigation and platform-appropriate components. The interface should be suitable for real citizens and government department staff.

## 13. Testing requirements

Backend tests must cover:
- Registration and authentication.
- Citizen can create and view their own issues.
- Citizen cannot view another citizen's private complaint details.
- Citizen cannot access authority endpoints.
- Authority can view only permitted department issues.
- Priority changes.
- Valid and invalid status transitions.
- Resolution image requirements.
- Citizen confirmation and reopening.
- Internal comment privacy.
- File upload validation.
- SLA and overdue calculation.
- Notification creation.
- Every signature feature in section 15 (see 15.16 for the list).

Frontend testing should cover important reporting, login, issue tracking, resolution, and reopening flows.

Provide API testing examples using Postman or automated tests.

## 14. Deployment requirements

Prepare for:
- Django deployment using Gunicorn and an ASGI server where needed.
- PostgreSQL in production.
- Static and media storage configuration.
- HTTPS.
- Environment variables.
- Database backups.
- Logging and monitoring.
- Mobile production builds using EAS Build.
- Push notification configuration.
- Database migrations during deployment.
- API documentation.
- Celery worker and Celery Beat processes, with Redis.

Provide a production deployment checklist and explain how to configure storage, secrets, allowed hosts, CORS, and permissions safely.

## 15. CivicEye signature features

Most civic reporting apps stop at "report, then the authority marks it fixed". These features address the gaps that remain after that: fake or premature fixes, problems that come back, duplicate reports that go nowhere, residents who can't use a standard app, and no consequence when a deadline is missed.

Build them as part of the core system, with the same models, permissions, audit logging, notifications, and tests as everything else. Each feature has a flag in a `FeatureFlag` model (`key`, `is_enabled`, `config` JSON, `updated_by`, `updated_at`), managed in Django admin and exposed read-only via `GET /api/configuration/`, so a municipality can switch features on one at a time. The mobile app must hide the UI for any disabled feature, and the backend must return `403` with error code `feature_disabled` for its endpoints.

None of these features adds a new status. The lifecycle in section 6 stays as it is. Escalations, crew check-ins, witness responses, and durability checks are separate records shown alongside the status timeline.

### 15.1 Proof-Lock Resolution (before/after match)

**Problem:** a resolution photo can be taken somewhere else or reused from an earlier job.

- RESOLUTION images must be captured with the in-app camera. Gallery selection for resolution evidence is blocked unless an administrator enables a documented exception for that department.
- The capture screen (`GhostOverlayCamera.tsx`) shows the original report photo as a semi-transparent overlay so the officer can match the angle.
- On capture, the app sends the device GPS position, accuracy, and capture time with the image.
- The backend computes the distance from the issue location. If it is more than `proof_lock.max_distance_m` (default 50 m), or the GPS accuracy is worse than `proof_lock.max_accuracy_m` (default 30 m), the image is stored with `proof_check_status = FLAGGED` and the issue cannot move to Resolved — Awaiting Citizen Verification until a supervisor overrides it with a reason. The override is audit-logged.
- The backend computes a perceptual hash (`imagehash` library) for each image. A resolution image that nearly matches any earlier image in the system (configurable Hamming-distance threshold) is FLAGGED as possible reuse.
- New `IssueImage` fields: `capture_latitude`, `capture_longitude`, `capture_accuracy_m`, `captured_at`, `distance_from_issue_m`, `perceptual_hash`, `proof_check_status` (`NOT_APPLICABLE`, `PASSED`, `FLAGGED`, `OVERRIDDEN`), `override_reason`, `overridden_by`.
- The citizen sees a before/after slider (`BeforeAfterSlider.tsx`) with a label such as "Photo taken 12 m from your report".
- In the UI and documentation, call this a verification signal, not proof. GPS can be spoofed, and the citizen's confirmation is still what counts.

### 15.2 Fix Durability Check

**Problem:** many fixes fail within weeks, and nobody measures that.

- A configurable number of days after closure (per category, default 30), the reporter and anyone who supported the issue (15.3) get a "Is it still fixed?" prompt with two answers: **Still fixed** or **Problem returned** (photo required).
- "Problem returned" does not reopen the closed issue. It creates a new linked issue (`parent_issue` FK, `is_recurrence = True`) with the location and category filled in. The new issue starts at Submitted, and the system recommends a priority one level higher than the original.
- Model `DurabilityCheck`: `issue`, `recipient`, `due_at`, `sent_at`, `response` (`STILL_FIXED`, `PROBLEM_RETURNED`, `NO_RESPONSE`), `responded_at`, `follow_up_issue`. Unique on (`issue`, `recipient`).
- A Celery Beat job runs daily and sends the due checks. It is idempotent.
- Analytics report a **durability rate** per department, category, and officer: the share of closed issues with no "problem returned" answer inside the check window.

### 15.3 "Affects Me Too" and impact count

**Problem:** duplicate reports clutter the queue, and the authority can't tell how many people a problem affects.

- Before submission, the duplicate check (section 6) shows nearby open issues in the same category. The citizen can tap **This affects me too** (with an optional note and photo) instead of filing a new report. They can still file a separate report if they think it is a different problem.
- Model `IssueSupport`: `issue`, `user`, `note`, `latitude`, `longitude`, `created_at`. Unique on (`issue`, `user`).
- `Issue.impact_count` is a denormalized count, updated in the same transaction.
- Supporters automatically receive the issue's citizen-visible notifications. They can unsubscribe.
- Rules against gaming: one support per user per issue; the user's location must be within `support.max_distance_m` (default 2 km) when they support; throttled per user per day; the reporter cannot support their own issue.
- The impact count feeds the priority rules as a capped, recommendation-only signal. It can never make an issue Critical on its own.
- Supporters never see the reporter's identity, and the reporter never sees supporters' identities.

### 15.4 Neighbour Witness Verification

**Problem:** when the reporter doesn't respond, the only fallback is a blind auto-close.

- When an issue enters Resolved — Awaiting Citizen Verification, up to `witness.max_requests` (default 5) supporters and opted-in nearby citizens are asked "Can you confirm this is fixed?". Only users who opted in to witness requests in their profile are asked.
- Model `WitnessVerification`: `issue`, `witness`, `response` (`FIXED`, `NOT_FIXED`, `CANT_TELL`), `photo`, `distance_from_issue_m`, `created_at`. Unique on (`issue`, `witness`). A response only counts if the witness is within `witness.max_distance_m` (default 200 m) when they answer.
- **The reporter's decision always wins.** If the reporter confirms or reopens, witness answers are kept but do not change the outcome.
- If the reporter does not respond before the verification timeout:
  - If at least `witness.min_fixed` (default 2) witnesses answered FIXED and none answered NOT_FIXED, close with `closure_type = COMMUNITY_VERIFIED`. The history reason reads "Closed by community verification (N witnesses)".
  - If any witness answered NOT_FIXED, do not auto-close. Notify the assigned officer and the reporter, and recommend reopening.
  - Otherwise, apply the normal timeout policy (`AUTO_TIMEOUT`).
- Witnesses never see the reporter's identity.

### 15.5 Hazard Radar (nearby danger alerts)

**Problem:** a citizen reports an open manhole, but the next person walking past gets no warning.

- An officer can mark an issue as a verified hazard (`Issue.is_verified_hazard`, `hazard_verified_by`, `hazard_verified_at`). Only Critical or High issues in categories marked `can_be_hazard` are eligible.
- `GET /api/hazards/nearby/?lat=&lng=&radius_m=` returns only unresolved verified hazards: complaint ID, category, priority, approximate location rounded to about 10 m, and verified time. No reporter data. Maximum radius 5 km.
- The server must not store or log the coordinates sent with a radar query.
- Mobile: a Hazard Radar map layer and an opt-in alert setting. In the foreground, the app checks every few minutes while the map or radar screen is open. Optional background alerts use `expo-location` geofencing with `expo-task-manager`, limited to the 20 nearest hazards (the iOS region limit), and must be explained clearly in the permission request.
- Alert text names the hazard type and distance, for example "Open manhole reported 80 m ahead". Repeat alerts for the same hazard are suppressed for 24 hours on the device.

### 15.6 Inclusive reporting: Easy Mode, voice, languages, and proxy reports

**Problem:** elderly, low-literacy, and non-English-speaking residents are left out of most reporting apps.

- **Easy Mode** (profile toggle): large buttons, a picture-based category grid, three steps only (photo, location, send), high contrast, and full screen-reader labels.
- **Voice notes:** up to 60 seconds, recorded with `expo-audio` and stored as `IssueAudio` (`issue`, `audio_file`, `duration_s`, `transcript`, `transcript_source` (`NONE`, `AUTO`, `OFFICER_EDITED`), `uploaded_by`, `uploaded_at`). Transcription goes through a configurable provider interface with a no-op default. An auto-transcribed text is labeled "auto-transcribed". Officers can play the original audio. Validate audio type and size like images.
- **Languages:** use `i18next` with `react-i18next`. Ship English plus at least one configurable local language (for example Malayalam, Hindi, or Tamil). Category names come from the backend with translations (`IssueCategoryTranslation`: `category`, `language_code`, `name`, `description`).
- **Report on behalf of someone:** the reporter can enter the name and, optionally, the phone number of the person affected, and must tick a consent checkbox. Stored on `Issue` as `on_behalf_of_name`, `on_behalf_of_phone` (encrypted at rest or restricted to authorized officers), and `on_behalf_consent_at`. If a phone is given, that person gets SMS status updates through a pluggable SMS backend (a console backend in development).
- **Track without the app:** `GET /api/public/track/?complaint_id=&phone_last4=` returns only status, priority, category, and the citizen-visible timeline. It requires the last four digits of the reporter's or beneficiary's phone, is strictly rate-limited per IP, and responds the same way whether the complaint ID or the digits are wrong.

### 15.7 Offline report queue

**Problem:** problems are often in places with poor signal, such as underpasses, drains, or outskirts.

- With no connection, the report (images saved to the app's file system, metadata in local storage) goes into an offline queue with a `client_submission_id` (UUID v4), the original GPS fix, and `client_reported_at`.
- The app retries automatically when `@react-native-community/netinfo` reports a connection. A **Pending reports** screen shows queued items, retry status, and a delete option.
- Backend: `Issue.client_submission_id` with a unique constraint on (`reporter`, `client_submission_id`). Posting the same ID again returns the existing issue with `200` instead of creating a new one. The same mechanism prevents duplicates from repeated taps on the online path.
- `Issue.client_reported_at` is stored separately from `created_at`. Reject values in the future or older than `offline.max_age_hours` (default 72). SLA timers start from `created_at`.

### 15.8 Privacy Shield (automatic blurring and confidential reports)

**Problem:** civic photos often capture bystanders' faces and vehicle number plates, and some reporters face retaliation.

- After upload, a background task produces a `public_image` variant for every image, with faces and licence plates blurred using OpenCV cascade classifiers. Public and community views (map, Spot History, witnesses, supporters) only ever receive `public_image`. The unblurred original is served only to the reporter and to authorized officers.
- On the success screen, the reporter sees the blurred version and can tap **Something is not blurred**. That hides the image from public views until an officer reviews it.
- **Confidential report** option for sensitive issues such as illegal dumping by a business: the reporter's identity is hidden from officers too. Only an administrator can reveal it, must give a reason, and the reveal is written to `AuditLog` and shown on the reporter's issue timeline as "Your identity was viewed by an administrator".
- Explain automatic blurring as best-effort in the UI. Officers must be able to blur or hide an image manually.

### 15.9 Escalation ladder and public scorecard

**Problem:** a missed deadline usually has no consequence, and residents can't see which departments perform well.

- Model `EscalationLevel`: `department`, `level` (1, 2, 3…), `role_title` (for example Officer, Department Head, Commissioner), `contact_users` (M2M), `hours_after_breach`.
- When an issue breaches its SLA, a periodic job moves it up the ladder: it updates `Issue.escalation_level`, creates an `IssueEscalation` record (`issue`, `from_level`, `to_level`, `trigger` (`AUTO_SLA`, `CITIZEN_NUDGE`, `MANUAL`), `reason`, `created_at`), and notifies the contacts at the new level. Escalation never changes `status`.
- The citizen's timeline shows "Escalated to Department Head on <date>".
- **Nudge:** after an SLA breach, the reporter can request an escalation once per level, with a reason. Rate-limited.
- **Public scorecard** (`GET /api/public/scorecard/?department=&area=&period=`) shows per department and service area: median time to acknowledge, median time to resolve, percentage within SLA, reopen rate, durability rate (15.2), and citizen satisfaction. Only aggregates. Any group with fewer than `scorecard.min_issues` (default 10) issues shows "Not enough data" rather than a number. All values are computed from real data.
- On closure, the reporter can give an optional 1–5 satisfaction rating with a comment (`Issue.satisfaction_rating`, `satisfaction_comment`).

### 15.10 Recurring hotspot detection and root-cause tracking

**Problem:** the same drain floods every monsoon and is "fixed" again each time.

- A nightly job groups issues of the same category within `hotspot.radius_m` (default 30 m). Three or more issues within `hotspot.window_days` (default 90) create or update a `Hotspot`.
- Model `Hotspot`: `category`, `center_latitude`, `center_longitude`, `radius_m`, `issues` (M2M), `issue_count`, `first_seen_at`, `last_seen_at`, `status` (`ACTIVE`, `ROOT_CAUSE_PLANNED`, `MONITORING`, `RESOLVED`), `owner_department`, `root_cause_summary`, `permanent_fix_plan`, `target_date`, `updated_by`.
- The authority app gets a **Hotspots** tab. An officer can record the root cause, the permanent fix plan, and a target date. Every change is audit-logged.
- Citizens who view an issue inside an active hotspot see "This location has had N reports of this problem. Permanent fix planned by <date>" (or "under review" if no plan exists yet).

### 15.11 Crew check-in with live status

**Problem:** after "In Progress", the citizen sees nothing until the issue is resolved.

- Officers can post **On the way** and **Crew on site**. "Crew on site" sends GPS, and the backend marks it `verified` only if it is within `proof_lock.max_distance_m` of the issue.
- Model `IssueActivity`: `issue`, `actor`, `activity_type` (`ON_THE_WAY`, `ON_SITE`, `WORK_PAUSED`, `MATERIAL_AWAITED`), `note`, `latitude`, `longitude`, `location_verified`, `created_at`. `IssueHistory` stays reserved for status transitions.
- Citizens and supporters see "Crew arrived on site at 10:42 (location verified)". The crew's exact coordinates are not shown to citizens.
- Only the assigned officer, or an officer in the assigned department, can post activities, and only while the issue is Acknowledged or In Progress.

### 15.12 Life-Safety Fast Lane

**Problem:** a live electric wire or gas leak should not wait in a queue.

- Categories have an `is_life_threatening` flag (for example fallen live wire, gas smell, open manhole, building collapse risk).
- When a citizen selects such a category, the app first shows the emergency numbers for their area (`EmergencyContact`: `service_area`, `name`, `phone_number`, `category` optional, `display_order`), with a call button, and the message "CivicEye is not an emergency service. Call now if anyone is in danger." The citizen can then continue the report.
- On submission, the issue gets a Critical priority recommendation, a high-priority push goes immediately to the department's on-duty officers and escalation level 1, and a short acknowledgment SLA applies (configurable, default 1 hour).
- The app must never block or delay the call option.

### 15.13 Spot History and site QR tags

**Problem:** residents can't see whether a location keeps getting fixed or keeps breaking.

- Tapping any point on the citizen map opens **Spot History**: past public issues within 25 m, with before/after `public_image` pairs, dates, and time taken to resolve. `GET /api/public/spot-history/?lat=&lng=` returns this. No reporter data.
- Authorities can generate a printable QR tag (PNG and PDF, using the `qrcode` library) for an issue or a hotspot: `GET /api/authority/hotspots/{id}/qr/` and `GET /api/authority/issues/{id}/qr/`.
- Scanning the tag opens the deep link `civiceye://spot/{token}`, or a minimal web status page if the app isn't installed. It shows the current status and a **Report a problem here** button with the location pre-filled. Tokens are random and do not expose internal IDs.

### 15.14 Community Fix drives

**Problem:** some low-priority problems, such as litter in a park, could be fixed by residents faster than any department could schedule them.

- For Low or Medium issues in categories marked `community_fixable`, a citizen can propose a cleanup drive: date, time, meeting point, and needs (for example bags, gloves, waste pickup).
- An officer approves or declines it with a reason and can commit department support such as a waste pickup.
- Models `CommunityDrive` (`issue`, `organizer`, `scheduled_for`, `meeting_point`, `needs`, `status` (`PROPOSED`, `APPROVED`, `DECLINED`, `COMPLETED`, `CANCELLED`), `approved_by`, `department_support`, `created_at`) and `DriveParticipant` (`drive`, `user`, `joined_at`; unique on both).
- After the drive, the organizer uploads after-photos. These go through the normal resolution flow: an officer reviews them and moves the issue to Resolved — Awaiting Citizen Verification. Citizens never resolve issues themselves.
- Participants' identities are visible only to the organizer and officers.

### 15.15 New API endpoints

Citizen and community:
- POST /api/issues/{id}/support/ and DELETE /api/issues/{id}/support/
- GET /api/issues/nearby/?lat=&lng=&category= (duplicate check and "affects me too" candidates)
- POST /api/issues/{id}/witness/
- POST /api/issues/{id}/durability-response/
- POST /api/issues/{id}/nudge/
- POST /api/issues/{id}/satisfaction/
- POST /api/issues/{id}/audio/
- POST /api/issues/{id}/report-unblurred-image/
- GET /api/hazards/nearby/
- POST /api/community-drives/ , GET /api/community-drives/?issue= , POST /api/community-drives/{id}/join/
- GET /api/witness-requests/ (the logged-in user's pending requests)

Authority:
- POST /api/authority/issues/{id}/activity/
- POST /api/authority/issues/{id}/verify-hazard/
- POST /api/authority/images/{id}/override-proof-check/ (supervisor only)
- POST /api/authority/images/{id}/hide/
- GET /api/authority/hotspots/ , GET/PATCH /api/authority/hotspots/{id}/
- GET /api/authority/hotspots/{id}/qr/ , GET /api/authority/issues/{id}/qr/
- POST /api/authority/community-drives/{id}/decision/
- GET /api/authority/escalations/

Administrator:
- POST /api/admin/issues/{id}/reveal-identity/ (confidential reports; reason required; audit-logged)

Public (no login, strictly rate-limited, aggregates or public-safe fields only):
- GET /api/public/track/
- GET /api/public/scorecard/
- GET /api/public/spot-history/
- GET /api/public/spot/{token}/

### 15.16 Tests for signature features

Backend tests must also cover:
- A resolution image more than 50 m from the issue is FLAGGED and blocks resolution until a supervisor overrides it; a reused image is detected by perceptual hash.
- Gallery-sourced resolution uploads are rejected when the exception is off.
- Durability checks are sent once, and "problem returned" creates a linked recurrence issue rather than reopening the closed one.
- A user cannot support an issue twice, support their own issue, or support from beyond the allowed distance.
- The reporter's decision overrides witness answers; community closure needs the minimum FIXED count and zero NOT_FIXED; `closure_type` is recorded correctly.
- Hazard endpoints return only verified, unresolved hazards with no reporter data, and the query coordinates are not logged.
- Repeating an offline submission with the same `client_submission_id` returns the existing issue; future or stale `client_reported_at` values are rejected.
- Public and community views receive only `public_image`; confidential reporter identity is hidden from officers; identity reveal requires a reason and writes an audit entry.
- SLA breach escalates one level, the job is idempotent, and escalation does not change status; nudges are rate-limited.
- Scorecard groups below the minimum count return "Not enough data".
- Hotspot detection creates one hotspot for three nearby same-category issues inside the window and none outside it.
- Crew check-ins are rejected from non-assigned officers and for ineligible statuses; location verification works.
- Life-threatening categories trigger the Critical recommendation and the immediate officer notification.
- `/api/public/track/` responds identically for a wrong complaint ID and a wrong phone suffix, and is throttled.
- Every disabled feature flag returns `403 feature_disabled` and hides the related UI.

Frontend tests must cover the offline queue and retry, the "affects me too" choice on the report screen, the ghost-overlay resolution capture, the before/after slider, witness and durability prompts, and Easy Mode reporting.

## 16. Development deliverables

Generate the application in the following order:

Phase 1: Architecture, user journeys, database schema (including every section 15 model and field, so later phases don't need disruptive migrations), status-transition rules, feature flags, and project setup.

Phase 2: Complete Django backend, models, serializers, permissions, endpoints, migrations, Celery setup, and tests for sections 1–14.

Phase 3: React Native authentication, navigation, i18n setup, and citizen reporting screens, including the offline queue (15.7), Easy Mode and voice notes (15.6), and the Life-Safety Fast Lane (15.12).

Phase 4: Citizen issue tracking, map view, image uploads, notifications, and reopening, plus "affects me too" (15.3), Spot History (15.13), Hazard Radar (15.5), and the before/after slider.

Phase 5: Authority dashboard, filtering, assignments, resolution evidence with Proof-Lock (15.1), crew check-ins (15.11), and verification.

Phase 6: Community and accountability features: witness verification (15.4), durability checks (15.2), escalation ladder and public scorecard (15.9), hotspots and QR tags (15.10, 15.13), Privacy Shield (15.8), and Community Fix drives (15.14), with their tests.

Phase 7: API integration, end-to-end testing, deployment instructions (including Celery workers and Beat), and production hardening.

For every phase:
- Show the exact file path.
- Provide complete code, not pseudocode.
- Explain the purpose of each important file.
- Include installation commands.
- Include required environment variables.
- Include migration and run commands.
- Explain how to test the feature.
- Ensure the code matches the previously generated files and APIs.
- Avoid placeholders such as "implement this later" for core functionality.
- Do not invent API response fields that do not exist in the backend.
- Fix errors and dependency incompatibilities before proceeding.

Begin by presenting the architecture, database relationships, status lifecycle, and complete project directory structure. Then implement the backend and mobile app in manageable phases, keeping the entire system consistent.

The final result must be a working, integrated CivicEye application where a citizen reports an issue with a photograph and GPS location, the appropriate authority receives and manages the complaint, the authority uploads location-checked resolution evidence, and the citizen (or, if they don't respond, verified neighbours) can confirm the fix or reopen the complaint, with the system following up later to check that the fix lasted.
