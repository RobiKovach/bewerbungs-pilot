import net from 'node:net';

function isFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

export async function findFreePort(host: string, from: number, to: number): Promise<number> {
  for (let port = from; port <= to; port++) {
    if (await isFree(host, port)) return port;
  }
  throw new Error('NO_FREE_PORT');
}
