const accountSetupForm = document.getElementById("accountSetupForm");
const recoveryRequestForm = document.getElementById("recoveryRequestForm");
const accountSetupMessage = document.getElementById("accountSetupMessage");
const newPassword = document.getElementById("newPassword");
const confirmNewPassword = document.getElementById("confirmNewPassword");
const accountSetupSubmit = accountSetupForm.querySelector('button[type="submit"]');
const recoveryEmail = document.getElementById("recoveryEmail");
const recoverySubmit = recoveryRequestForm.querySelector('button[type="submit"]');

function showSetupMessage(text, isError = true) {
    accountSetupMessage.textContent = text;
    accountSetupMessage.style.color = isError ? "#d9534f" : "#13a89e";
}

function showPasswordForm() {
    recoveryRequestForm.hidden = true;
    accountSetupForm.hidden = false;
    showSetupMessage("");
}

function showRecoveryForm(message) {
    accountSetupForm.hidden = true;
    recoveryRequestForm.hidden = false;
    showSetupMessage(message);
}

document.querySelectorAll(".toggle-password").forEach(button => {
    button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.target);
        const showing = input.type === "password";
        input.type = showing ? "text" : "password";
        button.textContent = showing ? "Hide" : "Show";
    });
});

async function initializeAccountSetup() {
    if (!window.clinicSupabase) {
        showRecoveryForm("Authentication is unavailable. Refresh the page and try again.");
        return;
    }

    try {
        const auth = window.clinicSupabase.auth;
        auth.onAuthStateChange((event, session) => {
            if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) {
                showPasswordForm();
            }
        });

        const { data, error } = await auth.getSession();
        if (error) throw error;
        if (data.session) {
            showPasswordForm();
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const isExpiredLink = params.get("error_code") === "otp_expired";
        showRecoveryForm(isExpiredLink
            ? "This setup link has expired. Enter your email to receive a fresh secure link."
            : "Enter your invited email address and we’ll send a secure password setup link if an account exists.");
    } catch (error) {
        console.error("Could not validate account setup session:", error);
        showRecoveryForm("Could not validate this link. Request a fresh secure setup email below.");
    }
}

recoveryRequestForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!recoveryRequestForm.reportValidity() || recoverySubmit.disabled) return;

    if (!window.clinicSupabase) {
        showSetupMessage("Authentication is unavailable. Refresh the page and try again.");
        return;
    }

    recoverySubmit.disabled = true;
    recoverySubmit.setAttribute("aria-busy", "true");
    try {
        const redirectTo = new URL("account-setup.html", window.location.href).href;
        const { error } = await window.clinicSupabase.auth.resetPasswordForEmail(
            recoveryEmail.value.trim(),
            { redirectTo }
        );
        if (error) throw error;

        showSetupMessage("If an account exists for that email, a secure password setup link has been sent. Check your inbox and spam folder.", false);
    } catch (error) {
        console.error("Could not request an account setup email:", error);
        showSetupMessage(error.message || "Could not send a setup email. Check the email address and try again.");
    } finally {
        recoverySubmit.disabled = false;
        recoverySubmit.removeAttribute("aria-busy");
    }
});

accountSetupForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!accountSetupForm.reportValidity() || accountSetupSubmit.disabled) return;

    if (newPassword.value.length < 8) {
        showSetupMessage("Password must contain at least 8 characters.");
        return;
    }
    if (newPassword.value !== confirmNewPassword.value) {
        showSetupMessage("Passwords do not match.");
        return;
    }

    accountSetupSubmit.disabled = true;
    accountSetupSubmit.setAttribute("aria-busy", "true");
    try {
        const { error } = await window.clinicSupabase.auth.updateUser({
            password: newPassword.value
        });
        if (error) throw error;
        accountSetupForm.reset();
        accountSetupForm.hidden = true;
        document.getElementById("accountSetupLoginText").textContent = "Your account is ready.";
        document.getElementById("accountSetupLoginLink").textContent = "Continue to CLINICCARE";
        document.getElementById("accountSetupLoginLink").href = "dashboard.html";
        showSetupMessage("Password set successfully. You can now continue to the clinic system.", false);
    } catch (error) {
        console.error("Could not set account password:", error);
        showSetupMessage(error.message || "Could not set your password. Reopen the invitation link and try again.");
    } finally {
        accountSetupSubmit.disabled = false;
        accountSetupSubmit.removeAttribute("aria-busy");
    }
});

initializeAccountSetup();
