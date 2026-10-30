import { MongoClient } from 'mongodb';

export async function connectDatabase(config) {
  const client = new MongoClient(config.mongoUri, {
    tls: true,
    tlsCAFile: config.mongoCertificatePath,
    tlsCertificateKeyFile: config.mongoCertificatePath,
  });

  await client.connect();
  return { client, database: client.db() };
}
