const usersTableBody = document.getElementById("usersTableBody");
const userModal = document.getElementById("userModal");
const viewUserModal = document.getElementById("viewUserModal");
const userForm = document.getElementById("userForm");
const modalTitle = document.getElementById("modalTitle");
const userModalDescription = document.getElementById("userModalDescription");
const userId = document.getElementById("userId");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const userEmailHelp = document.getElementById("userEmailHelp");
const userPhone = document.getElementById("userPhone");
const userRole = document.getElementById("userRole");
const userStatus = document.getElementById("userStatus");
const saveUserBtn = document.getElementById("saveUserBtn");
const addUserBtn = document.getElementById("addUserBtn");
const exportUsersBtn = document.getElementById("exportUsersBtn");
const userReadOnlyNotice = document.getElementById("userReadOnlyNotice");
const feedback = document.createElement("div");
feedback.setAttribute("role", "status");
feedback.setAttribute("aria-live", "polite");
feedback.style.cssText = "display:none;margin:14px 0;padding:11px 14px;border-radius:8px;font-size:13px;";
document.querySelector(".content-card").prepend(feedback);

let users = [];
let saving = false;
let canManageUsers = false;
let requestedCreateHandled = false;
const userDirectory = new window.ClinicCareDomain.ClinicRecordList();

function message(text, type) {
    feedback.textContent = text;
    feedback.style.display = text ? "block" : "none";
    feedback.style.color = type === "error" ? "#a33f3f" : type === "success" ? "#187653" : "#526a74";
    feedback.style.background = type === "error" ? "#fff0f0" : type === "success" ? "#e8f7f0" : "#f3f7f8";
}

function escapeText(value) {
    return String(value ?? "—").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
}

function initials(name) {
    return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
        .map(part => part[0].toUpperCase()).join("") || "U";
}

function updateStatistics() {
    document.getElementById("totalUsers").textContent = users.length;
    document.getElementById("activeUsers").textContent = users.filter(item => item.is_active).length;
    document.getElementById("adminUsers").textContent = users.filter(item => item.role === "admin").length;
    document.getElementById("receptionistUsers").textContent = users.filter(item => item.role === "receptionist").length;
}

function updateUserAccessControls() {
    addUserBtn.hidden = !canManageUsers;
    exportUsersBtn.hidden = !canManageUsers;
    userReadOnlyNotice.hidden = canManageUsers;
}

function filteredUsers() {
    const term = document.getElementById("searchUser").value.trim();
    const role = document.getElementById("roleFilter").value.toLowerCase();
    const status = document.getElementById("statusFilter").value;
    return userDirectory.search(term).filter(user =>
        (role === "all" || user.role === role) &&
        (status === "all" || (status === "Active" ? user.is_active : !user.is_active))
    );
}

function renderUsers() {
    const filtered = filteredUsers();
    usersTableBody.replaceChildren();
    document.getElementById("recordCount").textContent = `${filtered.length} user(s)`;
    if (!filtered.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 7;
        cell.className = "empty-state";
        cell.textContent = users.length ? "No users match these filters." : "No system accounts are available.";
        row.appendChild(cell);
        usersTableBody.appendChild(row);
    }

    filtered.forEach(user => {
        const row = document.createElement("tr");
        const isStaffAccount = ["admin", "receptionist"].includes(user.role);
        const managementActions = canManageUsers && isStaffAccount
            ? `<button class="action-btn edit-btn" data-action="edit" data-id="${escapeText(user.id)}">Edit</button>
                <button class="action-btn toggle-btn" data-action="toggle" data-id="${escapeText(user.id)}">${user.is_active ? "Deactivate account" : "Activate account"}</button>`
            : "";
        const legacyLabel = isStaffAccount ? "" : "<span>Legacy account</span>";
        row.innerHTML = `
            <td><strong>${escapeText(user.id)}</strong></td>
            <td><div class="user-info"><div class="user-avatar">${escapeText(initials(user.full_name))}</div><div><strong>${escapeText(user.full_name)}</strong><small>${escapeText(user.phone || "Phone unavailable")}</small></div></div></td>
            <td>${escapeText(user.email || "Not available")}</td>
            <td><span class="role-badge role-${escapeText(user.role)}">${escapeText(user.roleLabel)}</span></td>
            <td><span class="status-badge ${user.is_active ? "status-active" : "status-inactive"}">${user.is_active ? "Active" : "Inactive"}</span></td>
            <td>${escapeText(user.created_at ? new Date(user.created_at).toLocaleDateString() : "—")}</td>
            <td><div class="action-buttons">
                <button class="action-btn view-btn" data-action="view" data-id="${escapeText(user.id)}">View</button>
                ${managementActions}
                ${legacyLabel}
            </div></td>`;
        usersTableBody.appendChild(row);
    });
    updateStatistics();
}

async function callAdminFunction(action, payload = {}) {
    const { data, error } = await window.clinicSupabase.functions.invoke("admin-users", {
        body: { action, ...payload }
    });
    if (error) {
        let detail = "";
        if (error.context && typeof error.context.clone === "function") {
            try {
                const responseBody = await error.context.clone().json();
                detail = responseBody.error || "";
            } catch (readError) {
                console.warn("Could not read the admin function error response:", readError);
            }
        }
        throw new Error(detail || error.message || "Secure account management is unavailable.");
    }
    if (!data || data.error) {
        throw new Error(data?.error || "Secure account management returned an empty response.");
    }
    return data;
}

async function loadUsers() {
    message("Loading system accounts...", "info");
    try {
        const data = await callAdminFunction("list");
        canManageUsers = data.permissions?.canManageUsers === true;
        updateUserAccessControls();
        users = userDirectory.replace(data.users || [], window.ClinicCareDomain.createUserRecord);
        renderUsers();
        message(users.length ? "" : "No system accounts found.", users.length ? "" : "info");
        if (!requestedCreateHandled) {
            requestedCreateHandled = true;
            const requestedRole = new URLSearchParams(window.location.search).get("createRole");
            if (canManageUsers && ["admin", "receptionist"].includes(requestedRole)) {
                openCreateUser(requestedRole);
            }
        }
        return true;
    } catch (error) {
        console.error("Unable to load system accounts:", error);
        canManageUsers = false;
        updateUserAccessControls();
        users = userDirectory.replace([]);
        renderUsers();
        message(error.message || "Could not load system accounts. Verify staff access and the admin-users Edge Function deployment.", "error");
        return false;
    }
}

function openCreateUser(role = "") {
    if (!canManageUsers) return;
    userForm.reset();
    userId.value = "";
    userEmail.readOnly = false;
    userEmail.required = true;
    userEmailHelp.textContent = "An invitation will be sent to this address. The user sets their own password through Supabase Auth.";
    userRole.value = ["admin", "receptionist"].includes(role) ? role : "";
    userStatus.value = "Active";
    modalTitle.textContent = "Add New User";
    userModalDescription.textContent = "Invite a user to CLINICCARE with the selected role.";
    saveUserBtn.textContent = "Send Invitation";
    userModal.classList.add("show");
}

function editUser(user) {
    if (!canManageUsers) return;
    userForm.reset();
    userId.value = user.id;
    userName.value = user.full_name || "";
    userEmail.value = user.email || "";
    userEmail.readOnly = true;
    userEmail.required = false;
    userEmailHelp.textContent = "Email is managed by Supabase Auth. Create a separate secure process to change it.";
    userPhone.value = user.phone || "";
    userRole.value = user.role;
    userStatus.value = user.is_active ? "Active" : "Inactive";
    modalTitle.textContent = "Edit User";
    userModalDescription.textContent = "Update profile details, system role, and authenticated account access.";
    saveUserBtn.textContent = "Save User Changes";
    userModal.classList.add("show");
}

function viewUser(user) {
    const content = document.getElementById("userDetailsContent");
    content.replaceChildren();
    [
        ["Auth UUID", user.id],
        ["Full Name", user.full_name],
        ["Email", user.email],
        ["Phone Number", user.phone],
        ["Role", user.roleLabel],
        ["Account Status", user.is_active ? "Active" : "Inactive"],
        ["Created", user.created_at ? new Date(user.created_at).toLocaleString() : "Not available"]
    ].forEach(([label, value]) => {
        const item = document.createElement("div");
        item.className = "detail-item";
        const title = document.createElement("small");
        title.textContent = label;
        const detail = document.createElement("strong");
        detail.textContent = value || "Not provided";
        item.append(title, detail);
        content.appendChild(item);
    });
    viewUserModal.classList.add("show");
}

userForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!canManageUsers) {
        return message("Only an active Admin can change system accounts.", "error");
    }
    if (saving) return;
    if (!userForm.reportValidity()) return;

    const id = userId.value;
    const profile = {
        full_name: userName.value.trim(),
        phone: userPhone.value.trim(),
        role: userRole.value,
        is_active: userStatus.value === "Active"
    };
    if (!profile.full_name || !profile.phone || !profile.role) {
        return message("Complete the name, phone, role, and account status fields.", "error");
    }

    saving = true;
    saveUserBtn.disabled = true;
    try {
        if (id) {
            await callAdminFunction("update", { id, ...profile });
        } else {
            await callAdminFunction("create", { ...profile, email: userEmail.value.trim() });
        }
        userModal.classList.remove("show");
        const loaded = await loadUsers();
        const successMessage = id
            ? "User profile and Auth access were updated."
            : "Invitation sent. The new user must follow the email link to set up their account.";
        message(loaded ? successMessage : `${successMessage} The latest user list could not be reloaded.`, loaded ? "success" : "error");
    } catch (error) {
        console.error("Unable to save system account:", error);
        message(error.message || "Unable to save the system account.", "error");
    } finally {
        saving = false;
        saveUserBtn.disabled = false;
    }
});

async function toggleUserStatus(user, button) {
    if (!canManageUsers) return;
    if (saving) return;
    const isActive = !user.is_active;
    const verb = isActive ? "activate" : "deactivate";
    if (!window.confirm(`Are you sure you want to ${verb} this account?`)) return;

    saving = true;
    if (button) button.disabled = true;
    try {
        await callAdminFunction("update", {
            id: user.id,
            full_name: user.full_name,
            phone: user.phone || "",
            role: user.role,
            is_active: isActive
        });
        const loaded = await loadUsers();
        message(loaded ? `Account ${isActive ? "activated" : "deactivated"} successfully.` : "Account status changed, but the latest list could not be reloaded.", loaded ? "success" : "error");
    } catch (error) {
        console.error("Unable to update account status:", error);
        message(error.message || "Unable to update account status.", "error");
        if (button) button.disabled = false;
    } finally {
        saving = false;
    }
}

addUserBtn.addEventListener("click", () => openCreateUser());
document.getElementById("closeModalBtn").addEventListener("click", () => { if (!saving) userModal.classList.remove("show"); });
document.getElementById("cancelModalBtn").addEventListener("click", () => { if (!saving) userModal.classList.remove("show"); });
document.getElementById("closeViewModalBtn").addEventListener("click", () => viewUserModal.classList.remove("show"));
document.getElementById("closeViewBtn").addEventListener("click", () => viewUserModal.classList.remove("show"));
userModal.addEventListener("click", event => { if (event.target === userModal && !saving) userModal.classList.remove("show"); });
viewUserModal.addEventListener("click", event => { if (event.target === viewUserModal) viewUserModal.classList.remove("show"); });
usersTableBody.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action !== "view" && !canManageUsers) return;
    const user = userDirectory.getById(button.dataset.id);
    if (!user) return;
    if (button.dataset.action === "view") viewUser(user);
    if (button.dataset.action === "edit") editUser(user);
    if (button.dataset.action === "toggle") toggleUserStatus(user, button);
});
document.getElementById("searchUser").addEventListener("input", renderUsers);
document.getElementById("roleFilter").addEventListener("change", renderUsers);
document.getElementById("statusFilter").addEventListener("change", renderUsers);
document.getElementById("resetFiltersBtn").addEventListener("click", () => {
    document.getElementById("searchUser").value = "";
    document.getElementById("roleFilter").value = "all";
    document.getElementById("statusFilter").value = "all";
    renderUsers();
});
exportUsersBtn.addEventListener("click", () => {
    if (!canManageUsers) return;
    if (!users.length) return message("No system accounts are available to export.", "info");
    const rows = [["Auth UUID", "Full Name", "Phone", "Auth Email", "Role", "Account Active", "Created At"],
        ...users.map(user => [user.id, user.full_name, user.phone, user.email, user.role, user.is_active, user.created_at])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "cliniccare-users.csv";
    link.click();
    URL.revokeObjectURL(url);
});
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
if (sidebar) {
    sidebar.scrollTop = 0;
    window.addEventListener("pageshow", () => {
        sidebar.scrollTop = 0;
    });
}
if (menuToggle && sidebar) menuToggle.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    if (sidebar.classList.contains("open")) sidebar.scrollTop = 0;
});

loadUsers();
