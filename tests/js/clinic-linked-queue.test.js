const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.resolve(__dirname, "../../js/clinic-domain.js");
const source = fs.readFileSync(sourcePath, "utf8");
const window = {};
vm.runInNewContext(source, { window, console });

const { ClinicLinkedQueue, ClinicFifoQueue } = window.ClinicCareDomain;

function record(id, created_at = "2026-11-25T09:00:00Z") {
    return { id, created_at, status: "Waiting", queue_date: "2026-11-25" };
}

function ids(queue) {
    return Array.from(queue.toArray(), item => item.id);
}

{
    const queue = new ClinicLinkedQueue();
    queue.append(record("a"));
    queue.append(record("b"));
    queue.append(record("c"));

    assert.equal(queue.peek().id, "a");
    assert.deepEqual(ids(queue), ["a", "b", "c"]);
    assert.equal(queue.size(), 3);
}

{
    const queue = new ClinicLinkedQueue();
    ["a", "b", "c"].forEach(id => queue.append(record(id)));

    assert.equal(queue.dequeue().id, "a");
    assert.equal(queue.dequeue().id, "b");
    assert.equal(queue.dequeue().id, "c");
    assert.equal(queue.dequeue(), null);
    assert.equal(queue.peek(), null);
    assert.equal(queue.size(), 0);
}

{
    const queue = new ClinicLinkedQueue();
    queue.append(record("b"));
    queue.prepend(record("a"));

    assert.deepEqual(ids(queue), ["a", "b"]);
    assert.equal(queue.peek().id, "a");
}

{
    const queue = new ClinicLinkedQueue();
    ["a", "b", "c", "d"].forEach(id => queue.append(record(id)));

    assert.equal(queue.removeById("a").record.id, "a");
    assert.deepEqual(ids(queue), ["b", "c", "d"]);

    assert.equal(queue.removeById("c").record.id, "c");
    assert.deepEqual(ids(queue), ["b", "d"]);

    assert.equal(queue.removeById("d").record.id, "d");
    assert.deepEqual(ids(queue), ["b"]);
}

{
    const queue = new ClinicLinkedQueue();
    ["a", "b", "c"].forEach(id => queue.append(record(id)));

    assert.equal(queue.moveToEnd("b"), queue.findById("b"));
    assert.deepEqual(ids(queue), ["a", "c", "b"]);
    assert.equal(queue.size(), 3);
}

{
    const queue = new ClinicLinkedQueue();
    assert.equal(queue.peek(), null);
    assert.equal(queue.dequeue(), null);
    assert.equal(queue.removeById("missing"), null);
    assert.equal(queue.findById("missing"), null);
    assert.equal(queue.moveToEnd("missing"), null);
    assert.deepEqual(ids(queue), []);
    assert.equal(queue.size(), 0);
}

{
    const queue = new ClinicLinkedQueue();
    queue.append(record("duplicate"));
    queue.append(record("duplicate"));

    assert.equal(queue.size(), 1);
    assert.deepEqual(ids(queue), ["duplicate"]);
}

{
    const fifo = new ClinicFifoQueue();
    fifo.replace([
        record("later", "2026-11-25T10:00:00Z"),
        record("first", "2026-11-25T08:00:00Z"),
        record("middle", "2026-11-25T09:00:00Z")
    ]);

    assert.deepEqual(ids(fifo), ["first", "middle", "later"]);
    assert.equal(fifo.nextWaiting("2026-11-25").id, "first");
    assert.equal(fifo.dequeue().id, "first");
    assert.deepEqual(ids(fifo), ["middle", "later"]);
}

console.log("Clinic linked queue tests passed.");
