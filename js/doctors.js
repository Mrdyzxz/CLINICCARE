const doctorTableBody = document.getElementById("doctorTableBody");
const doctorModal = document.getElementById("doctorModal");
const viewModal = document.getElementById("viewModal");
const doctorForm = document.getElementById("doctorForm");
const doctorFullName = document.getElementById("doctorFullName");
const doctorEmail = document.getElementById("doctorEmail");
const doctorPhone = document.getElementById("doctorPhone");
const doctorDepartment = document.getElementById("doctorDepartment");
const doctorSpecialization = document.getElementById("doctorSpecialization");
const doctorLicenseNumber = document.getElementById("doctorLicenseNumber");
const doctorAvailability = document.getElementById("doctorAvailability");
const saveDoctorBtn = document.getElementById("saveDoctorBtn");
const modalTitle = document.getElementById("modalTitle");
const feedback = document.createElement("div");
feedback.setAttribute("role", "status");
feedback.setAttribute("aria-live", "polite");
feedback.style.cssText = "display:none;margin:14px 0;padding:11px 14px;border-radius:8px;font-size:13px;";
document.querySelector(".doctors-panel").prepend(feedback);

let doctors = [];
let departments = [];
let editingDoctorId = null;
let savingDoctor = false;

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

function departmentFor(doctor) {
    return departments.find(department => department.id === doctor.department_id);
}

function doctorNameFor(doctor) {
    return doctor.full_name || "Name unavailable";
}

function fillSelect(select, firstLabel, rows, getId, getLabel) {
    select.replaceChildren(new Option(firstLabel, ""));
    rows.forEach(row => select.add(new Option(getLabel(row), getId(row))));
}

function isMissingDirectoryColumn(error) {
    return error?.code === "42703" || error?.code === "PGRST204";
}

function updateFilters() {
    fillSelect(
        document.getElementById("departmentFilter"),
        "All Departments",
        departments,
        department => department.id,
        department => department.name
    );
    document.getElementById("departmentFilter").options[0].value = "All";
    document.getElementById("availabilityFilter").value ||= "All";
}

function updateStats() {
    document.getElementById("totalDoctors").textContent = doctors.length;
    document.getElementById("availableDoctors").textContent =
        doctors.filter(doctor => doctor.availability === "Available").length;
    document.getElementById("unavailableDoctors").textContent =
        doctors.filter(doctor => doctor.availability === "Unavailable").length;
    document.getElementById("departmentCount").textContent =
        new Set(doctors.map(doctor => doctor.department_id).filter(Boolean)).size;
}

function renderDoctors() {
    const term = document.getElementById("searchInput").value.trim().toLowerCase();
    const selectedDepartment = document.getElementById("departmentFilter").value;
    const selectedAvailability = document.getElementById("availabilityFilter").value;
    const filtered = doctors.filter(doctor => {
        const department = departmentFor(doctor);
        const matchesSearch = [
            doctor.full_name, doctor.email, doctor.phone, doctor.license_number,
            doctor.doctor_code, doctor.specialization
        ].some(value => String(value || "").toLowerCase().includes(term));
        return matchesSearch &&
            (selectedDepartment === "All" || doctor.department_id === selectedDepartment) &&
            (selectedAvailability === "All" || doctor.availability === selectedAvailability);
    });

    doctorTableBody.replaceChildren();
    filtered.forEach(doctor => {
        const department = departmentFor(doctor);
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="doctor-name">${escapeText(doctorNameFor(doctor))}</td>
            <td class="doctor-id">${escapeText(doctor.doctor_code)}</td>
            <td>${escapeText(department?.name)}</td>
            <td>${escapeText(doctor.specialization)}</td>
            <td>${escapeText(doctor.email)}<br>${escapeText(doctor.phone)}</td>
            <td><span class="availability-badge ${doctor.availability === "Available" ? "availability-available" : "availability-unavailable"}">${escapeText(doctor.availability)}</span></td>
            <td>
                <button class="action-btn" data-action="view" data-id="${doctor.id}">View</button>
                <button class="action-btn" data-action="edit" data-id="${doctor.id}">Edit</button>
                <button class="action-btn delete-btn" data-action="delete" data-id="${doctor.id}">Delete</button>
            </td>`;
        doctorTableBody.appendChild(row);
    });
    document.getElementById("emptyState").style.display = filtered.length ? "none" : "block";
    document.getElementById("doctorCount").textContent =
        `${filtered.length} ${filtered.length === 1 ? "Doctor" : "Doctors"}`;
    updateStats();
}

async function loadDoctors() {
    message("Loading doctors...", "info");
    try {
        const [doctorResult, departmentResult] = await Promise.all([
            window.clinicSupabase
                .from("doctors")
                .select("id, doctor_code, profile_id, full_name, email, phone, department_id, specialization, license_number, availability, created_at")
                .order("created_at", { ascending: false }),
            window.clinicSupabase.from("departments").select("id, name, status").order("name")
        ]);
        if (doctorResult.error) throw doctorResult.error;
        if (departmentResult.error) throw departmentResult.error;
        doctors = doctorResult.data || [];
        departments = departmentResult.data || [];
        updateFilters();
        fillSelect(doctorDepartment, "Select Department", departments.filter(d => d.status === "Active"), d => d.id, d => d.name);
        renderDoctors();
        message(doctors.length ? "" : "No doctors are registered yet.", doctors.length ? "" : "info");
        return true;
    } catch (error) {
        console.error("Unable to load doctors:", error);
        message(
            isMissingDirectoryColumn(error)
                ? "Doctor directory columns are missing. Apply the doctor directory SQL migration, then reload this page."
                : "Could not load doctors. Check your connection and database permissions.",
            "error"
        );
        return false;
    }
}

function openDoctorModal(doctor) {
    doctorForm.reset();
    editingDoctorId = doctor?.id || null;
    modalTitle.textContent = doctor ? "Edit Doctor" : "Add New Doctor";
    saveDoctorBtn.textContent = doctor ? "Update Doctor" : "Save Doctor";
    saveDoctorBtn.disabled = false;
    doctorModal.classList.add("show");
    if (doctor) {
        doctorFullName.value = doctor.full_name || "";
        doctorEmail.value = doctor.email || "";
        doctorPhone.value = doctor.phone || "";
        doctorDepartment.value = doctor.department_id || "";
        doctorSpecialization.value = doctor.specialization || "";
        doctorLicenseNumber.value = doctor.license_number || "";
        doctorAvailability.value = doctor.availability || "Available";
    }
}

function closeDoctorModal() {
    if (savingDoctor) return;
    doctorModal.classList.remove("show");
    doctorForm.reset();
    editingDoctorId = null;
}

function openViewModal(doctor) {
    const department = departmentFor(doctor);
    document.getElementById("doctorDetails").innerHTML = `
        <div class="doctor-detail-grid">
            <div class="detail-item full-width"><span>Full Name</span><strong>${escapeText(doctorNameFor(doctor))}</strong></div>
            <div class="detail-item"><span>Email Address</span><strong>${escapeText(doctor.email)}</strong></div>
            <div class="detail-item"><span>Doctor Code</span><strong>${escapeText(doctor.doctor_code)}</strong></div>
            <div class="detail-item"><span>Department</span><strong>${escapeText(department?.name)}</strong></div>
            <div class="detail-item full-width"><span>Specialization</span><strong>${escapeText(doctor.specialization)}</strong></div>
            <div class="detail-item"><span>Contact Number</span><strong>${escapeText(doctor.phone)}</strong></div>
            <div class="detail-item"><span>License Number</span><strong>${escapeText(doctor.license_number)}</strong></div>
            <div class="detail-item"><span>Availability</span><strong>${escapeText(doctor.availability)}</strong></div>
        </div>`;
    viewModal.classList.add("show");
}

function generateDoctorCode() {
    const year = new Date().getFullYear();
    const used = new Set(doctors.map(doctor => doctor.doctor_code));
    for (let i = 1; i <= 999; i += 1) {
        const code = `DOC-${year}-${String(i).padStart(3, "0")}`;
        if (!used.has(code)) return code;
    }
    throw new Error("No unused doctor codes remain for this year.");
}

doctorForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (savingDoctor) return;
    if (!doctorFullName.value.trim() || !doctorEmail.value.trim() || !doctorPhone.value.trim() ||
        !doctorDepartment.value || !doctorSpecialization.value.trim() ||
        !doctorLicenseNumber.value.trim() || !doctorAvailability.value) {
        message("Complete all required doctor information before saving.", "error");
        return;
    }
    savingDoctor = true;
    saveDoctorBtn.disabled = true;
    try {
        const data = {
            full_name: doctorFullName.value.trim(),
            email: doctorEmail.value.trim(),
            phone: doctorPhone.value.trim(),
            department_id: doctorDepartment.value,
            specialization: doctorSpecialization.value.trim(),
            license_number: doctorLicenseNumber.value.trim(),
            availability: doctorAvailability.value
        };
        const result = editingDoctorId
            ? await window.clinicSupabase.from("doctors").update(data).eq("id", editingDoctorId).select("*").maybeSingle()
            : await window.clinicSupabase.from("doctors").insert({ ...data, doctor_code: generateDoctorCode() }).select("*").single();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("The doctor was not saved; check your database permissions.");
        const loaded = await loadDoctors();
        message(loaded ? (editingDoctorId ? "Doctor updated successfully." : "Doctor added successfully.") : "Doctor saved, but the latest list could not be reloaded.", loaded ? "success" : "error");
        doctorModal.classList.remove("show");
        doctorForm.reset();
    } catch (error) {
        console.error("Unable to save doctor:", error);
        message(
            isMissingDirectoryColumn(error)
                ? "Doctor directory columns are missing. Apply the doctor directory SQL migration, then try again."
                : error.code === "23505"
                    ? "A doctor record conflicts with an existing unique value. Review the doctor code and license number."
                    : error.message || "Unable to save doctor.",
            "error"
        );
    } finally {
        savingDoctor = false;
        saveDoctorBtn.disabled = false;
    }
});

doctorTableBody.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const doctor = doctors.find(item => item.id === button.dataset.id);
    if (!doctor) return;
    if (button.dataset.action === "view") openViewModal(doctor);
    if (button.dataset.action === "edit") openDoctorModal(doctor);
    if (button.dataset.action === "delete" && window.confirm(`Delete ${doctorNameFor(doctor)}?`)) {
        button.disabled = true;
        try {
            const { error } = await window.clinicSupabase.from("doctors").delete().eq("id", doctor.id);
            if (error) throw error;
            const loaded = await loadDoctors();
            message(loaded ? "Doctor deleted successfully." : "Doctor deleted, but the latest list could not be reloaded.", loaded ? "success" : "error");
        } catch (error) {
            console.error("Unable to delete doctor:", error);
            message(error.code === "23503" ? "This doctor is assigned to appointments, queue entries, or consultations and cannot be deleted." : error.message || "Unable to delete doctor.", "error");
            button.disabled = false;
        }
    }
});

document.getElementById("addDoctorBtn").addEventListener("click", () => openDoctorModal());
document.getElementById("closeModalBtn").addEventListener("click", closeDoctorModal);
document.getElementById("cancelModalBtn").addEventListener("click", closeDoctorModal);
document.getElementById("closeViewModalBtn").addEventListener("click", () => viewModal.classList.remove("show"));
document.getElementById("closeViewBtn").addEventListener("click", () => viewModal.classList.remove("show"));
doctorModal.addEventListener("click", event => { if (event.target === doctorModal) closeDoctorModal(); });
viewModal.addEventListener("click", event => { if (event.target === viewModal) viewModal.classList.remove("show"); });
document.getElementById("searchInput").addEventListener("input", renderDoctors);
document.getElementById("departmentFilter").addEventListener("change", renderDoctors);
document.getElementById("availabilityFilter").addEventListener("change", renderDoctors);

document.getElementById("exportBtn").addEventListener("click", () => {
    if (!doctors.length) return message("No doctor records are available to export.", "info");
    const csvRows = [["Doctor UUID", "Doctor Code", "Name", "Email", "Phone", "Department", "Specialization", "License Number", "Availability"],
        ...doctors.map(doctor => [doctor.id, doctor.doctor_code, doctorNameFor(doctor), doctor.email, doctor.phone, departmentFor(doctor)?.name, doctor.specialization, doctor.license_number, doctor.availability])];
    const csv = csvRows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url; link.download = "cliniccare-doctors.csv"; link.click(); URL.revokeObjectURL(url);
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

loadDoctors();
