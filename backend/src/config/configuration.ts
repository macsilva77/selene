function loadConfiguration() {
  return {
    port: Number.parseInt(process.env['PORT'] ?? '3000', 10) || 3000,
    nodeEnv: process.env['NODE_ENV'] || 'development',
    appUrl: process.env['APP_URL'] || 'http://localhost:3000',
    frontendUrl: process.env['FRONTEND_URL'] || 'https://sigic.inovaprojetosti.com.br',

    database: {
      url: process.env['DATABASE_URL'],
    },

    redis: {
      host: process.env['REDIS_HOST'] || 'localhost',
      port: Number.parseInt(process.env['REDIS_PORT'] ?? '6379', 10) || 6379,
      password: process.env['REDIS_PASSWORD'] || undefined,
    },

    jwt: {
      secret: process.env['JWT_SECRET'] || 'change-me-in-production',
      expiresIn: process.env['JWT_EXPIRES_IN'] || '8h',
      refreshSecret: process.env['JWT_REFRESH_SECRET'] || 'change-me-refresh',
      refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] || '7d',
    },

    smtp: {
      host: process.env['SMTP_HOST'] || 'localhost',
      port: Number.parseInt(process.env['SMTP_PORT'] ?? '587', 10) || 587,
      user: process.env['SMTP_USER'] || '',
      pass: process.env['SMTP_PASS'] || '',
      from: process.env['SMTP_FROM'] || 'Selene <noreply@selene.app>',
    },

    certEncryptionKey: process.env['CERT_ENCRYPTION_KEY'] ?? '',

    gcs: {
      projectId: process.env['GCS_PROJECT_ID'] || '',
      bucketName: process.env['GCS_BUCKET_NAME'] || '',
    },

    pubsub: {
      // Reutiliza GCS_PROJECT_ID se PUBSUB_PROJECT_ID não for definido
      projectId: process.env['PUBSUB_PROJECT_ID'] || process.env['GCS_PROJECT_ID'] || '',
      topicNfeRecebida:    process.env['PUBSUB_TOPIC_NFE_RECEBIDA']    || '',
      topicCienciaEnviada: process.env['PUBSUB_TOPIC_CIENCIA_ENVIADA'] || '',
      topicNfeBaixada:     process.env['PUBSUB_TOPIC_NFE_BAIXADA']     || '',
    },

    storage: {
      endpoint: process.env['STORAGE_ENDPOINT'] || 'http://localhost:9000',
      bucket: process.env['STORAGE_BUCKET'] || 'sigic-documents',
      accessKey: process.env['STORAGE_ACCESS_KEY'] || '',
      secretKey: process.env['STORAGE_SECRET_KEY'] || '',
      region: process.env['STORAGE_REGION'] || 'us-east-1',
    },

    throttle: {
      ttl: Number.parseInt(process.env['THROTTLE_TTL'] ?? '60', 10) || 60,
      limit: Number.parseInt(process.env['THROTTLE_LIMIT'] ?? '100', 10) || 100,
    },

    notificationCron: process.env['NOTIFICATION_CRON'] || '5 3 * * *',

    // Mínimo de 365 dias para atender compliance (prazo prescricional administrativo)
    auditRetentionDays: Math.max(
      365,
      Number.parseInt(process.env['AUDIT_RETENTION_DAYS'] ?? '1825', 10) || 1825,
    ),
  };
}

export default loadConfiguration;
