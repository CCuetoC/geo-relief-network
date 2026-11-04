import { requireServerEnv } from "@/core/server/env";

export interface PrivateObjectStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  private: true;
}

/** Private object-storage credentials; import this module only from server code. */
export function getPrivateObjectStorageConfig(): PrivateObjectStorageConfig {
  return {
    endpoint: requireServerEnv("AWS_ENDPOINT_URL_S3"),
    region: requireServerEnv("AWS_REGION"),
    accessKeyId: requireServerEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requireServerEnv("AWS_SECRET_ACCESS_KEY"),
    bucket: requireServerEnv("OBJECT_STORAGE_BUCKET"),
    private: true,
  };
}
