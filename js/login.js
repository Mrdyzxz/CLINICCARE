
const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const loginMessage = document.getElementById("loginMessage");
const forgotPassword = document.getElementById("forgotPassword");

// SHOW / HIDE PASSWORD
togglePassword.addEventListener("click", function () {

    if (passwordInput.type === "password") {
        passwordInput.type = "text";
        togglePassword.textContent = "Hide";
    } else {
        passwordInput.type = "password";
        togglePassword.textContent = "Show";
    }

});

// LOGIN FORM
loginForm.addEventListener("submit", async function (event) {

    event.preventDefault();

    loginMessage.textContent = "";
    loginMessage.style.color = "#d9534f";

    const email = document.getElementById("email").value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        loginMessage.textContent = "Please enter your email and password.";
        return;
    }

    if (!window.clinicSupabase) {
        loginMessage.textContent =
            "Authentication is unavailable. Please refresh and try again.";
        return;
    }

    const submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");

    try {
        const auth = window.clinicSupabase.auth;
        const { data, error } = await auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            const message = /email not confirmed/i.test(error.message || "")
                ? "Please verify your email address before signing in."
                : /invalid login credentials/i.test(error.message || "")
                    ? "Incorrect email or password. Check your password or use Forgot password to reset it."
                    : error.message || "Unable to sign in. Please try again.";
            loginMessage.textContent = message;
            return;
        }

        const { data: profile, error: profileError } = await window.clinicSupabase
            .from("profiles")
            .select("role, is_active")
            .eq("id", data.user.id)
            .maybeSingle();
        if (profileError || !profile ||
            !["admin", "receptionist"].includes(profile.role) ||
            profile.is_active !== true) {
            const { error: signOutError } = await auth.signOut();
            if (signOutError) {
                console.error("Could not clear a non-staff session:", signOutError);
            }
            loginMessage.textContent = profileError
                ? "Unable to verify staff access. Please try again or contact the administrator."
                : "This system is available to active Admin and Receptionist accounts only.";
            return;
        }

        window.location.href = "dashboard.html";
    } catch (error) {
        console.error("ClinicCare login failed:", error);
        loginMessage.textContent =
            "Unable to sign in right now. Please try again.";
    } finally {
        submitButton.disabled = false;
        submitButton.removeAttribute("aria-busy");
    }

});

// FORGOT PASSWORD
forgotPassword.addEventListener("click", function (event) {

    event.preventDefault();
    window.location.href = "account-setup.html";

});
