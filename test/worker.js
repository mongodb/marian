'use strict'

self.onmessage = (ev) => {
    const message = ev.data.message
    const messageId = ev.data.messageId

    if (message === 'ping') {
        self.postMessage({message: 'pong', messageId: messageId})
    } else if (message === 'die') {
        process.exit(1)
    }
}
