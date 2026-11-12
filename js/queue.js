const queueTableBody = document.getElementById("queueTableBody");
const queueModal = document.getElementById("queueModal");
const queueForm = document.getElementById("queueForm");
const queuePatient = document.getElementById("queuePatient");
const queueDepartment = document.getElementById("queueDepartment");
const queueDoctor = document.getElementById("queueDoctor");
const queueAppointment = document.getElementById("queueAppointment");
const queuePriority = document.getElementById("queuePriority");
const saveQueueBtn = queueForm.querySelector('button[type="submit"]');
const feedback = document.createElement("div");
feedback.className = "queue-feedback";
feedback.setAttribute("role", "status");
feedback.setAttribute("aria-live", "polite");
feedback.hidden = true;
document.querySelector(".queue-panel").prepend(feedback);

let queueEntries = [];
let patients = [];
let doctors = [];
let profiles = [];
let departments = [];
let appointments = [];
let actionInProgress = false;
const queueOrder = new window.ClinicCareDomain.ClinicFifoQueue();

function message(text, type) {
    feedback.textContent = text;
    feedback.hidden = !text;
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
const appointmentFor = id => appointments.find(item => item.id === id);
const profileForDoctor = doctor => profiles.find(item => item.id === doctor?.profile_id);
const doctorLabel = doctor => doctor?.full_name || profileForDoctor(doctor)?.full_name || doctor?.doctor_code || "Doctor unavailable";
const dateToday = () => new Date().toISOString().slice(0, 10);
const createdTime = value => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

function orderFIFO(records) {
    queueOrder.replace(records);
    return queueOrder.sort((a, b) => {
        const timeDifference = new Date(a.created_at || 0) - new Date(b.created_at || 0);
        return timeDifference || String(a.id).localeCompare(String(b.id));
    });
}

function updateStats() {
    document.getElementById("totalQueue").textContent = queueEntries.length;
    document.getElementById("waitingCount").textContent = queueEntries.filter(item => item.status === "Waiting").length;
    document.getElementById("consultationCount").textContent = queueEntries.filter(item => item.status === "In Consultation").length;
    document.getElementById("completedCount").textContent = queueEntries.filter(item => item.status === "Completed").length;
}

function renderQueue() {
    const term = document.getElementById("searchInput").value.trim().toLowerCase();
    const selectedStatus = document.getElementById("statusFilter").value;
    const selectedDepartment = document.getElementById("departmentFilter").value;
    const filtered = queueEntries.filter(item => {
        const patient = patientFor(item.patient_id);
        const doctor = doctorFor(item.doctor_id);
        return (!term || [item.queue_number, patient?.full_name, patient?.patient_code, doctorLabel(doctor)]
            .some(value => String(value || "").toLowerCase().includes(term))) &&
            (selectedStatus === "All" || item.status === selectedStatus) &&
            (selectedDepartment === "All" || item.department_id === selectedDepartment);
    });

    queueTableBody.replaceChildren();
    orderFIFO(filtered).forEach(item => {
        const patient = patientFor(item.patient_id);
        const doctor = doctorFor(item.doctor_id);
        const department = departmentFor(item.department_id);
        const actions = item.status === "Waiting"
            ? `<button class="action-btn" data-action="call" data-id="${item.id}">Call</button><button class="action-btn" data-action="skip" data-id="${item.id}">Skip</button>`
            : item.status === "In Consultation"
                ? `<button class="action-btn" data-action="complete" data-id="${item.id}">Complete</button>`
                : item.status === "Skipped"
                    ? `<button class="action-btn" data-action="requeue" data-id="${item.id}">Requeue</button>`
                    : "—";
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="queue-number">${escapeText(item.queue_number)}</td>
            <td class="patient-name">${escapeText(patient?.full_name || "Patient unavailable")}</td>
            <td>${escapeText(department?.name)}</td>
            <td>${escapeText(doctorLabel(doctor))}</td>
            <td>${createdTime(item.called_at || item.created_at)}</td>
            <td><span class="priority-badge priority-${String(item.priority || "").toLowerCase()}">${escapeText(item.priority)}</span></td>
            <td><span class="status-badge status-${String(item.status || "").toLowerCase().replaceAll(" ", "-")}">${escapeText(item.status)}</span></td>
            <td>${actions}</td>`;
        queueTableBody.appendChild(row);
    });
    document.getElementById("emptyState").style.display = filtered.length ? "none" : "block";
    updateStats();
}

async function loadQueue() {
    message("Loading queue records...", "info");
    try {
        const results = await Promise.all([
            window.clinicSupabase.from("queue_entries").select("*").order("created_at", { ascending: true }),
            window.clinicSupabase.from("patients").select("id, patient_code, full_name"),
            window.clinicSupabase.from("doctors").select("id, doctor_code, full_name, profile_id, department_id"),
            window.clinicSupabase.from("profiles").select("id, full_name, role").eq("role", "doctor"),
            window.clinicSupabase.from("departments").select("id, name, status").order("name"),
            window.clinicSupabase.from("appointments").select("id, appointment_code, patient_id, doctor_id, department_id, appointment_date")
        ]);
        const failed = results.find(result => result.error);
        if (failed) throw failed.error;
        [queueEntries, patients, doctors, profiles, departments, appointments] = results.map(result => result.data || []);

        fillSelect(queuePatient, "Select Patient", patients, item => item.id, item => `${item.full_name} (${item.patient_code})`);
        fillSelect(queueDepartment, "Select Department", departments, item => item.id, item => item.name);
        fillSelect(queueDoctor, "Select Doctor", doctors, item => item.id, doctorLabel);
        fillSelect(queueAppointment, "No linked appointment", appointments, item => item.id, item => `${item.appointment_code} — ${patientFor(item.patient_id)?.full_name || "Patient"} — ${item.appointment_date}`);
        const filter = document.getElementById("departmentFilter");
        fillSelect(filter, "All Departments", departments, item => item.id, item => item.name);
        filter.options[0].value = "All";
        renderQueue();
        message(queueEntries.length ? "" : "The queue is currently empty.", queueEntries.length ? "" : "info");
        return true;
    } catch (error) {
        console.error("Unable to load queue:", error);
        message("Could not load queue or related records. Check your connection and database permissions.", "error");
        return false;
    }
}

function updateDoctorOptions() {
    const departmentId = queueDepartment.value;
    const filtered = doctors.filter(doctor => !departmentId || doctor.department_id === departmentId);
    fillSelect(queueDoctor, "Select Doctor", filtered, item => item.id, doctorLabel);
}

function updateAppointmentOptions() {
    const patientId = queuePatient.value;
    const filtered = appointments.filter(item =>
        (!patientId || item.patient_id === patientId) &&
        (!queueDepartment.value || item.department_id === queueDepartment.value)
    );
    fillSelect(queueAppointment, "No linked appointment", filtered, item => item.id, item => `${item.appointment_code} — ${item.appointment_date}`);
}

function openQueueModal() {
    queueForm.reset();
    queueModal.classList.add("show");
    updateDoctorOptions();
    updateAppointmentOptions();
}

function closeQueueModal() {
    if (actionInProgress) return;
    queueModal.classList.remove("show");
    queueForm.reset();
}

function nextQueueNumber() {
    const year = new Date().getFullYear();
    const used = new Set(queueEntries.map(item => item.queue_number));
    for (let i = 1; i <= 9999; i += 1) {
        const code = `Q-${year}-${String(i).padStart(3, "0")}`;
        if (!used.has(code)) return code;
    }
    throw new Error("No unused queue numbers remain for this year.");
}

queueForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (actionInProgress) return;
    actionInProgress = true;
    saveQueueBtn.disabled = true;
    try {
        const patient = patientFor(queuePatient.value);
        const doctor = doctorFor(queueDoctor.value);
        if (!patient || !doctor || doctor.department_id !== queueDepartment.value) {
            throw new Error("Select an existing patient, department, and doctor assigned to that department.");
        }
        const linkedAppointment = queueAppointment.value ? appointmentFor(queueAppointment.value) : null;
        if (linkedAppointment && (
            linkedAppointment.patient_id !== patient.id ||
            linkedAppointment.doctor_id !== doctor.id ||
            linkedAppointment.department_id !== queueDepartment.value
        )) {
            throw new Error("The linked appointment must match the selected patient, doctor, and department.");
        }
        const payload = {
            queue_number: nextQueueNumber(),
            patient_id: patient.id,
            doctor_id: doctor.id,
            department_id: queueDepartment.value,
            appointment_id: linkedAppointment?.id || null,
            queue_date: dateToday(),
            priority: queuePriority.value,
            status: "Waiting"
        };
        const { data, error } = await window.clinicSupabase.from("queue_entries").insert(payload).select("*").single();
        if (error) throw error;
        if (!data) throw new Error("Queue entry was not saved; check database permissions.");
        queueModal.classList.remove("show");
        const loaded = await loadQueue();
        message(loaded ? "Patient added to the waiting queue." : "Queue entry saved, but the latest queue could not be reloaded.", loaded ? "success" : "error");
    } catch (error) {
        console.error("Unable to add queue entry:", error);
        message(error.code === "23503" ? "A selected patient, doctor, department, or appointment is no longer available." : error.code === "23505" ? "Queue number was just used by another request. Reload and retry." : error.message || "Unable to add patient to queue.", "error");
    } finally {
        actionInProgress = false;
        saveQueueBtn.disabled = false;
    }
});

async function changeEntryStatus(entry, status) {
    if (actionInProgress) return;
    actionInProgress = true;
    try {
        const payload = { status };
        if (status === "In Consultation") payload.called_at = new Date().toISOString();
        if (status === "Waiting") {
            payload.called_at = null;
            payload.queue_date = dateToday();
            payload.created_at = new Date().toISOString();
        }
        const { data, error } = await window.clinicSupabase.from("queue_entries")
            .update(payload).eq("id", entry.id).eq("status", entry.status).select("id").maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("This queue entry has changed or was already handled. Refresh and retry.");
        const loaded = await loadQueue();
        message(loaded ? (status === "Waiting" ? "Patient requeued at the end of the waiting line." : `Queue status changed to ${status}.`) : "Queue status saved, but the latest queue could not be reloaded.", loaded ? "success" : "error");
    } catch (error) {
        console.error("Unable to update queue entry:", error);
        message(error.code === "23503" ? "The queue entry is referenced by another record and cannot be changed." : error.message || "Unable to update the queue entry.", "error");
    } finally {
        actionInProgress = false;
    }
}

async function callNextPatient() {
    if (actionInProgress) return;
    const current = queueEntries.find(item => item.status === "In Consultation");
    if (current) return message("A patient is already marked In Consultation.", "info");
    queueOrder.replace(queueEntries);
    const next = queueOrder.nextWaiting(dateToday());
    if (!next) return message("There are no waiting patients.", "info");
    await changeEntryStatus(next, "In Consultation");
}

document.getElementById("queueDepartment").addEventListener("change", () => {
    updateDoctorOptions();
    updateAppointmentOptions();
});
queuePatient.addEventListener("change", updateAppointmentOptions);
document.getElementById("addQueueBtn").addEventListener("click", openQueueModal);
document.getElementById("closeModalBtn").addEventListener("click", closeQueueModal);
document.getElementById("cancelModalBtn").addEventListener("click", closeQueueModal);
queueModal.addEventListener("click", event => { if (event.target === queueModal) closeQueueModal(); });
document.getElementById("callNextBtn").addEventListener("click", callNextPatient);
queueTableBody.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const entry = queueEntries.find(item => item.id === button.dataset.id);
    if (!entry) return;
    const action = button.dataset.action;
    if (action === "call") {
        if (queueEntries.some(item => item.id !== entry.id && item.status === "In Consultation")) {
            return message("A patient is already marked In Consultation.", "info");
        }
        changeEntryStatus(entry, "In Consultation");
    }
    if (action === "complete") changeEntryStatus(entry, "Completed");
    if (action === "skip") changeEntryStatus(entry, "Skipped");
    if (action === "requeue") changeEntryStatus(entry, "Waiting");
});
document.getElementById("searchInput").addEventListener("input", renderQueue);
document.getElementById("statusFilter").addEventListener("change", renderQueue);
document.getElementById("departmentFilter").addEventListener("change", renderQueue);
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
loadQueue();
