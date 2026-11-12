import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedRoles = new Set(["admin", "receptionist"]);
const inactiveBanDuration = "876000h";
const pageSize = 1000;

function respond(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function requiredEnv(name: string) {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing required Edge Function configuration: ${name}`);
    return value;
}

function requiredDefaultKey(keysEnv: string, legacyEnv: string) {
    const keysJson = Deno.env.get(keysEnv);
    if (!keysJson) return requiredEnv(legacyEnv);

    let keys: Record<string, unknown>;
    try {
        keys = JSON.parse(keysJson);
    } catch {
        throw new Error(`Supabase's ${keysEnv} environment value is not valid JSON.`);
    }

    const key = keys.default;
    if (typeof key !== "string" || !key) {
        throw new Error(`Supabase's ${keysEnv} environment value has no default key.`);
    }
    return key;
}

function validRole(role: unknown): role is "admin" | "receptionist" {
    return typeof role === "string" && allowedRoles.has(role);
}

function validateProfileInput(body: Record<string, unknown>) {
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!fullName) throw new Error("Full name is required.");
    if (!phone) throw new Error("Phone number is required.");
    if (!validRole(body.role)) throw new Error("Select a valid system role.");
    if (typeof body.is_active !== "boolean") throw new Error("Select a valid account status.");
    return { full_name: fullName, phone, role: body.role, is_active: body.is_active };
}

async function updateStaffProfile(
    client: ReturnType<typeof createClient>,
    id: string,
    profileInput: ReturnType<typeof validateProfileInput>,
) {
    const { data, error } = await client.rpc("admin_update_staff_profile", {
        p_target_id: id,
        p_full_name: profileInput.full_name,
        p_phone: profileInput.phone,
        p_role: profileInput.role,
        p_is_active: profileInput.is_active,
    });
    if (error) throw error;

    const updatedProfile = Array.isArray(data) ? data[0] : null;
    if (
        !updatedProfile ||
        updatedProfile.id !== id ||
        updatedProfile.role !== profileInput.role ||
        updatedProfile.is_active !== profileInput.is_active
    ) {
        throw new Error("The protected database operation did not confirm the requested profile update.");
    }
    return updatedProfile;
}

async function loadProfiles(client: ReturnType<typeof createClient>) {
    const profiles = [];
    for (let offset = 0; offset < 1_000_000; offset += pageSize) {
        const { data, error } = await client
            .from("profiles")
            .select("id, full_name, phone, role, is_active, created_at")
            .order("created_at", { ascending: false })
            .range(offset, offset + pageSize - 1);
        if (error) throw error;
        profiles.push(...(data || []));
        if (!data || data.length < pageSize) return profiles;
    }
    throw new Error("Profile list exceeded the supported pagination limit.");
}

Deno.serve(async request => {
    if (request.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (request.method !== "POST") {
        return respond({ error: "Method not allowed." }, 405);
    }

    try {
        const authorization = request.headers.get("Authorization") || "";
        const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
        if (!tokenMatch) return respond({ error: "Sign in with an active staff account first." }, 401);

        const supabaseUrl = requiredEnv("SUPABASE_URL");
        const publishableKey = requiredDefaultKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
        const secretKey = requiredDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
        const authClient = createClient(supabaseUrl, publishableKey, {
            global: { headers: { Authorization: `Bearer ${tokenMatch[1]}` } },
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
        if (authError || !authData.user) {
            return respond({ error: "Your session is invalid or has expired. Sign in again." }, 401);
        }

        const adminClient = createClient(supabaseUrl, secretKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: actor, error: actorError } = await authClient
            .from("profiles")
            .select("id, role, is_active")
            .eq("id", authData.user.id)
            .maybeSingle();
        if (actorError) {
            console.error("Could not verify the staff profile:", actorError);
            return respond({ error: "Unable to verify staff access." }, 500);
        }
        if (!actor || !allowedRoles.has(actor.role) || actor.is_active !== true) {
            return respond({ error: "Only active Admin and Receptionist accounts can access system users." }, 403);
        }

        let body: Record<string, unknown>;
        try {
            body = await request.json();
        } catch {
            return respond({ error: "Request body must be valid JSON." }, 400);
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return respond({ error: "Request body must be a JSON object." }, 400);
        }

        if (body.action === "list") {
            const [profiles, authUsers] = await Promise.all([
                loadProfiles(adminClient),
                (async () => {
                    const users = [];
                    for (let page = 1; page <= 1000; page += 1) {
                        const { data, error } = await adminClient.auth.admin.listUsers({
                            page,
                            perPage: pageSize,
                        });
                        if (error) throw error;
                        users.push(...data.users);
                        if (data.users.length < pageSize) return users;
                    }
                    throw new Error("Account list exceeded the supported pagination limit.");
                })(),
            ]);
            const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
            if (authUsers.some(authUser => !profilesById.has(authUser.id))) {
                return respond({
                    error: "Some Auth accounts have no profile. Check the profile creation trigger.",
                }, 500);
            }
            const users = authUsers.map(authUser => {
                const profile = profilesById.get(authUser.id);
                return {
                    id: authUser.id,
                    email: authUser.email || "",
                    full_name: profile.full_name || authUser.user_metadata?.full_name || "",
                    phone: profile.phone || authUser.user_metadata?.phone || "",
                    role: profile.role,
                    is_active: profile.is_active,
                    created_at: profile.created_at || authUser.created_at,
                };
            });
            return respond({
                users,
                permissions: { canManageUsers: actor.role === "admin" },
            });
        }

        if (actor.role !== "admin") {
            return respond({ error: "Only an active Admin can create or update system accounts." }, 403);
        }

        if (body.action === "create") {
            const profileInput = validateProfileInput(body);
            const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return respond({ error: "Enter a valid email address." }, 400);
            }

            const redirectTo = Deno.env.get("APP_SITE_URL");
            if (!redirectTo) {
                return respond({ error: "Set APP_SITE_URL to the deployed account-setup.html URL before inviting users." }, 500);
            }
            const { data: inviteData, error: inviteError } =
                await adminClient.auth.admin.inviteUserByEmail(email, {
                    data: {
                        full_name: profileInput.full_name,
                        phone: profileInput.phone,
                    },
                    redirectTo,
                });
            if (inviteError) {
                return respond({
                    error: /already|registered|exists/i.test(inviteError.message)
                        ? "An Auth account with this email already exists."
                        : "Could not invite this user. Check the email and Supabase Auth email settings.",
                }, 400);
            }
            if (!inviteData.user) throw new Error("Supabase Auth did not return the invited user.");

            const createdId = inviteData.user.id;
            try {
                await updateStaffProfile(authClient, createdId, profileInput);
            } catch (profileError) {
                const { error: rollbackError } = await adminClient.auth.admin.deleteUser(createdId);
                if (rollbackError) console.error("Could not roll back an invited Auth user:", rollbackError);
                console.error("The invited profile could not be promoted to staff:", profileError);
                return respond({
                    error: "The Auth invitation was rolled back because its profile could not be promoted. Verify the profile trigger and protected database function, then try again.",
                }, 500);
            }

            if (!profileInput.is_active) {
                const { error: banError } = await adminClient.auth.admin.updateUserById(createdId, {
                    ban_duration: inactiveBanDuration,
                });
                if (banError) {
                    const { error: rollbackError } = await adminClient.auth.admin.deleteUser(createdId);
                    if (rollbackError) console.error("Could not roll back an inactive invited user:", rollbackError);
                    console.error("Could not deactivate the new Auth user:", banError);
                    return respond({ error: "The account could not be safely deactivated, so the invitation was rolled back." }, 500);
                }
            }

            return respond({ user: { id: createdId, email, ...profileInput } }, 201);
        }

        if (body.action === "update") {
            const id = typeof body.id === "string" ? body.id : "";
            if (!id) return respond({ error: "A profile UUID is required." }, 400);
            const profileInput = validateProfileInput(body);
            const { data: current, error: currentError } = await authClient
                .from("profiles")
                .select("id, role, is_active")
                .eq("id", id)
                .maybeSingle();
            if (currentError) throw currentError;
            if (!current) return respond({ error: "That user profile no longer exists." }, 404);
            if (!validRole(current.role)) {
                return respond({
                    error: "Legacy doctor and patient accounts cannot be activated or converted. Invite a separate staff account.",
                }, 400);
            }

            if (id === actor.id && (profileInput.role !== "admin" || !profileInput.is_active)) {
                return respond({ error: "You cannot deactivate your own administrator account or remove its admin role." }, 400);
            }
            const { data: doctorLinks, error: doctorLinkError } = await authClient
                .from("doctors")
                .select("id")
                .eq("profile_id", id)
                .limit(1);
            if (doctorLinkError) throw doctorLinkError;
            if ((doctorLinks || []).length) {
                return respond({ error: "This account is linked to a doctor record. Reassign or remove that doctor record before changing its role." }, 400);
            }

            const accountStatusChanged = profileInput.is_active !== current.is_active;
            if (accountStatusChanged) {
                const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, {
                    ban_duration: profileInput.is_active ? "none" : inactiveBanDuration,
                });
                if (authUpdateError) {
                    console.error("Could not update the Auth account status:", authUpdateError);
                    return respond({ error: "Supabase Auth could not update this account's access status." }, 400);
                }
            }
            try {
                await updateStaffProfile(authClient, id, profileInput);
            } catch (updateError) {
                if (accountStatusChanged) {
                    const { error: rollbackError } = await adminClient.auth.admin.updateUserById(id, {
                        ban_duration: current.is_active ? "none" : inactiveBanDuration,
                    });
                    if (rollbackError) console.error("Could not roll back Auth status after profile update failure:", rollbackError);
                }
                throw updateError;
            }
            return respond({ user: { id, ...profileInput } });
        }

        return respond({ error: "Unsupported account management action." }, 400);
    } catch (error) {
        console.error("Staff account management failed:", error);
        return respond({ error: error instanceof Error ? error.message : "Account management failed." }, 500);
    }
});
