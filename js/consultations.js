const consultationTableBody = document.getElementById("consultationTableBody");
const consultationModal = document.getElementById("consultationModal");
const viewModal = document.getElementById("viewModal");
const consultationForm = document.getElementById("consultationForm");
const consultationId = document.getElementById("consultationId");
const patientName = document.getElementById("patientName");
const patientId = document.getElementById("patientId");
const doctorName = document.getElementById("doctorName");
const departmentName = document.getElementById("departmentName");
const appointmentId = document.getElementById("appointmentId");
const queueEntryId = document.getElementById("queueEntryId");
const consultationDate = document.getElementById("consultationDate");
const symptoms = document.getElementById("symptoms");
const diagnosis = document.getElementById("diagnosis");
const treatment = document.getElementById("treatment");
const notes = document.getElementById("notes");
const consultationStatus = document.getElementById("consultationStatus");
const saveConsultationBtn = document.getElementById("saveConsultationBtn");
const feedback = document.createElement("div");
feedback.setAttribute("role", "status");
feedback.setAttribute("aria-live", "polite");
feedback.style.cssText = "display:none;margin:14px 0;padding:11px 14px;border-radius:8px;font-size:13px;";
document.querySelector(".content-card").prepend(feedback);

let consultations = [];
let patients = [];
let doctors = [];
let profiles = [];
let departments = [];
let appointments = [];
let queueEntries = [];
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

function fillSelect(select, placeholder, rows, idOf, labelOf) {
    select.replaceChildren(new Option(placeholder, ""));
    rows.forEach(row => select.add(new Option(labelOf(row), idOf(row))));
}

const patientFor = id => patients.find(item => item.id === id);
const doctorFor = id => doctors.find(item => item.id === id);
const departmentFor = id => departments.find(item => item.id === id);
const profileForDoctor = doctor => profiles.find(item => item.id === doctor?.profile_id);
const doctorLabel = doctor => doctor?.full_name || profileForDoctor(doctor)?.full_name || doctor?.doctor_code || "Doctor unavailable";
const dateOnly = value => String(value || "").slice(0, 10);
const formatDate = value => dateOnly(value)
    ? new Date(`${dateOnly(value)}T00:00:00`).toLocaleDateString("en-US")
    : "—";

function updateStats() {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById("totalConsultations").textContent = consultations.length;
    document.getElementById("inProgressConsultations").textContent =
        consultations.filter(item => item.status === "In Progress").length;
    document.getElementById("completedConsultations").textContent =
        consultations.filter(item => item.status === "Completed").length;
    document.getElementById("todayConsultations").textContent =
        consultations.filter(item => dateOnly(item.consultation_date) === today).length;
}

function renderConsultations() {
    const term = document.getElementById("searchInput").value.trim().toLowerCase();
    const selectedDoctor = document.getElementById("doctorFilter").value;
    const selectedDepartment = document.getElementById("departmentFilter").value;
    const selectedStatus = document.getElementById("statusFilter").value;
    const filtered = consultations.filter(item => {
        const patient = patientFor(item.patient_id);
        const doctor = doctorFor(item.doctor_id);
        return (!term || [item.consultation_code, patient?.full_name, patient?.patient_code, doctorLabel(doctor)]
            .some(value => String(value || "").toLowerCase().includes(term))) &&
            (!selectedDoctor || item.doctor_id === selectedDoctor) &&
            (!selectedDepartment || item.department_id === selectedDepartment) &&
            (!selectedStatus || item.status === selectedStatus);
    });

    consultationTableBody.replaceChildren();
    filtered.forEach(item => {
        const patient = patientFor(item.patient_id);
        const doctor = doctorFor(item.doctor_id);
        const department = departmentFor(item.department_id);
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><span class="consultation-id">${escapeText(item.consultation_code)}</span></td>
            <td><span class="patient-name">${escapeText(patient?.full_name || "Patient unavailable")}</span></td>
            <td class="doctor-cell">${escapeText(doctorLabel(doctor))}</td>
            <td class="department-cell">${escapeText(department?.name)}</td>
            <td>${formatDate(item.consultation_date)}</td>
            <td><span class="status-badge ${item.status === "Completed" ? "status-completed" : "status-progress"}">${escapeText(item.status)}</span></td>
            <td><div class="action-buttons">
                <button class="action-btn view-btn" data-action="view" data-id="${item.id}">View</button>
                <button class="action-btn edit-btn" data-action="edit" data-id="${item.id}">Edit</button>
                <button class="action-btn delete-btn" data-action="delete" data-id="${item.id}">Delete</button>
            </div></td>`;
        consultationTableBody.appendChild(row);
    });
    document.getElementById("tableCount").textContent = `Showing ${filtered.length} consultations`;
    if (!filtered.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 7;
        cell.className = "empty-state";
        cell.textContent = consultations.length ? "No consultations match these filters." : "No consultation records found.";
        row.appendChild(cell);
        consultationTableBody.appendChild(row);
    }
    updateStats();
}

async function loadConsultations() {
    message("Loading consultation records...", "info");
    try {
        const results = await Promise.all([
            window.clinicSupabase.from("consultations").select("*").order("consultation_date", { ascending: false }),
            window.clinicSupabase.from("patients").select("id, patient_code, full_name"),
            window.clinicSupabase.from("doctors").select("id, doctor_code, full_name, profile_id, department_id"),
            window.clinicSupabase.from("profiles").select("id, full_name, role").eq("role", "doctor"),
            window.clinicSupabase.from("departments").select("id, name"),
            window.clinicSupabase.from("appointments").select("id, appointment_code, patient_id, doctor_id, department_id"),
            window.clinicSupabase.from("queue_entries").select("id, queue_number, patient_id, doctor_id, department_id, appointment_id, status")
        ]);
        const failed = results.find(result => result.error);
        if (failed) throw failed.error;
        [consultations, patients, doctors, profiles, departments, appointments, queueEntries] =
            results.map(result => result.data || []);

        fillSelect(patientName, "Select Patient", patients, item => item.id, item => `${item.full_name} (${item.patient_code})`);
        fillSelect(doctorName, "Select Doctor", doctors, item => item.id, doctorLabel);
        fillSelect(departmentName, "Select Department", departments, item => item.id, item => item.name);
        fillSelect(document.getElementById("doctorFilter"), "All Doctors", doctors, item => item.id, doctorLabel);
        fillSelect(document.getElementById("departmentFilter"), "All Departments", departments, item => item.id, item => item.name);
        fillSelect(appointmentId, "No linked appointment", appointments, item => item.id, item => item.appointment_code);
        fillSelect(queueEntryId, "No linked queue entry", queueEntries, item => item.id, item => `${item.queue_number} — ${item.status}`);
        renderConsultations();
        message(consultations.length ? "" : "No consultation records found.", consultations.length ? "" : "info");
        return true;
    } catch (error) {
        console.error("Unable to load consultations:", error);
        message("Could not load consultation or related records. Check your connection and database permissions.", "error");
        return false;
    }
}

function syncPatientCode() {
    patientId.value = patientFor(patientName.value)?.patient_code || "";
}

function resetForm() {
    consultationForm.reset();
    consultationId.value = "";
    syncPatientCode();
    document.getElementById("modalTitle").textContent = "New Consultation";
    saveConsultationBtn.textContent = "Save Consultation";
}

function closeConsultationModal() {
    if (saving) return;
    consultationModal.classList.remove("show");
    resetForm();
}

function openConsultationModal(item) {
    resetForm();
    if (item) {
        consultationId.value = item.id;
        patientName.value = item.patient_id;
        syncPatientCode();
        doctorName.value = item.doctor_id;
        departmentName.value = item.department_id;
        appointmentId.value = item.appointment_id || "";
        queueEntryId.value = item.queue_entry_id || "";
        consultationDate.value = dateOnly(item.consultation_date);
        symptoms.value = item.symptoms || "";
        diagnosis.value = item.diagnosis || "";
        treatment.value = item.treatment || "";
        notes.value = item.notes || "";
        consultationStatus.value = item.status;
        document.getElementById("modalTitle").textContent = "Edit Consultation";
        saveConsultationBtn.textContent = "Save Changes";
    } else {
        consultationDate.value = new Date().toISOString().slice(0, 10);
    }
    consultationModal.classList.add("show");
}

function nextConsultationCode() {
    const year = new Date().getFullYear();
    const used = new Set(consultations.map(item => item.consultation_code));
    for (let i = 1; i <= 9999; i += 1) {
        const code = `CON-${year}-${String(i).padStart(3, "0")}`;
        if (!used.has(code)) return code;
    }
    throw new Error("No unused consultation codes remain for this year.");
}

function viewConsultation(item) {
    const patient = patientFor(item.patient_id);
    const doctor = doctorFor(item.doctor_id);
    const department = departmentFor(item.department_id);
    const details = document.getElementById("consultationDetails");
    const fields = [
        ["Consultation Code", item.consultation_code],
        ["Patient", patient?.full_name],
        ["Patient Code", patient?.patient_code],
        ["Doctor", doctorLabel(doctor)],
        ["Department", department?.name],
        ["Appointment", appointments.find(row => row.id === item.appointment_id)?.appointment_code],
        ["Queue Entry", queueEntries.find(row => row.id === item.queue_entry_id)?.queue_number],
        ["Date", formatDate(item.consultation_date)],
        ["Status", item.status],
        ["Symptoms", item.symptoms],
        ["Diagnosis", item.diagnosis],
        ["Treatment", item.treatment],
        ["Notes", item.notes]
    ];
    details.replaceChildren();
    fields.forEach(([label, value]) => {
        const element = document.createElement("div");
        element.className = "detail-item";
        const name = document.createElement("span");
        name.textContent = label;
        const content = document.createElement("strong");
        content.textContent = value || "Not provided";
        element.append(name, content);
        details.appendChild(element);
    });
    viewModal.classList.add("show");
}

consultationForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    saveConsultationBtn.disabled = true;
    try {
        const patient = patientFor(patientName.value);
        const doctor = doctorFor(doctorName.value);
        if (!patient || !doctor || doctor.department_id !== departmentName.value) {
            throw new Error("Select an existing patient, doctor, and the doctor's department.");
        }
        const linkedAppointment = appointmentId.value ? appointments.find(item => item.id === appointmentId.value) : null;
        const linkedQueue = queueEntryId.value ? queueEntries.find(item => item.id === queueEntryId.value) : null;
        for (const related of [linkedAppointment, linkedQueue]) {
            if (related && (
                related.patient_id !== patient.id ||
                related.doctor_id !== doctor.id ||
                related.department_id !== departmentName.value
            )) {
                throw new Error("Linked appointment and queue entry must match the selected patient, doctor, and department.");
            }
        }
        const payload = {
            patient_id: patient.id,
            doctor_id: doctor.id,
            department_id: departmentName.value,
            appointment_id: linkedAppointment?.id || null,
            queue_entry_id: linkedQueue?.id || null,
            symptoms: symptoms.value.trim(),
            diagnosis: diagnosis.value.trim() || null,
            treatment: treatment.value.trim() || null,
            notes: notes.value.trim() || null,
            status: consultationStatus.value,
            consultation_date: consultationDate.value
        };
        const id = consultationId.value;
        const result = id
            ? await window.clinicSupabase.from("consultations").update(payload).eq("id", id).select("*").maybeSingle()
            : await window.clinicSupabase.from("consultations").insert({ ...payload, consultation_code: nextConsultationCode() }).select("*").single();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("The consultation was not saved; check your database permissions.");
        consultationModal.classList.remove("show");
        const loaded = await loadConsultations();
        message(loaded ? (id ? "Consultation updated successfully." : "Consultation added successfully.") : "Consultation saved, but the latest list could not be reloaded.", loaded ? "success" : "error");
    } catch (error) {
        console.error("Unable to save consultation:", error);
        message(error.code === "23503" ? "A linked patient, doctor, department, appointment, or queue entry is no longer available." : error.code === "23505" ? "That consultation code already exists. Reload and retry." : error.message || "Unable to save consultation.", "error");
    } finally {
        saving = false;
        saveConsultationBtn.disabled = false;
    }
});

consultationTableBody.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const item = consultations.find(record => record.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === "view") viewConsultation(item);
    if (button.dataset.action === "edit") openConsultationModal(item);
    if (button.dataset.action === "delete" && window.confirm(`Delete consultation ${item.consultation_code}?`)) {
        button.disabled = true;
        try {
            const { error } = await window.clinicSupabase.from("consultations").delete().eq("id", item.id);
            if (error) throw error;
            const loaded = await loadConsultations();
            message(loaded ? "Consultation deleted successfully." : "Consultation deleted, but the latest list could not be reloaded.", loaded ? "success" : "error");
        } catch (error) {
            console.error("Unable to delete consultation:", error);
            message(error.code === "23503" ? "This consultation is referenced by another record and cannot be deleted." : error.message || "Unable to delete consultation.", "error");
            button.disabled = false;
        }
    }
});

patientName.addEventListener("change", syncPatientCode);
doctorName.addEventListener("change", () => {
    const doctor = doctorFor(doctorName.value);
    if (doctor) departmentName.value = doctor.department_id || "";
});
document.getElementById("addConsultationBtn").addEventListener("click", () => openConsultationModal());
document.getElementById("closeModalBtn").addEventListener("click", closeConsultationModal);
document.getElementById("cancelModalBtn").addEventListener("click", closeConsultationModal);
document.getElementById("closeViewBtn").addEventListener("click", () => viewModal.classList.remove("show"));
document.getElementById("closeDetailsBtn").addEventListener("click", () => viewModal.classList.remove("show"));
consultationModal.addEventListener("click", event => { if (event.target === consultationModal) closeConsultationModal(); });
viewModal.addEventListener("click", event => { if (event.target === viewModal) viewModal.classList.remove("show"); });
document.getElementById("searchInput").addEventListener("input", renderConsultations);
document.getElementById("doctorFilter").addEventListener("change", renderConsultations);
document.getElementById("departmentFilter").addEventListener("change", renderConsultations);
document.getElementById("statusFilter").addEventListener("change", renderConsultations);
document.getElementById("exportBtn").addEventListener("click", () => {
    if (!consultations.length) return message("No consultation records are available to export.", "info");
    const rows = [["UUID", "Consultation Code", "Patient", "Doctor", "Department", "Appointment", "Queue Entry", "Date", "Symptoms", "Diagnosis", "Treatment", "Notes", "Status"],
        ...consultations.map(item => [item.id, item.consultation_code, patientFor(item.patient_id)?.full_name, doctorLabel(doctorFor(item.doctor_id)), departmentFor(item.department_id)?.name, appointments.find(row => row.id === item.appointment_id)?.appointment_code, queueEntries.find(row => row.id === item.queue_entry_id)?.queue_number, dateOnly(item.consultation_date), item.symptoms, item.diagnosis, item.treatment, item.notes, item.status])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = "cliniccare-consultations.csv"; link.click(); URL.revokeObjectURL(url);
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
loadConsultations();
