const appointmentTableBody = document.getElementById("appointmentTableBody");
const appointmentModal = document.getElementById("appointmentModal");
const appointmentForm = document.getElementById("appointmentForm");
const appointmentPatient = document.getElementById("appointmentPatient");
const appointmentDoctor = document.getElementById("appointmentDoctor");
const appointmentDepartment = document.getElementById("appointmentDepartment");
const appointmentDate = document.getElementById("appointmentDate");
const appointmentTime = document.getElementById("appointmentTime");
const appointmentReason = document.getElementById("appointmentReason");
const appointmentNotes = document.getElementById("appointmentNotes");
const saveAppointmentBtn = appointmentForm.querySelector('button[type="submit"]');
const feedback = document.createElement("div");
feedback.setAttribute("role", "status");
feedback.setAttribute("aria-live", "polite");
feedback.style.cssText = "display:none;margin:14px 0;padding:11px 14px;border-radius:8px;font-size:13px;";
document.querySelector(".panel").prepend(feedback);

let appointments = [];
let patients = [];
let doctors = [];
let profiles = [];
let departments = [];
let editingId = null;
let saving = false;

function message(text, type) {
    feedback.textContent = text;
    feedback.style.display = text ? "block" : "none";
    feedback.style.color = type === "error" ? "#a33f3f" : type === "success" ? "#187653" : "#526a74";
    feedback.style.background = type === "error" ? "#fff0f0" : type === "success" ? "#e8f7f0" : "#f3f7f8";
}

function isMissingAppointmentTimeColumn(error) {
    return error?.code === "42703" || error?.code === "PGRST204";
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

const getPatient = id => patients.find(item => item.id === id);
const getDoctor = id => doctors.find(item => item.id === id);
const getDepartment = id => departments.find(item => item.id === id);
const doctorProfile = doctor => profiles.find(item => item.id === doctor?.profile_id);
const doctorLabel = doctor => doctor?.full_name || doctorProfile(doctor)?.full_name || doctor?.doctor_code || "Doctor unavailable";
const dateOnly = value => String(value || "").slice(0, 10);
const formatDate = value => {
    const date = dateOnly(value);
    return date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
};
const formatTime = value => {
    if (!value) return "Time not set";
    const [hours, minutes] = String(value).split(":").map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return "Time not set";
    return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit"
    });
};
const appointmentDateTime = item => `${formatDate(item.appointment_date)} · ${formatTime(item.appointment_time)}`;
const statusClass = status => ({
    Pending: "pending-status", Confirmed: "confirmed-status",
    Completed: "completed-status", Cancelled: "cancelled-status"
}[status] || "pending-status");

function updateStatistics() {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById("totalAppointments").textContent = appointments.length;
    document.getElementById("todayAppointments").textContent =
        appointments.filter(item => dateOnly(item.appointment_date) === today).length;
    document.getElementById("pendingAppointments").textContent =
        appointments.filter(item => item.status === "Pending").length;
    document.getElementById("completedAppointments").textContent =
        appointments.filter(item => item.status === "Completed").length;
}

function renderAppointments() {
    const term = document.getElementById("searchInput").value.trim().toLowerCase();
    const selectedStatus = document.getElementById("statusFilter").value;
    const selectedDepartment = document.getElementById("departmentFilter").value;
    const filtered = appointments.filter(item => {
        const patient = getPatient(item.patient_id);
        const doctor = getDoctor(item.doctor_id);
        const matchesSearch = [
            item.appointment_code, patient?.full_name, patient?.patient_code,
            doctorLabel(doctor), item.reason, dateOnly(item.appointment_date),
            item.appointment_time, formatTime(item.appointment_time)
        ].some(value => String(value || "").toLowerCase().includes(term));
        return matchesSearch &&
            (selectedStatus === "all" || item.status === selectedStatus) &&
            (selectedDepartment === "all" || item.department_id === selectedDepartment);
    });

    appointmentTableBody.replaceChildren();
    filtered.forEach((item, index) => {
        const patient = getPatient(item.patient_id);
        const doctor = getDoctor(item.doctor_id);
        const department = getDepartment(item.department_id);
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${escapeText(item.appointment_code)}</td>
            <td><div class="patient-cell"><div class="patient-avatar avatar-${["one","two","three","four"][index % 4]}">${escapeText((patient?.full_name || "P").split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase())}</div><div><strong>${escapeText(patient?.full_name || "Patient unavailable")}</strong><span>Patient</span></div></div></td>
            <td>${escapeText(doctorLabel(doctor))}</td>
            <td>${escapeText(department?.name)}</td>
            <td>${escapeText(appointmentDateTime(item))}</td>
            <td><span class="status ${statusClass(item.status)}">${escapeText(item.status)}</span></td>
            <td>
                <button class="action-btn view-action" data-action="view" data-id="${item.id}" title="View"><i class="fa-regular fa-eye"></i></button>
                <button class="action-btn edit-action" data-action="edit" data-id="${item.id}" title="Edit"><i class="fa-regular fa-pen-to-square"></i></button>
                <button class="action-btn delete-action" data-action="cancel" data-id="${item.id}" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
            </td>`;
        appointmentTableBody.appendChild(row);
    });
    document.getElementById("appointmentCount").textContent =
        `Showing ${filtered.length} of ${appointments.length} appointments`;
    document.getElementById("emptyState").hidden = filtered.length !== 0;
    updateStatistics();
}

async function loadAppointments() {
    message("Loading appointments...", "info");
    try {
        const results = await Promise.all([
            window.clinicSupabase.from("appointments").select("*").order("appointment_date", { ascending: false }),
            window.clinicSupabase.from("patients").select("id, patient_code, full_name"),
            window.clinicSupabase.from("doctors").select("id, doctor_code, full_name, profile_id, department_id"),
            window.clinicSupabase.from("profiles").select("id, full_name, role").eq("role", "doctor"),
            window.clinicSupabase.from("departments").select("id, name, status").order("name")
        ]);
        const failed = results.find(result => result.error);
        if (failed) throw failed.error;
        [appointments, patients, doctors, profiles, departments] = results.map(result => result.data || []);
        fillSelect(appointmentPatient, "Select Patient", patients, row => row.id, row => `${row.full_name} (${row.patient_code})`);
        fillSelect(appointmentDoctor, "Select Doctor", doctors, row => row.id, doctorLabel);
        fillSelect(appointmentDepartment, "Select Department", departments, row => row.id, row => row.name);
        const filter = document.getElementById("departmentFilter");
        const value = filter.value;
        fillSelect(filter, "All Departments", departments, row => row.id, row => row.name);
        filter.options[0].value = "all";
        filter.value = departments.some(row => row.id === value) ? value : "all";
        renderAppointments();
        message(appointments.length ? "" : "No appointments have been scheduled yet.", appointments.length ? "" : "info");
        return true;
    } catch (error) {
        console.error("Unable to load appointments:", error);
        message("Could not load appointments or related dropdown data. Check your connection and database permissions.", "error");
        return false;
    }
}

function resetForm() {
    appointmentForm.reset();
    editingId = null;
    document.querySelector(".modal-header h2").textContent = "New Appointment";
    document.querySelector(".modal-header p").textContent = "Enter the details to schedule an appointment.";
    saveAppointmentBtn.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Schedule Appointment';
}

function openModal() {
    appointmentModal.classList.add("show");
}

function closeModal() {
    if (saving) return;
    appointmentModal.classList.remove("show");
    resetForm();
}

function editAppointment(item) {
    if (item.status === "Cancelled") return message("Cancelled appointments cannot be edited.", "error");
    editingId = item.id;
    appointmentPatient.value = item.patient_id;
    appointmentDoctor.value = item.doctor_id;
    appointmentDepartment.value = item.department_id;
    appointmentDate.value = dateOnly(item.appointment_date);
    appointmentTime.value = String(item.appointment_time || "").slice(0, 5);
    appointmentReason.value = item.reason || "";
    appointmentNotes.value = item.notes || "";
    document.querySelector(".modal-header h2").textContent = "Edit Appointment";
    document.querySelector(".modal-header p").textContent = "Update the appointment information.";
    saveAppointmentBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
    openModal();
}

function viewAppointment(item) {
    window.alert(
        `APPOINTMENT DETAILS\n\nCode: ${item.appointment_code}\nPatient: ${getPatient(item.patient_id)?.full_name || "Unavailable"}\nDoctor: ${doctorLabel(getDoctor(item.doctor_id))}\nDepartment: ${getDepartment(item.department_id)?.name || "Unavailable"}\nDate and time: ${appointmentDateTime(item)}\nReason: ${item.reason || "—"}\nNotes: ${item.notes || "—"}\nStatus: ${item.status}`
    );
}

function nextAppointmentCode() {
    const year = new Date().getFullYear();
    const used = new Set(appointments.map(item => item.appointment_code));
    for (let i = 1; i <= 9999; i += 1) {
        const code = `APT-${year}-${String(i).padStart(3, "0")}`;
        if (!used.has(code)) return code;
    }
    throw new Error("No unused appointment codes remain for this year.");
}

appointmentForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    saveAppointmentBtn.disabled = true;
    try {
        const wasEditing = Boolean(editingId);
        const doctor = getDoctor(appointmentDoctor.value);
        if (!doctor || doctor.department_id !== appointmentDepartment.value) {
            throw new Error("Choose a doctor assigned to the selected department.");
        }
        const payload = {
            patient_id: appointmentPatient.value,
            doctor_id: appointmentDoctor.value,
            department_id: appointmentDepartment.value,
            appointment_date: appointmentDate.value,
            appointment_time: appointmentTime.value,
            reason: appointmentReason.value.trim(),
            notes: appointmentNotes.value.trim() || null
        };
        const result = editingId
            ? await window.clinicSupabase.from("appointments").update(payload).eq("id", editingId).select("*").maybeSingle()
            : await window.clinicSupabase.from("appointments").insert({ ...payload, appointment_code: nextAppointmentCode(), status: "Pending" }).select("*").single();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("The appointment was not saved; check your database permissions.");
        appointmentModal.classList.remove("show");
        resetForm();
        const loaded = await loadAppointments();
        message(loaded ? (wasEditing ? "Appointment updated successfully." : "Appointment scheduled successfully.") : "Appointment saved, but the latest list could not be reloaded.", loaded ? "success" : "error");
    } catch (error) {
        console.error("Unable to save appointment:", error);
        message(
            isMissingAppointmentTimeColumn(error)
                ? "The appointment_time database column is missing. Apply the appointment time SQL migration, then try again."
                : error.code === "23503"
                    ? "The selected patient, doctor, or department is no longer available."
                    : error.code === "23505"
                        ? "That appointment code already exists. Please retry."
                        : error.message || "Unable to save appointment.",
            "error"
        );
    } finally {
        saving = false;
        saveAppointmentBtn.disabled = false;
    }
});

appointmentTableBody.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const item = appointments.find(appointment => appointment.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === "view") viewAppointment(item);
    if (button.dataset.action === "edit") editAppointment(item);
    if (button.dataset.action === "cancel") {
        if (item.status === "Cancelled") return message("This appointment is already cancelled.", "info");
        if (!window.confirm(`Cancel appointment ${item.appointment_code}?`)) return;
        button.disabled = true;
        try {
            const { data, error } = await window.clinicSupabase.from("appointments")
                .update({ status: "Cancelled" }).eq("id", item.id).neq("status", "Cancelled").select("id").maybeSingle();
            if (error) throw error;
            if (!data) throw new Error("Appointment was not cancelled; it may already have changed.");
            const loaded = await loadAppointments();
            message(loaded ? "Appointment cancelled successfully." : "Appointment cancelled, but the latest list could not be reloaded.", loaded ? "success" : "error");
        } catch (error) {
            console.error("Unable to cancel appointment:", error);
            message(error.message || "Unable to cancel appointment.", "error");
            button.disabled = false;
        }
    }
});

document.getElementById("addAppointmentBtn").addEventListener("click", () => { resetForm(); openModal(); });
document.getElementById("closeModalBtn").addEventListener("click", closeModal);
document.getElementById("cancelModalBtn").addEventListener("click", closeModal);
appointmentModal.addEventListener("click", event => { if (event.target === appointmentModal) closeModal(); });
document.getElementById("searchInput").addEventListener("input", renderAppointments);
document.getElementById("statusFilter").addEventListener("change", renderAppointments);
document.getElementById("departmentFilter").addEventListener("change", renderAppointments);

document.getElementById("exportBtn").addEventListener("click", () => {
    if (!appointments.length) return message("No appointments are available to export.", "info");
    const rows = [["UUID", "Appointment Code", "Patient", "Doctor", "Department", "Date", "Time", "Reason", "Notes", "Status"],
        ...appointments.map(item => [item.id, item.appointment_code, getPatient(item.patient_id)?.full_name, doctorLabel(getDoctor(item.doctor_id)), getDepartment(item.department_id)?.name, dateOnly(item.appointment_date), item.appointment_time || "", item.reason, item.notes, item.status])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = "cliniccare-appointments.csv"; link.click(); URL.revokeObjectURL(url);
});

const dateElement = document.getElementById("currentDate");
if (dateElement) dateElement.textContent = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
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
loadAppointments();
