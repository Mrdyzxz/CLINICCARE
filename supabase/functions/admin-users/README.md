# Deploying `admin-users`

This Edge Function invites Admin and Receptionist Auth users, allows active Admins and Receptionists to view the user list, and updates Auth account access. It verifies the caller's JWT and active profile before every action. Only active Admins can create or update accounts; Receptionists have list-only access. Doctor and patient roles are not accepted for new staff accounts, and legacy accounts are read-only. The function reads the profiles and Auth user list with its server-side secret client only after verifying the caller's active staff profile, and returns a limited set of user fields. Do not broaden profile RLS for this list. Every profile mutation goes through the `admin_update_staff_profile` PostgreSQL function using the caller's JWT. The service-role/secret key must remain server-side.

## Runtime configuration

| Environment variable | Purpose | Configuration |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase API URL | Injected by Supabase for hosted Edge Functions. |
| `SUPABASE_PUBLISHABLE_KEYS` | Publishable API key map; the `default` entry authenticates the RLS-scoped client. | Injected by Supabase. The function supports legacy `SUPABASE_ANON_KEY` as a fallback. |
| `SUPABASE_SECRET_KEYS` | Secret API key map; the `default` entry is used only by server-side Auth Admin operations and the authorized user-list query. | Injected by Supabase. The function supports legacy `SUPABASE_SERVICE_ROLE_KEY` as a fallback. Never put this value in frontend files or commit it. |
| `APP_SITE_URL` | Full invitation redirect URL, including `/account-setup.html`. | Set as a Supabase Edge Function secret for this deployment. |

Supabase provides the `SUPABASE_*` platform variables. Do not copy secret keys into source code, frontend configuration, or this file. For local `supabase functions serve`, provide corresponding keys through the ignored `supabase/functions/.env` file.

## Required rollout order

Pause invitations and User Management changes during this rollout. The migration deliberately blocks direct profile writes, so the existing Edge Function cannot safely manage profiles after the migration until the updated function is deployed.

1. Disable public Auth signups in Supabase Authentication settings. Confirm at least one active Admin exists and review/back up the current database policies.
2. Apply `supabase/manual/staff_access.sql` in the Supabase SQL Editor. The migration checks for an active Admin, disables legacy Doctor/Patient profiles without deleting records, installs the protected RPC, and updates RLS. It does not create Auth users.
3. Verify `public.admin_update_staff_profile(uuid, text, text, text, boolean)` exists, is owned by `postgres`, and is executable by `authenticated`. Confirm the Auth trigger still creates the initial profile row; it must run with a trusted owner because direct authenticated profile inserts are denied.
4. Deploy the updated `admin-users` Edge Function using the commands below. Resume User Management only after verifying the deployment.
5. Test that an Admin can list, invite, and update users; an active Receptionist can list users but receives a `403` for create/update; and inactive or non-staff accounts are rejected. Also verify Receptionist Department CRUD after applying the migration and confirm Auth/profile invite records share one UUID.

Do not deploy the updated Edge Function before applying the migration: its protected RPC does not exist until the migration is applied. Do not leave invitations enabled between migration and deployment; the previous function version uses direct profile updates, which the migration blocks.

Replace `YOUR-HOST` with the HTTPS origin serving this application. Use the exact same URL in the Supabase Auth redirect allowlist.

```powershell
supabase login
supabase link --project-ref wowlsjzbsyrzfracxuor
supabase secrets set APP_SITE_URL="https://YOUR-HOST/account-setup.html" --project-ref wowlsjzbsyrzfracxuor
supabase functions deploy admin-users --project-ref wowlsjzbsyrzfracxuor
```

In Supabase Dashboard → Authentication → URL Configuration, add the exact `account-setup.html` URL to the allowed redirect URLs. Configure the Auth email provider and delivery settings before sending invitations.

## Authorization and RLS prerequisites

- Keep `verify_jwt = true` for `admin-users` in `supabase/config.toml`.
- The function validates the bearer JWT with Supabase Auth and requires an active `admin` or `receptionist` profile for every action. Only an active Admin may create or update accounts.
- The caller-scoped client verifies the caller and performs protected mutations under RLS. The server-side secret client reads the user-list profiles and Auth users only after the active-staff check; no broad profile SELECT policy is required. The caller must retain permission to select `doctors.id` for Admin role-change checks. Direct authenticated `profiles` INSERT, UPDATE, and DELETE remain denied; the Edge Function uses the protected RPC for updates.
- `admin_update_staff_profile` runs as `postgres` with an empty `search_path` and `row_security` disabled. It checks `auth.uid()` against an active Admin profile, allows only Admin/Receptionist target roles, protects self-demotion/deactivation, and locks active Admin rows before checking the last-Admin invariant. The database operation is authoritative; the Edge Function's Auth ban/unban operations are rolled back if the profile update fails.
- A new invitation first causes the Auth trigger to create an active Patient profile. The RPC promotes that profile only when its matching `auth.users` row has a non-null `invited_at`; legacy Patient/Doctor profiles are disabled by the migration and cannot be promoted. The RPC does not create profiles or Auth users.
- Disable public Auth signups in Supabase Authentication settings. Invitations continue to use the Auth Admin API.
- Active Receptionists can access operational records, departments, and the User Management list in read-only mode. Only active Admins can invite users, update profiles, or change account status.
- The migration retains the existing role constraint and clinic records. Review the deployed table policies and role/profile trigger before applying it; the repository does not contain the original schema or RLS policy definitions.
