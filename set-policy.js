const { S3Client, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  endpoint: 'http://localhost:3900',
  region: 'garage',
  credentials: {
    accessKeyId: 'GK8b4a3d6d0a53b398e41bfb93',
    secretAccessKey: '61b89a126b79a9fdb359185c8336a94c012f1be6d1577a3c2157a752a712c881',
  },
  forcePathStyle: true,
});

const policy = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: "*",
      Action: ["s3:GetObject"],
      Resource: ["arn:aws:s3:::gymatrix-image/*"]
    }
  ]
};

async function run() {
  try {
    await s3Client.send(new PutBucketPolicyCommand({
      Bucket: 'gymatrix-image',
      Policy: JSON.stringify(policy)
    }));
    console.log("Successfully set public read policy on bucket.");
  } catch (err) {
    console.error("Error setting policy:", err);
  }
}
run();
