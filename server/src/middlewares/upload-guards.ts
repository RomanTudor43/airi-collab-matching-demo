import path from 'node:path';

const DEFAULT_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

const DEFAULT_ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.txt',
  '.md',
  '.csv',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
]);

const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_UPLOADS_PER_HOUR = 50;
const HOUR_IN_MS = 60 * 60 * 1000;

const rateLimitBuckets = new Map<string, number[]>();

const isAdminStrategy = (ctx: any) => {
  const strategyName = ctx?.state?.auth?.strategy?.name;
  if (strategyName && String(strategyName).includes('admin')) {
    return true;
  }

  const user = ctx?.state?.user;
  return Boolean(user && Array.isArray(user.roles));
};

const isUploadRoute = (ctx: any) => {
  const method = String(ctx?.method || '').toUpperCase();
  if (method !== 'POST') {
    return false;
  }

  const pathname = String(ctx?.path || '');
  return (
    pathname === '/upload' ||
    pathname.startsWith('/upload') ||
    pathname === '/api/upload' ||
    pathname.startsWith('/api/upload')
  );
};

const normalizeFiles = (filesInput: any) => {
  if (!filesInput) {
    return [] as any[];
  }

  if (Array.isArray(filesInput)) {
    return filesInput;
  }

  if (Array.isArray(filesInput.files)) {
    return filesInput.files;
  }

  if (filesInput.files) {
    return [filesInput.files];
  }

  const collected: any[] = [];
  Object.values(filesInput).forEach((entry) => {
    if (!entry) {
      return;
    }

    if (Array.isArray(entry)) {
      collected.push(...entry);
      return;
    }

    collected.push(entry);
  });

  return collected;
};

const getFileName = (file: any) =>
  String(file?.name || file?.originalFilename || file?.filename || 'unknown');

const getFileMimeType = (file: any) => String(file?.type || file?.mimetype || '');

export default (config: any) => {
  const allowedMimeTypes = new Set(config?.allowedMimeTypes || DEFAULT_ALLOWED_MIME_TYPES);
  const allowedExtensions = new Set(config?.allowedExtensions || DEFAULT_ALLOWED_EXTENSIONS);
  const maxFileSizeBytes = Number(
    config?.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES,
  );
  const maxUploadsPerHour = Number(
    config?.maxUploadsPerHour || DEFAULT_MAX_UPLOADS_PER_HOUR,
  );

  return async (ctx: any, next: () => Promise<void>) => {
    if (!isAdminStrategy(ctx) || !isUploadRoute(ctx)) {
      return next();
    }

    const files = normalizeFiles(ctx?.request?.files);
    if (files.length === 0) {
      return next();
    }

    for (const file of files) {
      const fileName = getFileName(file);
      const fileExtension = path.extname(fileName).toLowerCase();
      const mimeType = getFileMimeType(file).toLowerCase();
      const fileSize = file?.size;

      if (typeof fileSize !== 'number') {
        ctx.throw(400, `Upload failed: file size missing for ${fileName}.`);
      }

      if (fileSize > maxFileSizeBytes) {
        ctx.throw(413, `Upload failed: ${fileName} exceeds the 5 MB limit.`);
      }

      const hasAllowedExtension = allowedExtensions.has(fileExtension);
      const hasAllowedMime = allowedMimeTypes.has(mimeType);

      if (!hasAllowedExtension || !hasAllowedMime) {
        ctx.throw(
          400,
          `Upload failed: ${fileName} is not an allowed type. Allowed: jpg, jpeg, png, gif, webp, pdf, txt, md, csv.`,
        );
      }
    }

    const adminUserId = ctx?.state?.user?.id;
    if (!adminUserId) {
      return next();
    }

    const key = String(adminUserId);
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key) || [];
    const recent = bucket.filter((timestamp) => timestamp > now - HOUR_IN_MS);

    if (recent.length + files.length > maxUploadsPerHour) {
      ctx.throw(
        429,
        'Upload limit reached: 50 files per hour. Please wait and try again.',
      );
    }

    for (let i = 0; i < files.length; i += 1) {
      recent.push(now);
    }

    rateLimitBuckets.set(key, recent);

    return next();
  };
};
