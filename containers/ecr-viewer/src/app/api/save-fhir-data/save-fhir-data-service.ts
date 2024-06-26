import { NextResponse } from "next/server";
import pgPromise from "pg-promise";
import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { Bundle } from "fhir/r4";

const s3Client = new S3Client({ region: process.env.AWS_REGION });

/**
 * Saves a FHIR bundle to a postgres database.
 * @async
 * @function saveToS3
 * @param fhirBundle - The FHIR bundle to be saved.
 * @param ecrId - The unique identifier for the Electronic Case Reporting (ECR) associated with the FHIR bundle.
 * @returns A promise that resolves when the FHIR bundle is successfully saved to postgres.
 * @throws {Error} Throws an error if the FHIR bundle cannot be saved to postgress.
 */
export const saveToPostgres = async (fhirBundle: Bundle, ecrId: string) => {
  const db_url = process.env.DATABASE_URL || "";
  const db = pgPromise();
  const database = db(db_url);

  const { ParameterizedQuery: PQ } = pgPromise;
  const addFhir = new PQ({
    text: "INSERT INTO fhir VALUES ($1, $2) RETURNING ecr_id",
    values: [ecrId, fhirBundle],
  });

  try {
    const saveECR = await database.one(addFhir);

    return NextResponse.json(
      { message: "Success. Saved FHIR Bundle to database: " + saveECR.ecr_id },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Error inserting data to database:", error);
    return NextResponse.json(
      { message: "Failed to insert data to database. " + error.message },
      { status: 400 },
    );
  }
};

/**
 * Saves a FHIR bundle to an AWS S3 bucket.
 * @async
 * @function saveToS3
 * @param fhirBundle - The FHIR bundle to be saved.
 * @param ecrId - The unique identifier for the Electronic Case Reporting (ECR) associated with the FHIR bundle.
 * @returns A promise that resolves when the FHIR bundle is successfully saved to the S3 bucket.
 * @throws {Error} Throws an error if the FHIR bundle cannot be saved to the S3 bucket.
 */
export const saveToS3 = async (fhirBundle: Bundle, ecrId: string) => {
  const bucketName = process.env.ECR_BUCKET_NAME;
  const objectKey = `${ecrId}.json`;
  const body = JSON.stringify(fhirBundle);

  try {
    const input = {
      Body: body,
      Bucket: bucketName,
      Key: objectKey,
      ContentType: "application/json",
    };

    const command = new PutObjectCommand(input);
    const response: PutObjectCommandOutput = await s3Client.send(command);
    const httpStatusCode = response?.$metadata?.httpStatusCode;

    if (httpStatusCode !== 200) {
      throw new Error(`HTTP Status Code: ${httpStatusCode}`);
    }
    return NextResponse.json(
      { message: "Success. Saved FHIR Bundle to S3: " + ecrId },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { message: "Failed to insert data to S3. " + error.message },
      { status: 400 },
    );
  }
};
