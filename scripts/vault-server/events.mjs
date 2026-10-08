/** Server-sent events: one hub, many UI windows. */
export function createHub() {
    const clients = new Set();
    const listeners = new Set();
    const heartbeat = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25_000);
    heartbeat.unref();

    return {
        get size() { return clients.size; },
        /** Called with the new client count whenever a window connects or leaves. */
        onChange(fn) { listeners.add(fn); },
        connect(req, res) {
            res.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-store',
                connection: 'keep-alive',
                'x-accel-buffering': 'no',
            });
            res.write('retry: 2000\n\n');
            clients.add(res);
            listeners.forEach(fn => fn(clients.size));
            this.send('hello', { clients: clients.size }, res);
            req.on('close', () => {
                clients.delete(res);
                listeners.forEach(fn => fn(clients.size));
            });
        },
        send(event, data = {}, only) {
            const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
            for (const c of only ? [only] : clients) c.write(frame);
        },
        close() {
            clearInterval(heartbeat);
            for (const c of clients) c.end();
            clients.clear();
        },
    };
}
