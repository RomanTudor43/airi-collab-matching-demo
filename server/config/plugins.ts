export default () => ({
	upload: {
		config: {
			sizeLimit: 5 * 1024 * 1024,
			security: {
				allowedTypes: ['*/*'],
			},
		},
	},
});
