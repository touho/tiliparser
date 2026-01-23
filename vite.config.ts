import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import fs from 'node:fs'
import path from 'node:path'

export default defineConfig({
	optimizeDeps: {
		entries: ['index.html'],
	},
	server: {
		host: '127.0.0.1',
		port: 5174,
	},
	// Dev-only sample loader for local CSVs in /samples
	plugins: [
		svelte(),
		{
			name: 'local-samples',
			configureServer(server) {
				server.middlewares.use('/__samples', (req, res) => {
					const samplesDir = path.resolve(process.cwd(), 'samples')
					if (req.url === '/' || req.url === '') {
						try {
							const files = fs
								.readdirSync(samplesDir)
								.filter((file: string) =>
									file.toLowerCase().endsWith('.csv')
								)
							res.setHeader('Content-Type', 'application/json')
							res.end(JSON.stringify(files))
						} catch (err) {
							res.statusCode = 500
							res.end('Failed to read samples folder')
						}
						return
					}

					const name = decodeURIComponent(
						req.url?.replace(/^\//, '') ?? ''
					)
					const filePath = path.join(samplesDir, name)
					if (!filePath.startsWith(samplesDir)) {
						res.statusCode = 400
						res.end('Invalid sample name')
						return
					}
					if (!fs.existsSync(filePath)) {
						res.statusCode = 404
						res.end('Sample not found')
						return
					}
					res.setHeader('Content-Type', 'text/csv; charset=utf-8')
					fs.createReadStream(filePath).pipe(res)
				})
			},
		},
	],
})
