/**
 * File Description: Asks the operating system for a free TCP port on localhost, for a child process (headless
 * Chrome, the editor dev server) that must listen on a port nobody else holds.
 * Inputs and outputs: none -> a promise of a free port number on 127.0.0.1.
 * Used by: backend/characters/browser.ts, scripts/studioDriver.ts.
 */

import net from "node:net";

// Binds port 0 on 127.0.0.1, reads the port the OS chose, and releases it for the caller.
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}
