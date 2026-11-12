if (!window.clinicSupabase) {
    throw new Error("CLINICCARE Supabase client is not initialized. Check script loading order.");
}

const departmentTableBody = document.getElementById("departmentTableBody");
const departmentModal = document.getElementById("departmentModal");
const viewModal = document.getElementById("viewModal");
const departmentForm = document.getElementById("departmentForm");
const departmentId = document.getElementById("departmentId");
const departmentName = document.getElementById("departmentName");
const departmentDescription = document.getElementById("departmentDescription");
const departmentDoctors = document.getElementById("departmentDoctors");
const departmentStatus = document.getElementById("departmentStatus");
const saveDepartmentBtn = document.getElementById("saveDepartmentBtn");
const feedback = document.createElement("div");
feedback.setAttribute("role", "status");
feedback.setAttribute("aria-live", "polite");
feedback.style.cssText = "display:none;margin:14px 0;padding:11px 14px;border-radius:8px;font-size:13px;";
document.querySelector(".content-card").prepend(feedback);

let departments = [];
let doctors = [];
let profiles = [];
let saving = false;

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

function assignedDoctors(department) {
    return doctors.filter(doctor => doctor.department_id === department.id);
}

function doctorLabel(doctor) {
    const profile = profiles.find(item => item.id === doctor.profile_id);
    return doctor.full_name || profile?.full_name || doctor.doctor_code || doctor.id;
}

function renderDepartments() {
    const term = document.getElementById("searchInput").value.trim().toLowerCase();
    const status = document.getElementById("statusFilter").value;
    const filtered = departments.filter(department =>
        (!term || [department.name, department.id, department.description]
            .some(value => String(value || "").toLowerCase().includes(term))) &&
        (!status || department.status === status)
    );
    departmentTableBody.replaceChildren();

    filtered.forEach(department => {
        const linkedDoctors = assignedDoctors(department);
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><span class="department-id">${escapeText(department.id)}</span></td>
            <td><span class="department-name">${escapeText(department.name)}</span></td>
            <td class="description-cell">${escapeText(department.description)}</td>
            <td>${linkedDoctors.length} Doctor(s)</td>
            <td><span class="status-badge ${department.status === "Active" ? "status-active" : "status-inactive"}">${escapeText(department.status)}</span></td>
            <td><div class="action-buttons">
                <button class="action-btn view-btn" data-action="view" data-id="${department.id}">View</button>
                <button class="action-btn edit-btn" data-action="edit" data-id="${department.id}">Edit</button>
                <button class="action-btn delete-btn" data-action="delete" data-id="${department.id}">Delete</button>
            </div></td>`;
        departmentTableBody.appendChild(row);
    });

    document.getElementById("tableCount").textContent =
        `Showing ${filtered.length} departments`;
    if (!filtered.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 6;
        cell.className = "empty-state";
        cell.textContent = departments.length ? "No departments match these filters." : "No departments found.";
        row.appendChild(cell);
        departmentTableBody.appendChild(row);
    }

    document.getElementById("totalDepartments").textContent = departments.length;
    document.getElementById("activeDepartments").textContent =
        departments.filter(item => item.status === "Active").length;
    document.getElementById("inactiveDepartments").textContent =
        departments.filter(item => item.status === "Inactive").length;
    document.getElementById("assignedDoctors").textContent =
        new Set(doctors.filter(doctor => doctor.department_id).map(doctor => doctor.id)).size;
}

async function loadDepartments() {
    message("Loading departments...", "info");
    try {
        const [departmentResult, doctorResult, profileResult] = await Promise.all([
            window.clinicSupabase.from("departments").select("*").order("name"),
            window.clinicSupabase.from("doctors").select("id, doctor_code, full_name, profile_id, department_id"),
            window.clinicSupabase.from("profiles").select("id, full_name, role").eq("role", "doctor")
        ]);
        if (departmentResult.error) throw departmentResult.error;
        if (doctorResult.error) throw doctorResult.error;
        if (profileResult.error) throw profileResult.error;
        departments = departmentResult.data || [];
        doctors = doctorResult.data || [];
        profiles = profileResult.data || [];
        Array.from(departmentDoctors.options).forEach(option => {
            if (option.value) option.remove();
        });
        doctors.forEach(doctor => departmentDoctors.add(new Option(doctorLabel(doctor), doctor.id)));
        renderDepartments();
        message(departments.length ? "" : "No departments have been added yet.", "info");
        return true;
    } catch (error) {
        console.error("Unable to load departments:", error);
        message("Could not load departments. Check your connection and database permissions.", "error");
        return false;
    }
}

function openDepartmentModal(department) {
    departmentForm.reset();
    const editing = Boolean(department);
    departmentId.value = department?.id || "";
    document.getElementById("modalTitle").textContent = editing ? "Edit Department" : "Add Department";
    saveDepartmentBtn.textContent = editing ? "Update Department" : "Save Department";
    departmentName.value = department?.name || "";
    departmentDescription.value = department?.description || "";
    departmentStatus.value = department?.status || "Active";
    const assigned = new Set(department ? assignedDoctors(department).map(doctor => doctor.id) : []);
    Array.from(departmentDoctors.options).forEach(option => { option.selected = assigned.has(option.value); });
    departmentModal.classList.add("show");
}

function closeDepartmentModal() {
    if (saving) return;
    departmentModal.classList.remove("show");
    departmentForm.reset();
    departmentId.value = "";
}

function viewDepartment(department) {
    const names = assignedDoctors(department).map(doctorLabel);
    const details = document.getElementById("departmentDetails");
    details.innerHTML = `
        <div class="detail-item"><span>Department UUID</span><strong>${escapeText(department.id)}</strong></div>
        <div class="detail-item"><span>Department Name</span><strong>${escapeText(department.name)}</strong></div>
        <div class="detail-item"><span>Description</span><strong>${escapeText(department.description)}</strong></div>
        <div class="detail-item"><span>Assigned Doctors</span><strong>${escapeText(names.join(", ") || "No doctors assigned")}</strong></div>
        <div class="detail-item"><span>Status</span><strong>${escapeText(department.status)}</strong></div>`;
    viewModal.classList.add("show");
}

function isDepartmentReferenceError(error) {
    return error?.code === "23503" || /foreign key constraint/i.test(error?.message || "");
}

departmentForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    saveDepartmentBtn.disabled = true;
    try {
        const id = departmentId.value;
        const payload = {
            name: departmentName.value.trim(),
            description: departmentDescription.value.trim(),
            status: departmentStatus.value
        };
        const result = id
            ? await window.clinicSupabase.from("departments").update(payload).eq("id", id).select("*").maybeSingle()
            : await window.clinicSupabase.from("departments").insert(payload).select("*").single();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("The department was not saved; check your database permissions.");

        const selectedDoctorIds = Array.from(departmentDoctors.selectedOptions).map(option => option.value);
        let assignmentWarning = "";
        if (selectedDoctorIds.length) {
            const { error: assignmentError } = await window.clinicSupabase
                .from("doctors")
                .update({ department_id: result.data.id })
                .in("id", selectedDoctorIds);
            if (assignmentError) {
                console.error("Department saved but doctor assignments were not updated:", assignmentError);
                assignmentWarning = " Department saved, but one or more doctor assignments could not be updated.";
            }
        }

        departmentModal.classList.remove("show");
        const loaded = await loadDepartments();
        message(!loaded ? "Department saved, but the latest list could not be reloaded." : `${id ? "Department updated" : "Department added"} successfully.${assignmentWarning}`, !loaded || assignmentWarning ? "error" : "success");
    } catch (error) {
        console.error("Unable to save department:", error);
        message(error.code === "23505" ? "A department with this name already exists." : error.message || "Unable to save department.", "error");
    } finally {
        saving = false;
        saveDepartmentBtn.disabled = false;
    }
});

departmentTableBody.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const department = departments.find(item => item.id === button.dataset.id);
    if (!department) return;
    if (button.dataset.action === "view") viewDepartment(department);
    if (button.dataset.action === "edit") openDepartmentModal(department);
    if (button.dataset.action === "delete" && window.confirm(`Delete ${department.name}?`)) {
        button.disabled = true;
        try {
            const { error } = await window.clinicSupabase.from("departments").delete().eq("id", department.id);
            if (error) throw error;
            const loaded = await loadDepartments();
            message(loaded ? "Department deleted successfully." : "Department deleted, but the latest list could not be reloaded.", loaded ? "success" : "error");
        } catch (error) {
            console.error("Unable to delete department:", error);
            message(isDepartmentReferenceError(error)
                ? "This department is linked to clinic records (such as doctors or appointments) and cannot be deleted. Reassign or remove those references first."
                : error.message || "Unable to delete department.", "error");
            button.disabled = false;
        }
    }
});

document.getElementById("addDepartmentBtn").addEventListener("click", () => openDepartmentModal());
document.getElementById("closeModalBtn").addEventListener("click", closeDepartmentModal);
document.getElementById("cancelModalBtn").addEventListener("click", closeDepartmentModal);
document.getElementById("closeViewBtn").addEventListener("click", () => viewModal.classList.remove("show"));
document.getElementById("closeDetailsBtn").addEventListener("click", () => viewModal.classList.remove("show"));
departmentModal.addEventListener("click", event => { if (event.target === departmentModal) closeDepartmentModal(); });
viewModal.addEventListener("click", event => { if (event.target === viewModal) viewModal.classList.remove("show"); });
document.getElementById("searchInput").addEventListener("input", renderDepartments);
document.getElementById("statusFilter").addEventListener("change", renderDepartments);
document.getElementById("exportBtn").addEventListener("click", () => {
    if (!departments.length) return message("No departments are available to export.", "info");
    const rows = [["Department UUID", "Name", "Description", "Assigned Doctors", "Status"],
        ...departments.map(department => [department.id, department.name, department.description, assignedDoctors(department).map(doctorLabel).join("; "), department.status])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = "cliniccare-departments.csv"; link.click(); URL.revokeObjectURL(url);
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
loadDepartments();
