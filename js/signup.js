const signupForm = document.getElementById("signupForm");
const signupMessage = document.getElementById("signupMessage");
const signupSubmit = document.getElementById("signupSubmit");

let isSubmitting = false;

function showSignupMessage(message, type = "error") {
    signupMessage.textContent = message;
    signupMessage.style.color = type === "success" ? "#13a89e" : "#d9534f";
    signupMessage.setAttribute("role", type === "error" ? "alert" : "status");
}

function authErrorMessage(error) {
    const message = error && typeof error.message === "string"
        ? error.message
        : "";

    if (/signups? (?:are )?not allowed|signups? (?:are )?disabled/i.test(message)) {
        return "Receptionist registration is currently disabled. Please contact the clinic administrator.";
    }
    if (/already registered|already exists/i.test(message)) {
        return "An account with this email already exists. Sign in or use the password setup link.";
    }
    if (/invalid email/i.test(message)) {
        return "Enter a valid email address.";
    }
    if (/password.*(weak|short|characters|length)|weak password/i.test(message)) {
        return "Choose a stronger password with at least 8 characters.";
    }
    if (/rate limit|too many requests/i.test(message)) {
        return "Too many registration attempts. Please wait a while and try again.";
    }
    if (/redirect.*(not allowed|allowlist)|not an allowed redirect/i.test(message)) {
        return "Email confirmation is not configured for this site. Please contact the clinic administrator.";
    }
    if (/failed to fetch|network/i.test(message)) {
        return "Unable to reach the registration service. Check your connection and try again.";
    }
    return message || "Unable to create your account right now. Please try again.";
}

document.querySelectorAll(".toggle-password").forEach(button => {
    button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.target);
        if (!input) return;

        const showing = input.type === "password";
        input.type = showing ? "text" : "password";
        button.textContent = showing ? "Hide" : "Show";
        button.setAttribute("aria-pressed", String(showing));
        button.setAttribute(
            "aria-label",
            `${showing ? "Hide" : "Show"} ${input.id === "confirmPassword" ? "confirm password" : "password"}`
        );
    });
});

signupForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (isSubmitting || !signupForm.reportValidity()) return;

    const fullName = document.getElementById("fullName").value.trim();
    const phone = document.getElementById("phoneNumber").value.trim();
    const email = document.getElementById("email").value.trim().toLowerCase();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (!fullName || !phone || !email || !password || !confirmPassword) {
        showSignupMessage("Complete all fields before creating your account.");
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showSignupMessage("Enter a valid email address.");
        return;
    }
    if (password.length < 8) {
        showSignupMessage("Password must contain at least 8 characters.");
        return;
    }
    if (password !== confirmPassword) {
        showSignupMessage("Passwords do not match.");
        return;
    }
    if (!window.clinicSupabase) {
        showSignupMessage("Authentication is unavailable. Refresh the page and try again.");
        return;
    }

    isSubmitting = true;
    signupSubmit.disabled = true;
    signupSubmit.setAttribute("aria-busy", "true");
    signupSubmit.firstChild.textContent = "Creating account ";

    try {
        const auth = window.clinicSupabase.auth;
        const { data: sessionData, error: sessionError } = await auth.getSession();
        if (sessionError) throw sessionError;
        if (sessionData.session) {
            showSignupMessage("You are already signed in. Sign out before registering another account.");
            return;
        }

        const emailRedirectTo = new URL("login.html", window.location.href).href;
        const { data, error } = await auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    phone,
                },
                emailRedirectTo,
            },
        });
        if (error) throw error;
        if (!data.user) {
            throw new Error("Supabase Auth did not return the registered user.");
        }

        signupForm.hidden = true;
        if (data.session) {
            const { error: signOutError } = await auth.signOut({ scope: "local" });
            if (signOutError) {
                console.error("Could not clear the session created during registration:", signOutError);
                showSignupMessage(
                    "Your account was created, but the current Auth settings did not require email confirmation. Contact the clinic administrator before signing in."
                );
                return;
            }
            showSignupMessage(
                "Your account was created, but email confirmation is not required by the current Auth settings. Your session has been cleared; contact the clinic administrator before signing in."
            );
            return;
        }

        showSignupMessage(
            "Registration successful. Check your email and confirm your account before logging in. Check your spam folder if the message does not arrive.",
            "success"
        );
    } catch (error) {
        console.error("ClinicCare receptionist registration failed:", error);
        showSignupMessage(authErrorMessage(error));
    } finally {
        isSubmitting = false;
        signupSubmit.disabled = false;
        signupSubmit.removeAttribute("aria-busy");
        signupSubmit.firstChild.textContent = "Create Account ";
    }
});
