const PAGE = `<!doctype html><meta charset="utf-8"><title>Demo dev server</title>
<body style="font:15px system-ui;margin:40px;max-width:560px">
<h1 style="font-size:18px">Demo dev server</h1>
<p>This page comes from a service on the Studio machine, through its tunnel.</p>
<p>Host it saw: <code id="host"></code></p>
<p>Live updates: <strong id="ticks">connecting…</strong></p>
<script>
document.getElementById('host').textContent = HOST_SEEN;
const socket = new WebSocket(location.origin.replace('http', 'ws') + '/live');
socket.onmessage = (event) => { document.getElementById('ticks').textContent = event.data; };
socket.onclose = () => { document.getElementById('ticks').textContent = 'disconnected'; };
</script></body>`;

let ticks = 0;
const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 0),
  hostname: 'localhost',
  fetch(request, bunServer) {
    if (new URL(request.url).pathname === '/live' && bunServer.upgrade(request)) return undefined;
    const host = JSON.stringify(request.headers.get('host') ?? '');
    return new Response(PAGE.replace('HOST_SEEN', host), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
  websocket: {
    open(socket) {
      socket.subscribe('ticks');
    },
    message() {},
  },
});
setInterval(() => {
  ticks += 1;
  server.publish('ticks', String(ticks));
}, 1000);
console.info(`Demo dev server on http://localhost:${server.port}/`);
