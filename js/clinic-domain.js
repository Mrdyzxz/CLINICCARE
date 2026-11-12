(function (global) {
    class ClinicRecord {
        #data;

        constructor(data) {
            if (new.target === ClinicRecord) {
                throw new TypeError("ClinicRecord is an abstract base class.");
            }
            this.#data = Object.freeze({ ...data });
        }

        get id() {
            return this.#data.id;
        }

        get(field) {
            return this.#data[field];
        }

        toObject() {
            return { ...this.#data };
        }

        get searchFields() {
            throw new TypeError("ClinicRecord subclasses must define searchFields.");
        }

        matches(term) {
            const query = String(term || "").trim().toLowerCase();
            return !query || this.searchFields.some(value =>
                String(value || "").toLowerCase().includes(query)
            );
        }
    }

    class ClinicUserRecord extends ClinicRecord {
        get full_name() { return this.get("full_name"); }
        get phone() { return this.get("phone"); }
        get email() { return this.get("email"); }
        get role() { return this.get("role"); }
        get is_active() { return this.get("is_active"); }
        get created_at() { return this.get("created_at"); }
        get roleLabel() { return this.role || "Unknown"; }

        get searchFields() {
            return [this.id, this.full_name, this.phone, this.email];
        }
    }

    class AdminUserRecord extends ClinicUserRecord {
        get roleLabel() { return "Admin"; }
    }

    class DoctorUserRecord extends ClinicUserRecord {
        get roleLabel() { return "Doctor"; }
    }

    class ReceptionistUserRecord extends ClinicUserRecord {
        get roleLabel() { return "Receptionist"; }
    }

    class PatientUserRecord extends ClinicUserRecord {
        get roleLabel() { return "Patient"; }
    }

    function createUserRecord(data) {
        const recordTypes = {
            admin: AdminUserRecord,
            doctor: DoctorUserRecord,
            receptionist: ReceptionistUserRecord,
            patient: PatientUserRecord
        };
        const RecordType = recordTypes[data.role] || ClinicUserRecord;
        return new RecordType(data);
    }

    class ClinicRecordList {
        #records = [];
        #byId = new Map();

        replace(records, createRecord = record => record) {
            this.#records = Array.from(records || [], createRecord);
            this.#byId = new Map(
                this.#records
                    .filter(record => record && record.id !== null && record.id !== undefined)
                    .map(record => [String(record.id), record])
            );
            return this.records;
        }

        get records() {
            return this.#records.slice();
        }

        getById(id) {
            return this.#byId.get(String(id));
        }

        filter(predicate) {
            return this.#records.filter(predicate);
        }

        search(term, fieldsFor = record => record.searchFields || []) {
            const query = String(term || "").trim().toLowerCase();
            if (!query) return this.records;
            return this.#records.filter(record =>
                fieldsFor(record).some(value =>
                    String(value || "").toLowerCase().includes(query)
                )
            );
        }

        sort(compare) {
            return this.#records.slice().sort(compare);
        }
    }

    class ClinicFifoQueue extends ClinicRecordList {
        nextWaiting(date = null) {
            const waiting = this.filter(entry =>
                entry.status === "Waiting" &&
                (!date || String(entry.queue_date).slice(0, 10) === date)
            );
            return waiting.sort((left, right) => {
                const byCreated = new Date(left.created_at || 0) - new Date(right.created_at || 0);
                return byCreated || String(left.id).localeCompare(String(right.id));
            })[0] || null;
        }
    }

    global.ClinicCareDomain = Object.freeze({
        ClinicRecord,
        ClinicUserRecord,
        ClinicRecordList,
        ClinicFifoQueue,
        createUserRecord
    });
})(window);
