(function () {
    const publicPages = new Set(["welcome.html", "login.html", "signup.html", "account-setup.html"]);
    const staffRoles = new Set(["admin", "receptionist"]);
    const currentPage = window.location.pathname.split("/").pop().toLowerCase();

    if (publicPages.has(currentPage)) {
        return;
    }

    document.documentElement.style.visibility = "hidden";

    const domReady = document.readyState === "loading"
        ? new Promise(function (resolve) {
            document.addEventListener("DOMContentLoaded", resolve, { once: true });
        })
        : Promise.resolve();

    async function protectPage() {
        await domReady;

        if (!window.clinicSupabase) {
            console.error("CLINICCARE authentication is unavailable.");
            window.location.replace("login.html");
            return;
        }

        try {
            const { data: sessionData, error: sessionError } =
                await window.clinicSupabase.auth.getSession();

            if (sessionError) {
                console.error("Unable to verify the CLINICCARE session:", sessionError);
                window.location.replace("login.html");
                return;
            }

            const user = sessionData.session && sessionData.session.user;
            if (!user) {
                window.location.replace("login.html");
                return;
            }

            const { data: profile, error: profileError } =
                await window.clinicSupabase
                    .from("profiles")
                    .select("full_name, role, is_active")
                    .eq("id", user.id)
                    .maybeSingle();

            if (profileError) {
                console.error("Unable to load the signed-in user's profile:", profileError);
                const { error: signOutError } = await window.clinicSupabase.auth.signOut();
                if (signOutError) console.error("Could not clear an unverified session:", signOutError);
                window.location.replace("login.html");
                return;
            }
            if (!profile || profile.is_active !== true || !staffRoles.has(profile.role)) {
                const { error: signOutError } = await window.clinicSupabase.auth.signOut();
                if (signOutError) console.error("Could not clear a non-staff session:", signOutError);
                window.location.replace("login.html");
                return;
            }

            const fullName = profile.full_name
                ? profile.full_name
                : user.user_metadata && user.user_metadata.full_name
                    ? user.user_metadata.full_name
                    : user.email || "ClinicCare User";
            const role = profile.role;
            const initials = fullName
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(function (part) {
                    return part.charAt(0).toUpperCase();
                })
                .join("") || "U";

            document.querySelectorAll(".profile-info strong, .topbar-profile strong")
                .forEach(function (element) {
                    element.textContent = fullName;
                });
            document.querySelectorAll(".profile-info span, .topbar-profile small, .admin-label")
                .forEach(function (element) {
                    element.textContent = role;
                });
            document.querySelectorAll(".profile-avatar").forEach(function (element) {
                element.textContent = initials;
            });

            const greetingName = document.getElementById("dashboardGreetingName");
            if (greetingName) {
                greetingName.textContent = fullName;
            }

            document.querySelectorAll(
                ".logout-link, .signout-link, .signout"
            ).forEach(function (link) {
                link.addEventListener("click", async function (event) {
                    event.preventDefault();
                    link.setAttribute("aria-busy", "true");

                    try {
                        const { error } =
                            await window.clinicSupabase.auth.signOut();
                        if (error) {
                            throw error;
                        }

                        window.location.replace("login.html");
                    } catch (error) {
                        console.error("CLINICCARE sign out failed:", error);
                        link.removeAttribute("aria-busy");
                        window.alert("Unable to sign out. Please try again.");
                    }
                });
            });

            document.documentElement.style.visibility = "";
        } catch (error) {
            console.error("CLINICCARE authentication check failed:", error);
            window.location.replace("login.html");
        }
    }

    protectPage();
})();
