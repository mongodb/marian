/** A balancing scheduling pool. Useful primarily for making a pool of TaskWorkers. */
class Pool {
    /**
     * Create a new Pool.
     * @param {number} size - The size of the pool.
     * @param {function} f - A function returning a pool element. This element
     * must have a "backlog" property representing its current load.
     */
    constructor(size, f) {
        if (this.size <= 0) { throw new Error('Bad pool size') }

        this.pool = []
        this.suspended = new Set()
        for (let i = 0; i < size; i += 1) {
            this.pool.push(f())
        }
    }

    suspend(element) {
        this.suspended.add(element)
    }

    resume(element) {
        this.suspended.delete(element)
    }

    /**
     * Return the least-loaded element of the pool.
     * @return {?} The least-loaded element of the pool.
     */
    get() {
        const dummy = {backlog: Infinity}
        let min = dummy
        for (const element of this.pool) {
            if (this.suspended.has(element)) { continue }
            if (element.backlog < min.backlog) {
                min = element
            }
        }

        if (dummy === min) {
            throw new Error('No pool elements available')
        }

        return min
    }

    getStatus() {
        return this.pool.map((worker) => {
            if (!this.suspended.has(worker)) {
                return worker.backlog
            }

            return 's'
        })
    }
}

exports.Pool = Pool
