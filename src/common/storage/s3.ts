import { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand, PutBucketCorsCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../../config/env';
import { createLogger } from '../logger/index';

const log = createLogger('s3-init');

export const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  forcePathStyle: true, // required for Garage/MinIO
});

export async function ensureBucketExists() {
  const bucket = config.s3.bucketName;
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    log.info({ bucket }, 'S3 bucket exists');
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      log.info({ bucket }, 'S3 bucket not found, creating...');
      try {
        await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
        log.info({ bucket }, 'S3 bucket created successfully');

        // Note: Garage doesn't support complex ACLs/policies perfectly but supports public read policy.
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublicReadGetObject',
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${bucket}/*`],
            },
          ],
        };
        await s3Client.send(
          new PutBucketPolicyCommand({
            Bucket: bucket,
            Policy: JSON.stringify(policy),
          })
        );
        log.info({ bucket }, 'S3 bucket policy set to public-read');

        // Set CORS policy to allow web app uploads if we ever do presigned URLs (good practice)
        await s3Client.send(
          new PutBucketCorsCommand({
            Bucket: bucket,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedHeaders: ['*'],
                  AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                  AllowedOrigins: ['*'], // In production, restrict to config.publicWebUrl
                  ExposeHeaders: ['ETag'],
                  MaxAgeSeconds: 3000,
                },
              ],
            },
          })
        );
      } catch (createError) {
        log.error({ err: createError, bucket }, 'Failed to create S3 bucket');
      }
    } else {
      log.error({ err: error, bucket }, 'Failed to check S3 bucket');
    }
  }
}

export async function uploadFileToS3(key: string, buffer: Buffer, mimeType: string): Promise<string> {
  const bucket = config.s3.bucketName;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );
  
  if (config.s3.endpoint.includes('localhost')) {
    return `${config.publicApiUrl}${config.apiPrefix}/storage/${bucket}/${key}`;
  }
  return `${config.s3.endpoint}/${bucket}/${key}`;
}

export async function deleteFileFromS3(key: string): Promise<void> {
  const bucket = config.s3.bucketName;
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}
