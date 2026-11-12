const dashboardDate = document.getElementById("currentDate");
const dashboardFeedback = document.getElementById("dashboardDataMessage");
const dashboardCollections = new window.ClinicCareDomain.ClinicRecordList();

function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function safeText(value) {
    return String(value ?? "—").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
}

function initials(name) {
    return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
        .map(part => part[0].toUpperCase()).join("") || "U";
}

function setCount(id, count) {
    document.getElementById(id).textContent = String(count || 0);
}

function setFeedback(text, isError = false) {
    dashboardFeedback.textContent = text;
    dashboardFeedback.hidden = !text;
    dashboardFeedback.classList.toggle("error", isError);
}

function emptyRow(body, message, columns) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns;
    cell.className = "dashboard-empty-cell";
    cell.textContent = message;
    row.appendChild(cell);
    body.replaceChildren(row);
}

function showCountError(id, error) {
    if (!error) return false;
    console.error(`Unable to load dashboard statistic ${id}:`, error);
    setCount(id, 0);
    return true;
}

function appointmentName(appointment, patientsById) {
    return patientsById.get(appointment.patient_id)?.full_name || "Patient unavailable";
}

function appointmentDateTime(appointment) {
    const date = appointment?.appointment_date
        ? new Date(`${appointment.appointment_date}T00:00:00`).toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric"
        })
        : "Date unavailable";
    if (!appointment?.appointment_time) return `${date} · Time not set`;
    const [hours, minutes] = String(appointment.appointment_time).split(":").map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return `${date} · Time not set`;
    const time = new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit"
    });
    return `${date} · ${time}`;
}

function doctorName(doctor, profilesById) {
    return doctor?.full_name || profilesById.get(doctor?.profile_id)?.full_name || doctor?.doctor_code || "Doctor unavailable";
}

function statusClass(status) {
    return String(status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function renderAppointments(appointments, patientsById, doctorsById, profilesById) {
    const body = document.getElementById("dashboardAppointmentsBody");
    if (!appointments.length) {
        emptyRow(body, "No appointments are scheduled for today.", 4);
        return;
    }

    body.replaceChildren();
    appointments.forEach(appointment => {
        const patient = patientsById.get(appointment.patient_id);
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><div class="patient-cell">
                <div class="patient-avatar avatar-one">${safeText(initials(patient?.full_name))}</div>
                <div><strong>${safeText(patient?.full_name || "Patient unavailable")}</strong><span>${safeText(patient?.patient_code || appointment.appointment_code)}</span></div>
            </div></td>
            <td>${safeText(doctorName(doctorsById.get(appointment.doctor_id), profilesById))}</td>
            <td>${safeText(appointmentDateTime(appointment))}</td>
            <td><span class="status ${statusClass(appointment.status)}">${safeText(appointment.status)}</span></td>`;
        body.appendChild(row);
    });
}

function renderQueue(queueEntries, patientsById, departmentsById) {
    const nowServing = queueEntries.find(entry => entry.status === "In Consultation");
    document.getElementById("dashboardNowServing").textContent = nowServing?.queue_number || "—";

    const waiting = queueEntries
        .filter(entry => entry.status === "Waiting")
        .sort((left, right) => {
            const createdAtOrder = new Date(left.created_at || 0) - new Date(right.created_at || 0);
            return createdAtOrder || String(left.id).localeCompare(String(right.id));
        })
        .slice(0, 4);
    const list = document.getElementById("dashboardQueueList");
    list.replaceChildren();
    if (!waiting.length) {
        const empty = document.createElement("p");
        empty.className = "dashboard-empty-message";
        empty.textContent = "No patients are waiting.";
        list.appendChild(empty);
        return;
    }

    waiting.forEach(entry => {
        const item = document.createElement("div");
        item.className = "queue-item";
        const patient = patientsById.get(entry.patient_id);
        item.innerHTML = `
            <div class="queue-number">${safeText(entry.queue_number)}</div>
            <div class="queue-person">
                <strong>${safeText(patient?.full_name || "Patient unavailable")}</strong>
                <span>${safeText(departmentsById.get(entry.department_id)?.name || "Department unavailable")}</span>
            </div>
            <span class="queue-time">Waiting</span>`;
        list.appendChild(item);
    });
}

function renderActivities(patients, appointments, consultations, patientsById, doctorsById, profilesById) {
    const activities = [
        ...patients.map(record => ({
            date: record.created_at,
            icon: "teal",
            symbol: "fa-user-plus",
            title: "Patient registered",
            detail: record.full_name || "Patient record added"
        })),
        ...appointments.map(record => ({
            date: record.created_at,
            icon: "blue",
            symbol: "fa-calendar-plus",
            title: "Appointment created",
            detail: `${appointmentName(record, patientsById)} — ${record.appointment_code || appointmentDateTime(record)}`
        })),
        ...consultations.map(record => ({
            date: record.created_at,
            icon: "purple",
            symbol: "fa-stethoscope",
            title: "Consultation recorded",
            detail: `${patientsById.get(record.patient_id)?.full_name || "Patient"} — ${doctorName(doctorsById.get(record.doctor_id), profilesById)}`
        }))
    ].filter(activity => activity.date)
        .sort((left, right) => new Date(right.date) - new Date(left.date))
        .slice(0, 5);

    const list = document.getElementById("dashboardActivityList");
    list.replaceChildren();
    if (!activities.length) {
        const empty = document.createElement("p");
        empty.className = "dashboard-empty-message";
        empty.textContent = "No recent clinic activity is available.";
        list.appendChild(empty);
        return;
    }

    activities.forEach(activity => {
        const item = document.createElement("div");
        item.className = "activity-item";
        item.innerHTML = `
            <div class="activity-icon ${activity.icon}"><i class="fa-solid ${activity.symbol}"></i></div>
            <div><strong>${safeText(activity.title)}</strong><p>${safeText(activity.detail)}</p><span>${safeText(new Date(activity.date).toLocaleString())}</span></div>`;
        list.appendChild(item);
    });
}

function renderAvailableDoctors(doctors, profilesById, departmentsById) {
    const available = doctors.filter(doctor => doctor.availability === "Available").slice(0, 5);
    const list = document.getElementById("dashboardDoctorList");
    list.replaceChildren();
    if (!available.length) {
        const empty = document.createElement("p");
        empty.className = "dashboard-empty-message";
        empty.textContent = "No doctors are currently marked available.";
        list.appendChild(empty);
        return;
    }

    available.forEach((doctor, index) => {
        const profile = profilesById.get(doctor.profile_id);
        const item = document.createElement("div");
        item.className = "doctor-item";
        item.innerHTML = `
            <div class="doctor-avatar doctor-${index + 1}">${safeText(initials(doctor.full_name || profile?.full_name))}</div>
            <div class="doctor-info">
                <strong>${safeText(doctor.full_name || profile?.full_name || "Doctor unavailable")}</strong>
                <span>${safeText(departmentsById.get(doctor.department_id)?.name || doctor.specialization || "Available")}</span>
            </div>
            <span class="available-dot"></span>`;
        list.appendChild(item);
    });
}

async function loadDashboard() {
    if (dashboardDate) {
        dashboardDate.textContent = new Date().toLocaleDateString("en-US", {
            weekday: "long", year: "numeric", month: "long", day: "numeric"
        });
    }

    const supabase = window.clinicSupabase;
    if (!supabase) {
        setFeedback("Dashboard data is unavailable because Supabase did not initialize. All totals are shown as 0.", true);
        return;
    }

    const today = localDateKey();
    const tomorrow = localDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1));
    const countResults = await Promise.all([
        supabase.from("patients").select("id", { count: "exact", head: true }),
        supabase.from("appointments").select("id", { count: "exact", head: true })
            .gte("appointment_date", today).lt("appointment_date", tomorrow),
        supabase.from("doctors").select("id", { count: "exact", head: true })
            .eq("availability", "Available"),
        supabase.from("queue_entries").select("id", { count: "exact", head: true })
            .eq("status", "Waiting").eq("queue_date", today)
    ]);

    const statisticIds = [
        "dashboardTotalPatients",
        "dashboardTodayAppointments",
        "dashboardAvailableDoctors",
        "dashboardWaitingPatients"
    ];
    let hasCountError = false;
    countResults.forEach((result, index) => {
        hasCountError = showCountError(statisticIds[index], result.error) || hasCountError;
        if (!result.error) setCount(statisticIds[index], result.count);
    });

    const listResults = await Promise.all([
        supabase.from("appointments").select("id, appointment_code, patient_id, doctor_id, appointment_date, appointment_time, status, created_at")
            .gte("appointment_date", today).lt("appointment_date", tomorrow)
            .order("appointment_date", { ascending: true }).order("appointment_time", { ascending: true }).limit(5),
        supabase.from("patients").select("id, patient_code, full_name, created_at").order("created_at", { ascending: false }).limit(10),
        supabase.from("doctors").select("id, doctor_code, full_name, profile_id, department_id, specialization, availability"),
        supabase.from("profiles").select("id, full_name, role").eq("role", "doctor"),
        supabase.from("departments").select("id, name"),
        supabase.from("queue_entries").select("id, queue_number, patient_id, department_id, status, queue_date, created_at")
            .eq("queue_date", today).order("created_at", { ascending: true }),
        supabase.from("consultations").select("id, patient_id, doctor_id, created_at").order("created_at", { ascending: false }).limit(10)
    ]);
    const listError = listResults.find(result => result.error)?.error;
    if (listError) {
        console.error("Unable to load dashboard records:", listError);
        emptyRow(document.getElementById("dashboardAppointmentsBody"), "Appointments could not be loaded.", 4);
        document.getElementById("dashboardQueueList").textContent = "Queue records could not be loaded.";
        document.getElementById("dashboardActivityList").textContent = "Recent activity could not be loaded.";
        document.getElementById("dashboardDoctorList").textContent = "Doctor records could not be loaded.";
        setFeedback("Some dashboard lists could not be loaded. Check your connection and database permissions. Statistics show 0 when their count query fails.", true);
        return;
    }

    const rows = listResults.map(result => result.data || []);
    const [appointments, patients, doctors, profiles, departments, queueEntries, consultations] = rows;
    const patientIds = [...new Set([
        ...appointments.map(record => record.patient_id),
        ...queueEntries.map(record => record.patient_id),
        ...consultations.map(record => record.patient_id)
    ].filter(Boolean))];
    const loadedPatientIds = new Set(patients.map(patient => patient.id));
    const missingPatientIds = patientIds.filter(id => !loadedPatientIds.has(id));
    if (missingPatientIds.length) {
        const { data: relatedPatients, error: relatedPatientsError } = await supabase
            .from("patients")
            .select("id, patient_code, full_name, created_at")
            .in("id", missingPatientIds);
        if (relatedPatientsError) {
            console.error("Unable to load patients related to dashboard records:", relatedPatientsError);
            setFeedback("Some patient names could not be loaded. Check database permissions and try again.", true);
        } else {
            patients.push(...(relatedPatients || []));
        }
    }
    dashboardCollections.replace(appointments);
    const patientsById = new Map(patients.map(patient => [patient.id, patient]));
    const doctorsById = new Map(doctors.map(doctor => [doctor.id, doctor]));
    const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
    const departmentsById = new Map(departments.map(department => [department.id, department]));

    renderAppointments(dashboardCollections.records, patientsById, doctorsById, profilesById);
    renderQueue(queueEntries, patientsById, departmentsById);
    renderActivities(patients, appointments, consultations, patientsById, doctorsById, profilesById);
    renderAvailableDoctors(doctors, profilesById, departmentsById);

    if (!listError && hasCountError) {
        setFeedback("One or more statistics could not be loaded and are shown as 0. Check database permissions and try again.", true);
    } else if (!listError) {
        setFeedback("");
    }
}

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

const newAppointmentBtn = document.getElementById("newAppointmentBtn");
if (newAppointmentBtn) {
    newAppointmentBtn.addEventListener("click", () => {
        window.location.href = "appointments.html";
    });
}

loadDashboard().catch(error => {
    console.error("Unexpected dashboard loading error:", error);
    [
        "dashboardTotalPatients",
        "dashboardTodayAppointments",
        "dashboardAvailableDoctors",
        "dashboardWaitingPatients"
    ].forEach(id => setCount(id, 0));
    setFeedback("Dashboard data could not be loaded. All totals are shown as 0.", true);
});
