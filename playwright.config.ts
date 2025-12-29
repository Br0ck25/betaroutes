import { defineConfig } from '@playwright/test';

const manualServer = process.env.PW_MANUAL_SERVER === '1' || process.env.PW_MANUAL_SERVER === 'true';

export default defineConfig({
	webServer: manualServer
		? undefined
		: {
			command: 'npm run build && npm run preview',
			port: 4173,
			env: { PW_MANUAL_SERVER: '1' },
			reuseExistingServer: true
		},
	use: {
		baseURL: manualServer ? 'http://localhost:4173' : undefined
	},
	testDir: 'e2e'
});
