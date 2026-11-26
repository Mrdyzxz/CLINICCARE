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
        // DSA: HashMap
        // Ginagamit ang Map para i-access ang record agad gamit ang unique String ID.
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
            // DSA: HashMap
            // Ginagamit ang get() para direktang kunin ang record sa #byId Map.
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

    // Dito natin ginagawa ang QueueNode.
    // Bawat node ay may record at references papunta
    // sa previous at next node.
    class QueueNode {
        constructor(record) {
            this.record = record;
            this.next = null;
            this.previous = null;
        }
    }

    // DSA: Doubly Linked List
    // Dito sine-save ang mga queue node sa sequence.
    // Gumagamit tayo ng head para sa unang node at tail para sa pinakadulong node.
    class ClinicLinkedQueue {
        // Ginagamit natin ang head para malaman kung sino
        // ang unang node sa linked list.
        #head = null;
        // Ang tail naman ang pinakadulong node.
        // Ito ang tambayan kapag gumagamit tayo ng append().
        #tail = null;
        // Sinusubaybayan nito kung ilang node ang kasalukuyang nasa list.
        #length = 0;
        // Ginagamit natin ang Map para mabilis na mahanap ang node gamit ang ID.
        #byId = new Map();

        // Nirerebuild natin ang buong linked list mula sa records.
        // Wala itong permanenteng source of truth; ang Supabase pa rin ang source.
        replace(records, createRecord = record => record) {
            this.clear();
            Array.from(records || [], createRecord).forEach(record => this.append(record));
            return this.records;
        }

        // DSA: Doubly Linked List - Insertion at the End
        // Dinadagdag ang bagong patient sa pinakadulo ng list.
        // In-update rin ang previous at next references.
        append(record) {
            if (record === null || record === undefined) return null;
            // Inaalis muna ang lumang node na may parehong ID
            // para walang magkaparehong node sa linked list.
            this.#removeExistingId(record);

            const node = new QueueNode(record);
            if (!this.#tail) {
                this.#head = node;
                this.#tail = node;
            } else {
                node.previous = this.#tail;
                this.#tail.next = node;
                this.#tail = node;
            }
            this.#length += 1;
            this.#indexNode(node);
            return node;
        }

        // DSA: Doubly Linked List - Insertion at the Beginning
        // Dinadagdag ang record bago ang kasalukuyang head.
        prepend(record) {
            if (record === null || record === undefined) return null;
            this.#removeExistingId(record);

            const node = new QueueNode(record);
            if (!this.#head) {
                this.#head = node;
                this.#tail = node;
            } else {
                node.next = this.#head;
                this.#head.previous = node;
                this.#head = node;
            }
            this.#length += 1;
            this.#indexNode(node);
            return node;
        }

        // DSA: Doubly Linked List - Node Removal
        // Hinahanap ang node gamit ang ID, pagkatapos ini-update
        // ang previous at next pointers ng kalapit na nodes.
        removeById(id) {
            const key = this.#idKey(id);
            if (key === null) return null;

            const node = this.#byId.get(key);
            if (!node) return null;
            return this.#removeNode(node);
        }

        // Dito natin kinukuha ang record gamit ang ID.
        // Walang tinatanggal na node sa operasyon na ito.
        findById(id) {
            const key = this.#idKey(id);
            if (key === null) return null;
            return this.#byId.get(key)?.record || null;
        }

        // DSA: Requeue - Ililipat ang existing node sa pinakadulo.
        // Inaalis muna ang node, tapos ina-append ulit ito sa tail.
        moveToEnd(id) {
            const key = this.#idKey(id);
            if (key === null) return null;

            const node = this.#byId.get(key);
            if (!node || node === this.#tail) return node?.record || null;
            const record = this.#removeNode(node)?.record || null;
            return record ? this.append(record)?.record || null : null;
        }

        // DSA: Queue - Dequeue
        // Inaalis ang head o ang unang node sa FIFO queue.
        dequeue() {
            if (!this.#head) return null;
            return this.#removeNode(this.#head)?.record || null;
        }

        // Hindi nito inaalis ang node.
        // Ibinabalik lang ang record sa kasalukuyang head.
        peek() {
            return this.#head?.record || null;
        }

        // Ginagawa nating ordinary array ang list para gamitin sa rendering
        // at sa ibang existing array-based na operations.
        toArray() {
            const records = [];
            let node = this.#head;
            while (node) {
                records.push(node.record);
                node = node.next;
            }
            return records;
        }

        // Ibinabalik ang bilang ng mga node sa linked list.
        size() {
            return this.#length;
        }

        get records() {
            return this.toArray();
        }

        getById(id) {
            return this.findById(id);
        }

        filter(predicate) {
            return this.toArray().filter(predicate);
        }

        search(term, fieldsFor = record => record?.searchFields || []) {
            const query = String(term || "").trim().toLowerCase();
            if (!query) return this.records;
            return this.toArray().filter(record =>
                fieldsFor(record).some(value =>
                    String(value || "").toLowerCase().includes(query)
                )
            );
        }

        sort(compare) {
            return this.toArray().sort(compare);
        }

        clear() {
            this.#head = null;
            this.#tail = null;
            this.#length = 0;
            this.#byId.clear();
        }

        #idKey(recordOrId) {
            const value = recordOrId && typeof recordOrId === "object"
                ? recordOrId.id
                : recordOrId;
            return value === null || value === undefined ? null : String(value);
        }

        #removeExistingId(record) {
            const key = this.#idKey(record);
            if (key === null) return;
            const existing = this.#byId.get(key);
            if (existing) this.#removeNode(existing);
        }

        // Dito natin ina-link ang ID sa node para mabilis itong mahanap.
        #indexNode(node) {
            const key = this.#idKey(node.record);
            // DSA: HashMap
            // Sinaset ang ID bilang key at node bilang value para sa mabilis na lookup.
            if (key !== null && !this.#byId.has(key)) this.#byId.set(key, node);
        }

        // Ina-update dito ang previous at next references kapag
        // tinanggal ang isang node sa gitna, head, o tail.
        #removeNode(node) {
            this.#unlinkNode(node);
            const key = this.#idKey(node.record);
            // DSA: HashMap
            // Tinatanggal ang ID sa Map kapag na-remove na rin ang matching node.
            if (key !== null && this.#byId.get(key) === node) this.#byId.delete(key);
            node.previous = null;
            node.next = null;
            return node;
        }

        // Pinapanatili ng helper na ito ang tamang pointer connections
        // at binabawasan din ang #length.
        #unlinkNode(node) {
            if (node.previous) {
                node.previous.next = node.next;
            } else {
                this.#head = node.next;
            }
            if (node.next) {
                node.next.previous = node.previous;
            } else {
                this.#tail = node.previous;
            }
            this.#length -= 1;
            node.previous = null;
            node.next = null;
        }
    }

    // DSA: Queue - FIFO (First In, First Out)
    // Pinapalitan lang ng subclass na ito ang pag-order ng records,
    // habang nananatili ang linked list operations mula sa parent class.
    class ClinicFifoQueue extends ClinicLinkedQueue {
        // Inaayos dito ang queue records mula sa pinakamatandang created_at.
        // Kapag magkapareho ang timestamp, ginagamit ang ID bilang tie-breaker.
        replace(records, createRecord = record => record) {
            const ordered = Array.from(records || [], createRecord).sort((left, right) => {
                const byCreated = new Date(left?.created_at || 0) - new Date(right?.created_at || 0);
                return byCreated || String(left?.id || "").localeCompare(String(right?.id || ""));
            });
            return super.replace(ordered);
        }

        // Dito pinipili ang unang Waiting patient sa kasalukuyang araw.
        // Dahil nauna nang naka-sort ang records, FIFO ang mapagpipilian.
        nextWaiting(date = null) {
            const waiting = this.filter(entry =>
                entry.status === "Waiting" &&
                (!date || String(entry.queue_date).slice(0, 10) === date)
            );
            return waiting[0] || null;
        }
    }

    global.ClinicCareDomain = Object.freeze({
        ClinicRecord,
        ClinicUserRecord,
        ClinicRecordList,
        QueueNode,
        ClinicLinkedQueue,
        ClinicFifoQueue,
        createUserRecord
    });
})(window);
