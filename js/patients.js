const patientTableBody = document.getElementById("patientTableBody");
const patientModal = document.getElementById("patientModal");
const patientForm = document.getElementById("patientForm");

const addPatientBtn = document.getElementById("addPatientBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelModalBtn = document.getElementById("cancelModalBtn");
const savePatientBtn = patientForm.querySelector('button[type="submit"]');

const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const genderFilter = document.getElementById("genderFilter");

const totalPatients = document.getElementById("totalPatients");
const newPatients = document.getElementById("newPatients");
const activePatients = document.getElementById("activePatients");
const pendingPatients = document.getElementById("pendingPatients");
const patientCount = document.getElementById("patientCount");
const emptyState = document.getElementById("emptyState");
const emptyStateText = document.getElementById("emptyStateText");
const patientFeedback = document.getElementById("patientFeedback");

const patientName = document.getElementById("patientName");
const patientGender = document.getElementById("patientGender");
const patientBirthDate = document.getElementById("patientBirthDate");
const patientStatus = document.getElementById("patientStatus");
const patientPhone = document.getElementById("patientPhone");
const patientEmail = document.getElementById("patientEmail");
const patientAddress = document.getElementById("patientAddress");

let patients = [];
let editingPatientId = null;
let isLoading = false;
let isSaving = false;

function showFeedback(message, type) {
    patientFeedback.textContent = message;
    patientFeedback.className = `patient-feedback ${type || "info"}`;
    patientFeedback.hidden = !message;
}

function getInitials(name) {
    return String(name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join("") || "P";
}

function getAvatarClass(index) {
    return ["avatar-one", "avatar-two", "avatar-three", "avatar-four"][
        index % 4
    ];
}

function getAge(birthDate) {
    if (!birthDate) return "";

    const [year, month, day] = birthDate.split("-").map(Number);
    if (!year || !month || !day) return "";

    const today = new Date();
    let age = today.getFullYear() - year;
    if (
        today.getMonth() + 1 < month ||
        (today.getMonth() + 1 === month && today.getDate() < day)
    ) {
        age -= 1;
    }

    return age >= 0 ? age : "";
}

function formatValue(value) {
    return value === null || value === undefined || value === ""
        ? "—"
        : String(value);
}

function updateStatistics() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    totalPatients.textContent = String(patients.length);
    newPatients.textContent = String(patients.filter(patient => {
        if (!patient.created_at) return false;
        const createdAt = new Date(patient.created_at);
        return createdAt >= monthStart && createdAt < nextMonthStart;
    }).length);
    activePatients.textContent = String(patients.filter(patient =>
        String(patient.status || "").toLowerCase() === "active"
    ).length);
    pendingPatients.textContent = String(patients.filter(patient =>
        String(patient.status || "").toLowerCase() === "pending"
    ).length);
}

function createCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = formatValue(value);
    row.appendChild(cell);
    return cell;
}

function createActionButton(action, patientId, title, iconClass, actionClass) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action-btn ${actionClass}`;
    button.dataset.action = action;
    button.dataset.patientId = patientId;
    button.title = title;
    button.setAttribute("aria-label", `${title} patient`);

    const icon = document.createElement("i");
    icon.className = iconClass;
    button.appendChild(icon);
    return button;
}

function renderPatients() {
    const searchTerm = searchInput.value.trim().toLowerCase();
    const selectedStatus = statusFilter.value.toLowerCase();
    const selectedGender = genderFilter.value.toLowerCase();

    const filteredPatients = patients.filter(patient => {
        const matchesSearch = [
            patient.full_name,
            patient.patient_code,
            patient.email,
            patient.phone
        ].some(value => String(value || "").toLowerCase().includes(searchTerm));

        const matchesStatus = selectedStatus === "all" ||
            String(patient.status || "").toLowerCase() === selectedStatus;
        const matchesGender = selectedGender === "all" ||
            String(patient.gender || "").toLowerCase() === selectedGender;

        return matchesSearch && matchesStatus && matchesGender;
    });

    patientTableBody.replaceChildren();

    filteredPatients.forEach((patient, index) => {
        const row = document.createElement("tr");
        createCell(row, patient.patient_code);

        const nameCell = document.createElement("td");
        const patientCell = document.createElement("div");
        patientCell.className = "patient-cell";

        const avatar = document.createElement("div");
        avatar.className = `patient-avatar ${getAvatarClass(index)}`;
        avatar.textContent = getInitials(patient.full_name);

        const nameDetails = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = formatValue(patient.full_name);
        const caption = document.createElement("span");
        caption.textContent = "Registered Patient";
        nameDetails.append(name, caption);
        patientCell.append(avatar, nameDetails);
        nameCell.appendChild(patientCell);
        row.appendChild(nameCell);

        createCell(row, patient.gender);
        createCell(row, getAge(patient.birth_date));
        createCell(row, patient.phone);
        createCell(row, patient.email);

        const statusCell = document.createElement("td");
        const status = document.createElement("span");
        const isActive = String(patient.status || "").toLowerCase() === "active";
        status.className = `status ${isActive ? "active-status" : "inactive-status"}`;
        status.textContent = formatValue(patient.status);
        statusCell.appendChild(status);
        row.appendChild(statusCell);

        const actions = document.createElement("td");
        actions.append(
            createActionButton("view", patient.id, "View", "fa-regular fa-eye", "view-action"),
            createActionButton("edit", patient.id, "Edit", "fa-regular fa-pen-to-square", "edit-action"),
            createActionButton("delete", patient.id, "Delete", "fa-regular fa-trash-can", "delete-action")
        );
        row.appendChild(actions);
        patientTableBody.appendChild(row);
    });

    updateStatistics();
    patientCount.textContent = isLoading
        ? "Loading patients..."
        : `Showing ${filteredPatients.length} of ${patients.length} patients`;

    emptyState.hidden = isLoading || filteredPatients.length > 0;
    if (patients.length === 0) {
        emptyStateText.textContent = "No patient records are available yet.";
    } else {
        emptyStateText.textContent = "Try changing your search or filters.";
    }
}

async function loadPatients() {
    if (!window.clinicSupabase) {
        isLoading = false;
        renderPatients();
        showFeedback("Supabase is unavailable. Please refresh and try again.", "error");
        return;
    }

    isLoading = true;
    renderPatients();
    showFeedback("Loading patient records...", "info");

    try {
        const { data: sessionData, error: sessionError } =
            await window.clinicSupabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session) {
            showFeedback("Your session has expired. Please sign in again.", "error");
            return false;
        }

        const { data, error } = await window.clinicSupabase
            .from("patients")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) throw error;

        patients = data || [];
        showFeedback(
            patients.length ? "" : "No patient records found.",
            patients.length ? "" : "info"
        );
        return true;
    } catch (error) {
        console.error("Unable to load patient records:", error);
        patients = [];
        showFeedback(
            "Patient records could not be loaded. Check your connection and access permissions, then try again.",
            "error"
        );
        return false;
    } finally {
        isLoading = false;
        renderPatients();
    }
}

function setFormMode(isEditing) {
    document.querySelector(".modal-header h2").textContent =
        isEditing ? "Edit Patient" : "Add New Patient";
    savePatientBtn.innerHTML = isEditing
        ? '<i class="fa-solid fa-floppy-disk"></i> Save Changes'
        : '<i class="fa-solid fa-plus"></i> Add Patient';
}

function openModal() {
    patientModal.classList.add("show");
    patientModal.setAttribute("aria-hidden", "false");
}

function closeModal() {
    if (isSaving) return;
    patientModal.classList.remove("show");
    patientModal.setAttribute("aria-hidden", "true");
    patientForm.reset();
    editingPatientId = null;
    setFormMode(false);
}

function resetModalForAdd() {
    patientForm.reset();
    editingPatientId = null;
    patientStatus.value = "Active";
    setFormMode(false);
    openModal();
}

function editPatient(id) {
    const patient = patients.find(item => item.id === id);
    if (!patient) return;

    [[patientGender, patient.gender], [patientStatus, patient.status]]
        .forEach(([select, value]) => {
            if (value && !Array.from(select.options).some(option => option.value === value)) {
                select.add(new Option(value, value));
            }
        });

    editingPatientId = patient.id;
    patientName.value = patient.full_name || "";
    patientGender.value = patient.gender || "";
    patientBirthDate.value = patient.birth_date || "";
    patientStatus.value = patient.status || "Active";
    patientPhone.value = patient.phone || "";
    patientEmail.value = patient.email || "";
    patientAddress.value = patient.address || "";
    setFormMode(true);
    openModal();
}

function viewPatient(id) {
    const patient = patients.find(item => item.id === id);
    if (!patient) return;

    window.alert(
        `PATIENT DETAILS\n\n` +
        `Patient UUID: ${formatValue(patient.id)}\n` +
        `Patient Code: ${formatValue(patient.patient_code)}\n` +
        `Name: ${formatValue(patient.full_name)}\n` +
        `Email: ${formatValue(patient.email)}\n` +
        `Phone: ${formatValue(patient.phone)}\n` +
        `Gender: ${formatValue(patient.gender)}\n` +
        `Birth Date: ${formatValue(patient.birth_date)}\n` +
        `Age: ${formatValue(getAge(patient.birth_date))}\n` +
        `Address: ${formatValue(patient.address)}\n` +
        `Status: ${formatValue(patient.status)}\n` +
        `Created: ${formatValue(patient.created_at)}`
    );
}

function isDuplicateCodeError(error) {
    return error.code === "23505" ||
        /unique constraint|duplicate key/i.test(error.message || "");
}

async function generatePatientCode() {
    const year = new Date().getFullYear();
    const prefix = `CC-${year}-`;
    const { data, error } = await window.clinicSupabase
        .from("patients")
        .select("patient_code")
        .like("patient_code", `${prefix}%`);

    if (error) throw error;

    const usedNumbers = new Set((data || []).map(patient => {
        const match = String(patient.patient_code || "").match(
            new RegExp(`^CC-${year}-(\\d+)$`)
        );
        return match ? Number(match[1]) : null;
    }).filter(Number.isInteger));

    for (let number = 1; number <= 999; number += 1) {
        if (!usedNumbers.has(number)) {
            return `${prefix}${String(number).padStart(3, "0")}`;
        }
    }

    throw new Error(`No unused patient codes remain for ${year}.`);
}

function getFormPatientData() {
    return {
        full_name: patientName.value.trim(),
        email: patientEmail.value.trim(),
        phone: patientPhone.value.trim(),
        gender: patientGender.value,
        birth_date: patientBirthDate.value,
        address: patientAddress.value.trim(),
        status: patientStatus.value
    };
}

async function savePatient(event) {
    event.preventDefault();
    if (isSaving) return;

    if (!window.clinicSupabase) {
        showFeedback("Supabase is unavailable. Please refresh and try again.", "error");
        return;
    }

    const existingPatient = editingPatientId
        ? patients.find(item => item.id === editingPatientId)
        : null;
    if (editingPatientId && !existingPatient) {
        showFeedback("This patient record is no longer available. Reload the page and try again.", "error");
        return;
    }

    isSaving = true;
    savePatientBtn.disabled = true;
    savePatientBtn.setAttribute("aria-busy", "true");
    addPatientBtn.disabled = true;

    try {
        const sessionResult = await window.clinicSupabase.auth.getSession();
        if (sessionResult.error) throw sessionResult.error;
        if (!sessionResult.data.session) {
            throw new Error("Your session has expired. Please sign in again.");
        }

        const patientData = getFormPatientData();
        if (editingPatientId) {
            const { data, error } = await window.clinicSupabase
                .from("patients")
                .update(patientData)
                .eq("id", editingPatientId)
                .select("*")
                .maybeSingle();

            if (error) throw error;
            if (!data) {
                throw new Error("The patient was not updated. Check your access permissions and try again.");
            }

            const refreshed = await loadPatients();
            if (refreshed) {
                showFeedback("Patient information updated successfully.", "success");
            }
        } else {
            let insertedPatient = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
                const patientCode = await generatePatientCode();
                const { data, error } = await window.clinicSupabase
                    .from("patients")
                    .insert({ ...patientData, patient_code: patientCode })
                    .select("*")
                    .single();

                if (!error) {
                    insertedPatient = data;
                    break;
                }

                if (!isDuplicateCodeError(error) || attempt === 1) {
                    throw error;
                }
            }

            if (!insertedPatient) {
                throw new Error("Could not create a unique patient code. Please try again.");
            }
            const refreshed = await loadPatients();
            if (refreshed) {
                showFeedback("New patient added successfully.", "success");
            }
        }

        closeModalAfterSave();
    } catch (error) {
        console.error("Unable to save patient record:", error);
        showFeedback(
            /foreign key|referenced|still referenced/i.test(error.message || "")
                ? "This patient record could not be saved because another record depends on it."
                : error.message || "Patient information could not be saved. Check your access permissions and try again.",
            "error"
        );
    } finally {
        isSaving = false;
        savePatientBtn.disabled = false;
        savePatientBtn.removeAttribute("aria-busy");
        addPatientBtn.disabled = false;
    }
}

function closeModalAfterSave() {
    patientModal.classList.remove("show");
    patientModal.setAttribute("aria-hidden", "true");
    patientForm.reset();
    editingPatientId = null;
    setFormMode(false);
}

async function deletePatient(id) {
    const patient = patients.find(item => item.id === id);
    if (!patient) return;

    if (!window.confirm(`Are you sure you want to delete ${patient.full_name}?`)) {
        return;
    }

    const button = Array.from(
        patientTableBody.querySelectorAll('button[data-action="delete"]')
    ).find(item => item.dataset.patientId === id);
    if (button) button.disabled = true;

    try {
        const { data, error } = await window.clinicSupabase
            .from("patients")
            .delete()
            .eq("id", id)
            .select("id");

        if (error) {
            if (/foreign key|referenced|still referenced/i.test(error.message || "")) {
                throw new Error("This patient cannot be deleted because related appointments or records still exist.");
            }
            throw error;
        }
        if (!data || data.length === 0) {
            throw new Error("This patient could not be deleted. You may not have permission, or related records may depend on it.");
        }

        if (await loadPatients()) {
            showFeedback("Patient record deleted successfully.", "success");
        }
    } catch (error) {
        console.error("Unable to delete patient record:", error);
        showFeedback(error.message || "Patient could not be deleted. Please try again.", "error");
        if (button) button.disabled = false;
    }
}

function exportPatients() {
    if (patients.length === 0) {
        showFeedback("There are no patient records available to export.", "info");
        return;
    }

    const headers = [
        "Patient UUID",
        "Patient Code",
        "User UUID",
        "Full Name",
        "Email",
        "Phone",
        "Gender",
        "Birth Date",
        "Address",
        "Status",
        "Created At"
    ];
    const rows = patients.map(patient => [
        patient.id,
        patient.patient_code,
        patient.user_id,
        patient.full_name,
        patient.email,
        patient.phone,
        patient.gender,
        patient.birth_date,
        patient.address,
        patient.status,
        patient.created_at
    ]);
    const escapeCSV = value =>
        `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csvContent = [
        headers.map(escapeCSV).join(","),
        ...rows.map(row => row.map(escapeCSV).join(","))
    ].join("\r\n");
    const blob = new Blob(["\uFEFF" + csvContent], {
        type: "text/csv;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cliniccare-patients.csv";
    link.click();
    URL.revokeObjectURL(url);
}

addPatientBtn.addEventListener("click", resetModalForAdd);
closeModalBtn.addEventListener("click", closeModal);
cancelModalBtn.addEventListener("click", closeModal);

patientModal.addEventListener("click", event => {
    if (event.target === patientModal) closeModal();
});

patientForm.addEventListener("submit", savePatient);
searchInput.addEventListener("input", renderPatients);
statusFilter.addEventListener("change", renderPatients);
genderFilter.addEventListener("change", renderPatients);

patientTableBody.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const { action, patientId } = button.dataset;
    if (action === "view") viewPatient(patientId);
    if (action === "edit") editPatient(patientId);
    if (action === "delete") deletePatient(patientId);
});

document.getElementById("exportBtn").addEventListener("click", exportPatients);

const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
if (sidebar) {
    sidebar.scrollTop = 0;
    window.addEventListener("pageshow", () => {
        sidebar.scrollTop = 0;
    });
}
if (menuToggle && sidebar) {
    menuToggle.addEventListener("click", () => {
        sidebar.classList.toggle("open");
        if (sidebar.classList.contains("open")) sidebar.scrollTop = 0;
    });
}

const dateElement = document.getElementById("currentDate");
if (dateElement) {
    dateElement.textContent = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

const today = new Date();
patientBirthDate.max = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
].join("-");

patientModal.setAttribute("aria-hidden", "true");
renderPatients();
loadPatients();

console.log("ClinicCare Patients Management Loaded!");
