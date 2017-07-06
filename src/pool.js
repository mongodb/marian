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
        for (let i = 0; i < size; i += 1) {
            this.pool.push(f())
        }
    }

    /**
     * Return the least-loaded element of the pool.
     */
    get() {
        let min = {backlog: Infinity}
        for (const element of this.pool) {
            if (element.backlog < min.backlog) {
                min = element
            }
        }

        return min
    }
}

exports.Pool = Pool
