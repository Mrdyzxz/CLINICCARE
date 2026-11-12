const reportType = document.getElementById("reportType");
const dateFrom = document.getElementById("dateFrom");
const dateTo = document.getElementById("dateTo");
const departmentFilter = document.getElementById("departmentFilter");
const generateBtn = document.getElementById("generateReportBtn");
const resetBtn = document.getElementById("resetFiltersBtn");
const exportBtn = document.getElementById("exportReportBtn");
const printBtn = document.getElementById("printReportBtn");
const reportTableHead = document.getElementById("reportTableHead");
const reportTableBody = document.getElementById("reportTableBody");
const reportDescription = document.getElementById("reportDescription");
const reportDate = document.getElementById("reportDate");
const reportCount = document.getElementById("reportCount");
const feedback = document.createElement("div");
feedback.setAttribute("role", "status");
feedback.setAttribute("aria-live", "polite");
feedback.style.cssText = "display:none;margin:14px 0;padding:11px 14px;border-radius:8px;font-size:13px;";
document.querySelector(".filter-card").appendChild(feedback);

let patientRows = [];
let appointmentRows = [];
let consultationRows = [];
let departments = [];
let generatedRows = [];
let generating = false;

function message(text, type) {
    feedback.textContent = text;
    feedback.style.display = text ? "block" : "none";
    feedback.style.color = type === "error" ? "#a33f3f" : type === "success" ? "#187653" : "#526a74";
    feedback.style.background = type === "error" ? "#fff0f0" : type === "success" ? "#e8f7f0" : "#f3f7f8";
}

function fillDepartmentFilter() {
    const current = departmentFilter.value;
    departmentFilter.replaceChildren(new Option("All Departments", "all"));
    departments.forEach(department => departmentFilter.add(new Option(department.name, department.id)));
    departmentFilter.value = departments.some(item => item.id === current) ? current : "all";
}

function dateValue(value) {
    return String(value || "").slice(0, 10);
}

function getFiltered(source) {
    return source.filter(row => {
        const selectedDepartment = departmentFilter.value;
        const matchesDepartment = row.type === "Patient" || selectedDepartment === "all" ||
            row.department_id === selectedDepartment;
        const date = dateValue(row.report_date);
        const matchesFrom = !dateFrom.value || date >= dateFrom.value;
        const matchesTo = !dateTo.value || date <= dateTo.value;
        return matchesDepartment && matchesFrom && matchesTo;
    });
}

function reportSets() {
    const patients = getFiltered(patientRows);
    const appointments = getFiltered(appointmentRows);
    const consultations = getFiltered(consultationRows);
    return { patients, appointments, consultations };
}

function buildSelectedRows(type, sets) {
    if (type === "patients") return sets.patients;
    if (type === "appointments") return sets.appointments;
    if (type === "consultations") return sets.consultations;
    return [...sets.patients, ...sets.appointments, ...sets.consultations]
        .sort((a, b) => dateValue(b.report_date).localeCompare(dateValue(a.report_date)));
}

function displayReport(records, type) {
    const columns = type === "patients"
        ? [["patient_code", "PATIENT CODE"], ["patient", "PATIENT NAME"], ["report_date", "REGISTRATION DATE"]]
        : type === "appointments"
            ? [["record_code", "APPOINTMENT CODE"], ["patient", "PATIENT"], ["doctor", "DOCTOR"], ["department", "DEPARTMENT"], ["report_date", "DATE"], ["appointment_time", "TIME"], ["status", "STATUS"]]
            : type === "consultations"
                ? [["record_code", "CONSULTATION CODE"], ["patient", "PATIENT"], ["doctor", "DOCTOR"], ["department", "DEPARTMENT"], ["report_date", "DATE"], ["status", "STATUS"]]
                : [["record_code", "RECORD CODE"], ["type", "TYPE"], ["patient", "PATIENT"], ["doctor", "DOCTOR"], ["department", "DEPARTMENT"], ["report_date", "DATE"], ["appointment_time", "TIME"], ["status", "STATUS"]];

    reportTableHead.replaceChildren();
    const header = document.createElement("tr");
    columns.forEach(([, label]) => {
        const cell = document.createElement("th");
        cell.textContent = label;
        header.appendChild(cell);
    });
    reportTableHead.appendChild(header);
    reportTableBody.replaceChildren();

    if (!records.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = columns.length;
        cell.className = "empty-state";
        cell.textContent = "No records found for the selected filters.";
        row.appendChild(cell);
        reportTableBody.appendChild(row);
    } else {
        records.forEach(record => {
            const row = document.createElement("tr");
            columns.forEach(([key]) => {
                const cell = document.createElement("td");
                cell.textContent = key === "appointment_time"
                    ? record.type === "Appointment" && record[key] ? record[key].slice(0, 5) : "—"
                    : record[key] || "—";
                row.appendChild(cell);
            });
            reportTableBody.appendChild(row);
        });
    }
    reportCount.textContent = `${records.length} record(s)`;
    generatedRows = records;
}

function updateStatistics(sets) {
    document.getElementById("totalPatients").textContent = sets.patients.length;
    document.getElementById("totalAppointments").textContent = sets.appointments.length;
    document.getElementById("completedConsultations").textContent =
        sets.consultations.filter(item => item.status === "Completed").length;
    document.getElementById("pendingAppointments").textContent =
        sets.appointments.filter(item => item.status === "Pending").length;
}

function updateAppointmentChart(appointments) {
    const statuses = { Pending: 0, Confirmed: 0, Completed: 0, Cancelled: 0 };
    appointments.forEach(item => {
        if (Object.hasOwn(statuses, item.status)) statuses[item.status] += 1;
    });
    const total = appointments.length;
    document.getElementById("appointmentChartTotal").textContent = total;
    document.getElementById("chartPending").textContent = statuses.Pending;
    document.getElementById("chartConfirmed").textContent = statuses.Confirmed;
    document.getElementById("chartCompleted").textContent = statuses.Completed;
    document.getElementById("chartCancelled").textContent = statuses.Cancelled;
    const chart = document.getElementById("appointmentChart");
    const pending = total ? statuses.Pending / total * 100 : 0;
    const confirmed = pending + (total ? statuses.Confirmed / total * 100 : 0);
    const completed = confirmed + (total ? statuses.Completed / total * 100 : 0);
    chart.style.background = total
        ? `conic-gradient(#e7a84b 0% ${pending}%, #5688db ${pending}% ${confirmed}%, #22a879 ${confirmed}% ${completed}%, #df726a ${completed}% 100%)`
        : "#eaf0f5";
}

function updateDepartmentChart(consultations) {
    const chart = document.getElementById("departmentChart");
    chart.replaceChildren();
    const rows = departments
        .filter(item => departmentFilter.value === "all" || item.id === departmentFilter.value)
        .map(department => ({
            name: department.name,
            count: consultations.filter(item => item.department_id === department.id).length
        }));
    if (!rows.length) {
        const empty = document.createElement("p");
        empty.textContent = "No department data available.";
        chart.appendChild(empty);
        return;
    }
    const max = Math.max(...rows.map(item => item.count), 1);
    rows.forEach(item => {
        const row = document.createElement("div");
        row.className = "department-row";
        const header = document.createElement("div");
        header.className = "department-row-header";
        const name = document.createElement("strong");
        name.textContent = item.name;
        const count = document.createElement("span");
        count.textContent = `${item.count} consultation(s)`;
        header.append(name, count);
        const track = document.createElement("div");
        track.className = "progress-track";
        const fill = document.createElement("div");
        fill.className = "progress-fill";
        fill.style.width = `${item.count / max * 100}%`;
        track.appendChild(fill);
        row.append(header, track);
        chart.appendChild(row);
    });
}

async function loadReportData() {
    message("Loading report data...", "info");
    try {
        const results = await Promise.all([
            window.clinicSupabase.from("patients").select("id, patient_code, full_name, created_at"),
            window.clinicSupabase.from("appointments").select("*"),
            window.clinicSupabase.from("consultations").select("*"),
            window.clinicSupabase.from("departments").select("id, name")
        ]);
        const failed = results.find(result => result.error);
        if (failed) throw failed.error;
        const patients = results[0].data || [];
        const appointments = results[1].data || [];
        const consultations = results[2].data || [];
        departments = results[3].data || [];
        const departmentMap = new Map(departments.map(item => [item.id, item.name]));
        const patientMap = new Map(patients.map(item => [item.id, item.full_name]));
        const doctorResult = await window.clinicSupabase.from("doctors").select("id, doctor_code, full_name, profile_id");
        if (doctorResult.error) throw doctorResult.error;
        const doctors = doctorResult.data || [];
        const profilesResult = await window.clinicSupabase.from("profiles").select("id, full_name, role").eq("role", "doctor");
        if (profilesResult.error) throw profilesResult.error;
        const doctorProfiles = new Map((profilesResult.data || []).map(item => [item.id, item.full_name]));
        const doctorMap = new Map(doctors.map(item => [item.id, item.full_name || doctorProfiles.get(item.profile_id) || item.doctor_code]));

        patientRows = patients.map(item => ({
            id: item.id, patient_code: item.patient_code, patient: item.full_name,
            report_date: dateValue(item.created_at), type: "Patient", doctor: "",
            department: "—", status: "—", department_id: null
        }));
        appointmentRows = appointments.map(item => ({
            id: item.id, record_code: item.appointment_code, patient: patientMap.get(item.patient_id) || "—",
            doctor: doctorMap.get(item.doctor_id) || "—", department: departmentMap.get(item.department_id) || "—",
            report_date: dateValue(item.appointment_date), appointment_time: item.appointment_time || "",
            status: item.status,
            type: "Appointment", department_id: item.department_id
        }));
        consultationRows = consultations.map(item => ({
            id: item.id, record_code: item.consultation_code, patient: patientMap.get(item.patient_id) || "—",
            doctor: doctorMap.get(item.doctor_id) || "—", department: departmentMap.get(item.department_id) || "—",
            report_date: dateValue(item.consultation_date), appointment_time: "",
            status: item.status,
            type: "Consultation", department_id: item.department_id
        }));
        fillDepartmentFilter();
        await generateReport();
        message("", "");
    } catch (error) {
        console.error("Unable to load report data:", error);
        message("Could not load reports. Check your connection and database permissions.", "error");
        generatedRows = [];
        displayReport([], reportType.value);
    }
}

async function generateReport() {
    if (generating) return;
    if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) {
        return message("The start date must be on or before the end date.", "error");
    }
    generating = true;
    generateBtn.disabled = true;
    try {
        const sets = reportSets();
        updateStatistics(sets);
        updateAppointmentChart(sets.appointments);
        updateDepartmentChart(sets.consultations);
        const type = reportType.value;
        const descriptions = {
            patients: "Patient Registration Report",
            appointments: "Appointment Records Report",
            consultations: "Consultation Records Report",
            all: "All Clinic Records"
        };
        reportDescription.textContent = descriptions[type] || descriptions.all;
        displayReport(buildSelectedRows(type, sets), type);
        reportDate.textContent = `Generated: ${new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}`;
        if (departmentFilter.value !== "all") {
            message("Patient profiles have no department relationship; the department filter applies only to appointments and consultations.", "info");
        } else {
            message(generatedRows.length ? "" : "No report records match the selected filters.", generatedRows.length ? "" : "info");
        }
    } finally {
        generating = false;
        generateBtn.disabled = false;
    }
}

function resetFilters() {
    reportType.value = "all";
    dateFrom.value = "";
    dateTo.value = "";
    departmentFilter.value = "all";
    generateReport();
}

function exportReport() {
    if (!generatedRows.length) return message("No report records are available to export.", "info");
    const rows = [["Record UUID", "Code", "Type", "Patient", "Doctor", "Department", "Date", "Time", "Status"],
        ...generatedRows.map(item => [item.id, item.record_code || item.patient_code, item.type, item.patient, item.doctor, item.department, item.report_date, item.type === "Appointment" ? item.appointment_time || "" : "", item.status])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = `ClinicCare_${reportType.value}_Report.csv`; link.click(); URL.revokeObjectURL(url);
}

generateBtn.addEventListener("click", generateReport);
resetBtn.addEventListener("click", resetFilters);
exportBtn.addEventListener("click", exportReport);
printBtn.addEventListener("click", () => window.print());
dateFrom.addEventListener("change", generateReport);
dateTo.addEventListener("change", generateReport);
departmentFilter.addEventListener("change", generateReport);
reportType.addEventListener("change", generateReport);
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
loadReportData();
