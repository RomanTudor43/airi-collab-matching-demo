export default [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  {
    name: 'global::upload-guards',
    config: {
      maxFileSizeBytes: 5 * 1024 * 1024,
      maxUploadsPerHour: 50,
    },
  },
  'strapi::favicon',
  'strapi::public',
];
