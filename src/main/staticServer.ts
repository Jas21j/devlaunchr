import { createServer, type Server } from 'node:http'
import handler from 'serve-handler'

/**
 * Static projects have no command to run, so devLaunchr serves them itself.
 * Running in-process rather than shelling out to a global `serve` means a
 * static site works on a machine with nothing installed.
 */
export interface StaticHandle {
  port: number
  close: () => Promise<void>
}

export function startStaticServer(root: string, port: number): Promise<StaticHandle> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((request, response) => {
      void handler(request, response, {
        public: root,
        // A folder with an index.html serves it; anything else shows a
        // browsable listing, which is what you want for a folder of assets.
        directoryListing: true
        //
        // `symlinks: false` is deliberately NOT set. It reads as the safer
        // option, but it also stops serve-handler resolving a directory's
        // index.html, so every static project would open as a file listing
        // instead of the site. serve-handler still refuses `..` traversal;
        // what is given up is a symlink inside the project pointing outside
        // it, in a folder the user chose and already owns.
      })
    })

    const onError = (error: NodeJS.ErrnoException): void => {
      server.close()
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${port} was taken before the static server could bind it.`)
          : error
      )
    }

    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError)
      // A later error must not crash the main process.
      server.on('error', () => undefined)

      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections()
            server.close(() => done())
          })
      })
    })
  })
}
