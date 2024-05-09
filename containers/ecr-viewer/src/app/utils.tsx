import React, { ReactNode, useEffect, useState } from "react";
import * as dateFns from "date-fns";
import {
  Bundle,
  Condition,
  Immunization,
  Procedure,
  Practitioner,
  FhirResource,
  Organization,
} from "fhir/r4";
import { evaluate } from "fhirpath";
import parse from "html-react-parser";
import classNames from "classnames";

import {
  formatAddress,
  formatDate,
  formatName,
  formatPhoneNumber,
  formatStartEndDateTime,
  formatVitals,
  formatTablesToJSON,
  TableRow,
  removeHtmlElements,
  toSentenceCase,
} from "@/app/services/formatService";
import { evaluateTable, evaluateReference } from "./services/evaluateService";
import { Button, Table } from "@trussworks/react-uswds";
import { CareTeamParticipant, CarePlanActivity } from "fhir/r4b";
import { Tooltip } from "@trussworks/react-uswds";

export interface DisplayDataProps {
  title?: string;
  className?: string;
  toolTip?: string;
  value?: string | React.JSX.Element | React.JSX.Element[] | React.ReactNode;
  dividerLine?: boolean;
}

export interface PathMappings {
  [key: string]: string;
}

export interface ColumnInfoInput {
  columnName: string;
  infoPath?: string;
  value?: string;
  className?: string;
  hiddenBaseText?: string;
  applyToValue?: (value: any) => any;
}

export interface CompleteData {
  availableData: DisplayDataProps[];
  unavailableData: DisplayDataProps[];
}

export const noData = (
  <span className="no-data text-italic text-base">No data</span>
);

/**
 * Evaluates patient name from the FHIR bundle and formats it into structured data for display.
 * @param fhirBundle - The FHIR bundle containing patient contact info.
 * @param mappings - The object containing the fhir paths.
 * @returns The formatted patient name
 */
export const evaluatePatientName = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const givenNames = evaluate(fhirBundle, mappings.patientGivenName).join(" ");
  const familyName = evaluate(fhirBundle, mappings.patientFamilyName);

  return `${givenNames} ${familyName}`;
};

/**
 * Evaluates patient address from the FHIR bundle and formats it into structured data for display.
 * @param fhirBundle - The FHIR bundle containing patient contact info.
 * @param mappings - The object containing the fhir paths.
 * @returns The formatted patient address
 */
export const extractPatientAddress = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const streetAddresses = evaluate(fhirBundle, mappings.patientStreetAddress);
  const city = evaluate(fhirBundle, mappings.patientCity)[0];
  const state = evaluate(fhirBundle, mappings.patientState)[0];
  const zipCode = evaluate(fhirBundle, mappings.patientZipCode)[0];
  const country = evaluate(fhirBundle, mappings.patientCountry)[0];
  return formatAddress(streetAddresses, city, state, zipCode, country);
};

/**
 * Extracts a specific location resource from a given FHIR bundle based on defined path mappings.
 * @param fhirBundle - The FHIR bundle object containing various resources, including location resources.
 * @param fhirPathMappings - An object containing FHIR path mappings, which should include a mapping
 *   for `facilityLocation` that determines how to find the location reference within the bundle.
 * @returns The location resource object from the FHIR bundle that matches the UID derived from the
 *   facility location reference. If no matching resource is found, the function returns `undefined`.
 */
function extractLocationResource(
  fhirBundle: Bundle,
  fhirPathMappings: PathMappings,
) {
  const locationReference = evaluate(
    fhirBundle,
    fhirPathMappings.facilityLocation,
  ).join("");
  const locationUID = locationReference.split("/")[1];
  const locationExpression = `Bundle.entry.resource.where(resourceType = 'Location').where(id = '${locationUID}')`;
  return evaluate(fhirBundle, locationExpression)[0];
}

/**
 * Evaluates facility address from the FHIR bundle and formats it into structured data for display.
 * @param fhirBundle - The FHIR bundle containing patient contact info.
 * @param mappings - The object containing the fhir paths.
 * @returns The formatted facility address
 */
export const extractFacilityAddress = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const locationResource = extractLocationResource(fhirBundle, mappings);

  const streetAddresses = locationResource?.address?.line;
  const city = locationResource?.address?.city;
  const state = locationResource?.address?.state;
  const zipCode = locationResource?.address?.postalCode;
  const country = locationResource?.address?.country;

  return formatAddress(streetAddresses, city, state, zipCode, country);
};

/**
 * Evaluates patient contact info from the FHIR bundle and formats it into structured data for display.
 * @param fhirBundle - The FHIR bundle containing patient contact info.
 * @param mappings - The object containing the fhir paths.
 * @returns All phone numbers and emails seperated by new lines
 */
export const evaluatePatientContactInfo = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const phoneNumbers = evaluate(fhirBundle, mappings.patientPhoneNumbers)
    .map(
      (phoneNumber) =>
        `${
          phoneNumber?.use?.charAt(0).toUpperCase() +
          phoneNumber?.use?.substring(1)
        } ${phoneNumber.value}`,
    )
    .join("\n");
  const emails = evaluate(fhirBundle, mappings.patientEmails)
    .map((email) => `${email.value}`)
    .join("\n");

  return `${phoneNumbers}\n${emails}`;
};

/**
 * Extracts travel history information from the provided FHIR bundle based on the FHIR path mappings.
 * @param fhirBundle - The FHIR bundle containing patient travel history data.
 * @param mappings - An object containing the FHIR path mappings.
 * @returns - A formatted string representing the patient's travel history, or undefined if no relevant data is found.
 */
const extractTravelHistory = (
  fhirBundle: Bundle,
  mappings: PathMappings,
): string | undefined => {
  const startDate = evaluate(
    fhirBundle,
    mappings["patientTravelHistoryStartDate"],
  )[0];
  const endDate = evaluate(
    fhirBundle,
    mappings["patientTravelHistoryEndDate"],
  )[0];
  const location = evaluate(
    fhirBundle,
    mappings["patientTravelHistoryLocation"],
  )[0];
  const purposeOfTravel = evaluate(
    fhirBundle,
    mappings["patientTravelHistoryPurpose"],
  )[0];
  if (startDate || endDate || location || purposeOfTravel) {
    return `Dates: ${startDate} - ${endDate}
       Location(s): ${location ?? "No data"}
       Purpose of Travel: ${purposeOfTravel ?? "No data"}
       `;
  }
};

/**
 * Calculates the age of a patient to a given date or today.
 * @param fhirBundle - The FHIR bundle containing patient information.
 * @param fhirPathMappings - The mappings for retrieving patient date of birth.
 * @param [givenDate] - Optional. The target date to calculate the age. Defaults to the current date if not provided.
 * @returns - The age of the patient in years, or undefined if date of birth is not available.
 */
export const calculatePatientAge = (
  fhirBundle: Bundle,
  fhirPathMappings: PathMappings,
  givenDate?: string,
) => {
  const patientDOBString = evaluate(fhirBundle, fhirPathMappings.patientDOB)[0];
  if (patientDOBString) {
    const patientDOB = new Date(patientDOBString);
    const targetDate = givenDate ? new Date(givenDate) : new Date();
    return dateFns.differenceInYears(targetDate, patientDOB);
  }
};

/**
 * Evaluates social data from the FHIR bundle and formats it into structured data for display.
 * @param fhirBundle - The FHIR bundle containing social data.
 * @param mappings - The object containing the fhir paths.
 * @returns An array of evaluated and formatted social data.
 */
export const evaluateSocialData = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const socialData: DisplayDataProps[] = [
    {
      title: "Occupation",
      value: evaluate(fhirBundle, mappings["patientCurrentJobTitle"])[0],
    },
    {
      title: "Tobacco Use",
      value: evaluate(fhirBundle, mappings["patientTobaccoUse"])[0],
    },
    {
      title: "Travel History",
      value: extractTravelHistory(fhirBundle, mappings),
    },
    {
      title: "Homeless Status",
      value: evaluate(fhirBundle, mappings["patientHomelessStatus"])[0],
    },
    {
      title: "Pregnancy Status",
      value: evaluate(fhirBundle, mappings["patientPregnancyStatus"])[0],
    },
    {
      title: "Alcohol Use",
      value: evaluate(fhirBundle, mappings["patientAlcoholUse"])[0],
    },
    {
      title: "Sexual Orientation",
      value: evaluate(fhirBundle, mappings["patientSexualOrientation"])[0],
    },
    {
      title: "Gender Identity",
      value: evaluate(fhirBundle, mappings["patientGenderIdentity"])[0],
    },
    {
      title: "Occupation",
      value: evaluate(fhirBundle, mappings["patientCurrentJobTitle"])[0],
    },
  ];
  return evaluateData(socialData);
};

/**
 * Evaluates demographic data from the FHIR bundle and formats it into structured data for display.
 * @param fhirBundle - The FHIR bundle containing demographic data.
 * @param mappings - The object containing the fhir paths.
 * @returns An array of evaluated and formatted demographic data.
 */
export const evaluateDemographicsData = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const demographicsData: DisplayDataProps[] = [
    {
      title: "Patient Name",
      value: evaluatePatientName(fhirBundle, mappings),
    },
    { title: "DOB", value: evaluate(fhirBundle, mappings.patientDOB)[0] },
    {
      title: "Current Age",
      value: calculatePatientAge(fhirBundle, mappings)?.toString(),
    },
    {
      title: "Vital Status",
      value: evaluate(fhirBundle, mappings.patientVitalStatus)[0]
        ? "Deceased"
        : "Alive",
    },
    { title: "Sex", value: evaluate(fhirBundle, mappings.patientGender)[0] },
    { title: "Race", value: evaluate(fhirBundle, mappings.patientRace)[0] },
    {
      title: "Ethnicity",
      value: evaluate(fhirBundle, mappings.patientEthnicity)[0],
    },
    {
      title: "Tribal Affiliation",
      value: evaluate(fhirBundle, mappings.patientTribalAffiliation)[0],
    },
    {
      title: "Preferred Language",
      value: evaluate(fhirBundle, mappings.patientLanguage)[0],
    },
    {
      title: "Patient Address",
      value: extractPatientAddress(fhirBundle, mappings),
    },
    {
      title: "County",
      value: evaluate(fhirBundle, mappings.patientCounty)[0],
    },
    {
      title: "Contact",
      value: evaluatePatientContactInfo(fhirBundle, mappings),
    },
    {
      title: "Emergency Contact",
      value: evaluateEmergencyContact(fhirBundle, mappings),
    },
    {
      title: "Patient IDs",
      toolTip:
        "Unique patient identifier(s) from their medical record. For example, a patient's social security number or medical record number.",
      value: evaluate(fhirBundle, mappings.patientId)[0],
    },
  ];
  return evaluateData(demographicsData);
};

/**
 * Evaluates encounter data from the FHIR bundle and formats it into structured data for display.
 * @param fhirBundle - The FHIR bundle containing encounter data.
 * @param mappings - The object containing the fhir paths.
 * @returns An array of evaluated and formatted encounter data.
 */
export const evaluateEncounterData = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const encounterData = [
    {
      title: "Encounter Date/Time",
      value: formatStartEndDateTime(
        evaluate(fhirBundle, mappings["encounterStartDate"])[0],
        evaluate(fhirBundle, mappings["encounterEndDate"])[0],
      ),
    },
    {
      title: "Encounter Type",
      value: evaluate(fhirBundle, mappings["encounterType"])[0],
    },
    {
      title: "Facility Name",
      value: evaluate(fhirBundle, mappings["facilityName"])[0],
    },
    {
      title: "Facility Address",
      value: formatAddress(
        evaluate(fhirBundle, mappings["facilityStreetAddress"]),
        evaluate(fhirBundle, mappings["facilityCity"])[0],
        evaluate(fhirBundle, mappings["facilityState"])[0],
        evaluate(fhirBundle, mappings["facilityZipCode"])[0],
        evaluate(fhirBundle, mappings["facilityCountry"])[0],
      ),
    },
    {
      title: "Facility Contact",
      value: formatPhoneNumber(
        evaluate(fhirBundle, mappings["facilityContact"])[0],
      ),
    },
    {
      title: "Facility Type",
      value: evaluate(fhirBundle, mappings["facilityType"])[0],
    },
    {
      title: "Facility ID",
      value: evaluate(fhirBundle, mappings["facilityID"])[0],
    },
  ];
  return evaluateData(encounterData);
};

/**
 * Evaluates provider data from the FHIR bundle and formats it into structured data for display.
 * @param fhirBundle - The FHIR bundle containing provider data.
 * @param mappings - The object containing the fhir paths.
 * @returns An array of evaluated and formatted provider data.
 */
export const evaluateProviderData = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const providerData = [
    {
      title: "Provider Name",
      value: formatName(
        evaluate(fhirBundle, mappings["providerGivenName"]),
        evaluate(fhirBundle, mappings["providerFamilyName"])[0],
      ),
    },
    {
      title: "Provider Contact",
      value: formatPhoneNumber(
        evaluate(fhirBundle, mappings["providerContact"])[0],
      ),
    },
  ];
  return evaluateData(providerData);
};

/**
 * Generates a formatted table representing the list of problems based on the provided array of problems and mappings.
 * @param fhirBundle - The FHIR bundle containing patient information.
 * @param problemsArray - An array containing the list of problems.
 * @param mappings - An object containing the FHIR path mappings.
 * @returns - A formatted table React element representing the list of problems, or undefined if the problems array is empty.
 */
export const returnProblemsTable = (
  fhirBundle: Bundle,
  problemsArray: Condition[],
  mappings: PathMappings,
): React.JSX.Element | undefined => {
  problemsArray = problemsArray.filter(
    (entry) => entry.code?.coding?.[0].display,
  );

  if (problemsArray.length === 0) {
    return undefined;
  }

  const columnInfo: ColumnInfoInput[] = [
    {
      columnName: "Active Problem",
      infoPath: "activeProblemsDisplay",
      className: "width-mobile-lg",
    },
    { columnName: "Onset Date", infoPath: "activeProblemsOnsetDate" },
    { columnName: "Onset Age", infoPath: "activeProblemsOnsetAge" },
  ];

  problemsArray.forEach((entry) => {
    entry.onsetDateTime = formatDate(entry.onsetDateTime);
    entry.onsetAge = {
      value: calculatePatientAge(fhirBundle, mappings, entry.onsetDateTime),
    };
  });

  if (problemsArray.length === 0) {
    return undefined;
  }

  problemsArray.sort(
    (a, b) =>
      new Date(b.onsetDateTime ?? "").getTime() -
      new Date(a.onsetDateTime ?? "").getTime(),
  );

  return evaluateTable(
    problemsArray,
    mappings,
    columnInfo,
    "Problems List",
    false,
  );
};

/**
 * Returns a table displaying pending results information.
 * @param fhirBundle - The FHIR bundle containing care team data.
 * @param mappings - The object containing the fhir paths.
 * @returns The JSX element representing the table, or undefined if no pending results are found.
 */
export const returnPendingResultsTable = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const planOfTreatmentTables = formatTablesToJSON(
    evaluate(fhirBundle, mappings["planOfTreatment"])[0]?.div,
  );
  const pendingResultsTableJson = planOfTreatmentTables.find(
    (val) => val.resultName === "Pending Results",
  );

  if (pendingResultsTableJson?.tables?.[0]) {
    const header = [
      "Name",
      "Type",
      "Priority",
      "Associated Diagnoses",
      "Date/Time",
    ];

    return (
      <Table
        bordered={false}
        fullWidth={true}
        className={
          "table-caption-margin caption-normal-weight margin-top-0 border-top border-left border-right margin-bottom-2"
        }
        data-testid="table"
        caption={"Pending Results"}
      >
        <thead>
          <tr>
            {header.map((column) => (
              <th key={`${column}`} scope="col" className="bg-gray-5 minw-15">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pendingResultsTableJson.tables[0].map(
            (entry: TableRow, index: number) => {
              return (
                <tr key={`table-row-${index}`}>
                  <td>{entry.Name?.value ?? noData}</td>
                  <td>{entry.Type?.value ?? noData}</td>
                  <td>{entry.Priority?.value ?? noData}</td>
                  <td>{entry.AssociatedDiagnoses?.value ?? noData}</td>
                  <td>{entry["Date/Time"]?.value ?? noData}</td>
                </tr>
              );
            },
          )}
        </tbody>
      </Table>
    );
  }
};

/**
 * Returns a table displaying scheduled order information.
 * @param fhirBundle - The FHIR bundle containing care team data.
 * @param mappings - The object containing the fhir paths.
 * @returns The JSX element representing the table, or undefined if no scheduled orders are found.
 */
export const returnScheduledOrdersTable = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const planOfTreatmentTables = formatTablesToJSON(
    evaluate(fhirBundle, mappings["planOfTreatment"])[0]?.div,
  );
  const scheduledOrdersTableJson = planOfTreatmentTables.find(
    (val) => val.resultName === "Scheduled Orders",
  );

  if (scheduledOrdersTableJson?.tables?.[0]) {
    const header = [
      "Name",
      "Type",
      "Priority",
      "Associated Diagnoses",
      "Date/Time",
    ];

    return (
      <Table
        bordered={false}
        fullWidth={true}
        className={
          "table-caption-margin margin-top-1 caption-normal-weight margin-y-0 border-top border-left border-right"
        }
        data-testid="table"
        caption={"Scheduled Orders"}
      >
        <thead>
          <tr>
            {header.map((column) => (
              <th key={`${column}`} scope="col" className="bg-gray-5 minw-15">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scheduledOrdersTableJson.tables[0].map(
            (entry: TableRow, index: number) => {
              return (
                <tr key={`table-row-${index}`}>
                  <td>{entry.Name?.value ?? noData}</td>
                  <td>{entry.Type?.value ?? noData}</td>
                  <td>{entry.Priority?.value ?? noData}</td>
                  <td>{entry.AssociatedDiagnoses?.value ?? noData}</td>
                  <td>{entry["Date/Time"]?.value ?? noData}</td>
                </tr>
              );
            },
          )}
        </tbody>
      </Table>
    );
  }
};

/**
 * Returns a table displaying administered medication information.
 * @param fhirBundle - The FHIR bundle containing care team data.
 * @param mappings - The object containing the fhir paths.
 * @returns The JSX element representing the table, or undefined if no administed medications are found.
 */
export const returnAdminMedTable = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const adminMedTables = formatTablesToJSON(
    evaluate(fhirBundle, mappings["administeredMedications"])[0]?.div,
  );
  const adminMedJson = adminMedTables[0]?.tables?.[0];
  if (
    adminMedJson &&
    adminMedJson[0]["Medication Name"] &&
    adminMedJson[0]["Medication Start Date"]
  ) {
    const header = ["Medication Name", "Medication Start Date"];
    return (
      <Table
        bordered={false}
        fullWidth={true}
        caption="Administered Medications"
        className={
          "table-caption-margin margin-y-0 border-top border-left border-right"
        }
        data-testid="table"
      >
        <thead>
          <tr>
            {header.map((column) => (
              <th key={`${column}`} scope="col" className="bg-gray-5 minw-15">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {adminMedJson.map((entry: TableRow, index: number) => {
            const entryDate = entry["Medication Start Date"].value;
            const formattedDate = formatDate(entryDate);
            return (
              <tr key={`table-row-${index}`}>
                <td>{entry["Medication Name"]?.value ?? noData}</td>
                <td>{formattedDate ?? noData}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    );
  }
};

/**
 * Generates a formatted table representing the list of immunizations based on the provided array of immunizations and mappings.
 * @param fhirBundle - The FHIR bundle containing patient and immunizations information.
 * @param immunizationsArray - An array containing the list of immunizations.
 * @param mappings - An object containing the FHIR path mappings.
 * @returns - A formatted table React element representing the list of immunizations, or undefined if the immunizations array is empty.
 */
export const returnImmunizations = (
  fhirBundle: Bundle,
  immunizationsArray: Immunization[],
  mappings: PathMappings,
): React.JSX.Element | undefined => {
  if (immunizationsArray.length === 0) {
    return undefined;
  }

  const columnInfo = [
    { columnName: "Name", infoPath: "immunizationsName" },
    { columnName: "Administration Dates", infoPath: "immunizationsAdminDate" },
    { columnName: "Dose Number", infoPath: "immunizationsDoseNumber" },
    {
      columnName: "Manufacturer",
      infoPath: "immunizationsManufacturerName",
    },
    { columnName: "Lot Number", infoPath: "immunizationsLotNumber" },
  ];

  immunizationsArray.forEach((entry) => {
    entry.occurrenceDateTime = formatDate(entry.occurrenceDateTime);

    const manufacturer = evaluateReference(
      fhirBundle,
      mappings,
      entry.manufacturer?.reference || "",
    ) as Organization;
    if (manufacturer) {
      (entry.manufacturer as any).name = manufacturer.name || "";
    }
  });

  immunizationsArray.sort(
    (a, b) =>
      new Date(b.occurrenceDateTime ?? "").getTime() -
      new Date(a.occurrenceDateTime ?? "").getTime(),
  );

  return evaluateTable(
    immunizationsArray,
    mappings,
    columnInfo,
    "Immunization History",
  );
};

/**
 * Returns a table displaying care team information.
 * @param bundle - The FHIR bundle containing care team data.
 * @param mappings - The object containing the fhir paths.
 * @returns The JSX element representing the care team table, or undefined if no care team participants are found.
 */
export const returnCareTeamTable = (
  bundle: Bundle,
  mappings: PathMappings,
): React.JSX.Element | undefined => {
  const careTeamParticipants: CareTeamParticipant[] = evaluate(
    bundle,
    mappings["careTeamParticipants"],
  );
  if (careTeamParticipants.length === 0) {
    return undefined;
  }

  const columnInfo: ColumnInfoInput[] = [
    { columnName: "Member", infoPath: "careTeamParticipantMemberName" },
    { columnName: "Role", infoPath: "careTeamParticipantRole" },
    {
      columnName: "Status",
      infoPath: "careTeamParticipantStatus",
      applyToValue: toSentenceCase,
    },
    { columnName: "Dates", infoPath: "careTeamParticipantPeriod" },
  ];

  careTeamParticipants.forEach((entry) => {
    if (entry?.period) {
      const textArray: String[] = [];

      if (entry.period.start) {
        let startDate = formatDate(entry.period.start);
        if (startDate !== "Invalid Date") {
          textArray.push(`Start: ${startDate}`);
        }
      }

      if (entry.period.end) {
        let endDate = formatDate(entry.period.end);
        if (endDate !== "Invalid Date") {
          textArray.push(`End: ${endDate}`);
        }
      }

      (entry.period as any).text = textArray.join(" ");
    }

    const practitioner = evaluateReference(
      bundle,
      mappings,
      entry?.member?.reference || "",
    ) as Practitioner;
    const practitionerNameObj = practitioner.name?.find(
      (nameObject) => nameObject.family,
    );
    if (entry.member) {
      (entry.member as any).name = formatName(
        practitionerNameObj?.given,
        practitionerNameObj?.family,
        practitionerNameObj?.prefix,
        practitionerNameObj?.suffix,
      );
    }
  });

  return evaluateTable(
    careTeamParticipants as FhirResource[],
    mappings,
    columnInfo,
    "Care Team",
    false,
  );
};

/**
 * Generates a formatted table representing the list of procedures based on the provided array of procedures and mappings.
 * @param proceduresArray - An array containing the list of procedures.
 * @param mappings - An object containing FHIR path mappings for procedure attributes.
 * @returns - A formatted table React element representing the list of procedures, or undefined if the procedures array is empty.
 */
export const returnProceduresTable = (
  proceduresArray: Procedure[],
  mappings: PathMappings,
): React.JSX.Element | undefined => {
  if (proceduresArray.length === 0) {
    return undefined;
  }

  const columnInfo: ColumnInfoInput[] = [
    { columnName: "Name", infoPath: "procedureName" },
    { columnName: "Date Performed", infoPath: "procedureDate" },
    { columnName: "Reason", infoPath: "procedureReason" },
  ];

  proceduresArray.forEach((entry) => {
    entry.performedDateTime = formatDate(entry.performedDateTime);
  });

  proceduresArray.sort(
    (a, b) =>
      new Date(b.performedDateTime ?? "").getTime() -
      new Date(a.performedDateTime ?? "").getTime(),
  );

  return evaluateTable(proceduresArray, mappings, columnInfo, "Procedures");
};

/**
 * Generates a formatted table representing the list of planned procedures
 * @param carePlanActivities - An array containing the list of procedures.
 * @param mappings - An object containing FHIR path mappings for procedure attributes.
 * @returns - A formatted table React element representing the list of planned procedures, or undefined if the procedures array is empty.
 */
export const returnPlannedProceduresTable = (
  carePlanActivities: CarePlanActivity[],
  mappings: PathMappings,
): React.JSX.Element | undefined => {
  carePlanActivities = carePlanActivities.filter(
    (entry) => entry.detail?.code?.coding?.[0]?.display,
  );
  if (carePlanActivities.length === 0) {
    return undefined;
  }

  const columnInfo: ColumnInfoInput[] = [
    { columnName: "Procedure Name", infoPath: "plannedProcedureName" },
    {
      columnName: "Ordered Date",
      infoPath: "plannedProcedureOrderedDate",
      applyToValue: formatDate,
    },
    {
      columnName: "Scheduled Date",
      infoPath: "plannedProcedureScheduledDate",
      applyToValue: formatDate,
    },
  ];

  return evaluateTable(
    carePlanActivities,
    mappings,
    columnInfo,
    "Planned Procedures",
  );
};

/**
 * Evaluates clinical data from the FHIR bundle and formats it into structured data for display.
 * @param fhirBundle - The FHIR bundle containing clinical data.
 * @param mappings - The object containing the fhir paths.
 * @returns An object containing evaluated and formatted clinical data.
 * @property {DisplayDataProps[]} clinicalNotes - Clinical notes data.
 * @property {DisplayDataProps[]} reasonForVisitDetails - Reason for visit details.
 * @property {DisplayDataProps[]} activeProblemsDetails - Active problems details.
 * @property {DisplayDataProps[]} treatmentData - Treatment-related data.
 * @property {DisplayDataProps[]} vitalData - Vital signs data.
 * @property {DisplayDataProps[]} immunizationsDetails - Immunization details.
 */
export const evaluateClinicalData = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const clinicalNotes: DisplayDataProps[] = [
    {
      title: "Miscellaneous Notes",
      value: parse(
        evaluate(fhirBundle, mappings["historyOfPresentIllness"])[0]?.div || "",
      ),
    },
  ];

  const reasonForVisitData: DisplayDataProps[] = [
    {
      title: "Reason for Visit",
      value: evaluate(fhirBundle, mappings["clinicalReasonForVisit"])[0],
    },
  ];

  const activeProblemsTableData: DisplayDataProps[] = [
    {
      title: "Problems List",
      value: returnProblemsTable(
        fhirBundle,
        evaluate(fhirBundle, mappings["activeProblems"]),
        mappings,
      ),
    },
  ];

  const pendingResults = returnPendingResultsTable(fhirBundle, mappings);
  const scheduledOrders = returnScheduledOrdersTable(fhirBundle, mappings);
  let planOfTreatmentElement: React.JSX.Element | undefined = undefined;
  if (pendingResults) {
    planOfTreatmentElement = (
      <>
        <div className={"data-title margin-bottom-1"}>Plan of Treatment</div>
        {pendingResults}
        {scheduledOrders}
      </>
    );
  }

  const adminMedResults = returnAdminMedTable(fhirBundle, mappings);
  let adminMedElement: React.JSX.Element | undefined = adminMedResults ? (
    <>{adminMedResults}</>
  ) : undefined;

  const treatmentData: DisplayDataProps[] = [
    {
      title: "Procedures",
      value: returnProceduresTable(
        evaluate(fhirBundle, mappings["procedures"]),
        mappings,
      ),
    },
    {
      title: "Planned Procedures",
      value: returnPlannedProceduresTable(
        evaluate(fhirBundle, mappings["plannedProcedures"]),
        mappings,
      ),
    },
    {
      title: "Plan of Treatment",
      value: planOfTreatmentElement,
    },
    {
      title: "Administered Medications",
      value: adminMedElement,
    },
    {
      title: "Care Team",
      value: returnCareTeamTable(fhirBundle, mappings),
    },
  ];

  const vitalData = [
    {
      title: "Vital Signs",
      value: formatVitals(
        evaluate(fhirBundle, mappings["patientHeight"])[0],
        evaluate(fhirBundle, mappings["patientHeightMeasurement"])[0],
        evaluate(fhirBundle, mappings["patientWeight"])[0],
        evaluate(fhirBundle, mappings["patientWeightMeasurement"])[0],
        evaluate(fhirBundle, mappings["patientBmi"])[0],
      ),
    },
  ];

  const immunizationsData: DisplayDataProps[] = [
    {
      title: "Immunization History",
      value: returnImmunizations(
        fhirBundle,
        evaluate(fhirBundle, mappings["immunizations"]),
        mappings,
      ),
    },
  ];
  return {
    clinicalNotes: evaluateData(clinicalNotes),
    reasonForVisitDetails: evaluateData(reasonForVisitData),
    activeProblemsDetails: evaluateData(activeProblemsTableData),
    treatmentData: evaluateData(treatmentData),
    vitalData: evaluateData(vitalData),
    immunizationsDetails: evaluateData(immunizationsData),
  };
};

/**
 * Evaluates the provided display data to determine availability.
 * @param data - An array of display data items to be evaluated.
 * @returns - An object containing arrays of available and unavailable display data items.
 */
export const evaluateData = (data: DisplayDataProps[]): CompleteData => {
  let availableData: DisplayDataProps[] = [];
  let unavailableData: DisplayDataProps[] = [];
  data.forEach((item) => {
    if (!isDataAvailable(item)) {
      unavailableData.push(item);
    } else {
      availableData.push(item);
    }
  });
  return { availableData: availableData, unavailableData: unavailableData };
};

/**
 * Checks if data is available based on DisplayDataProps value. Also filters out terms that indicate info is unavailable.
 * @param item - The DisplayDataProps object to check for availability.
 * @returns - Returns true if data is available, false otherwise.
 */
export const isDataAvailable = (item: DisplayDataProps): Boolean => {
  if (!item.value || (Array.isArray(item.value) && item.value.length === 0))
    return false;
  const unavailableTerms = [
    "Not on file",
    "Not on file documented in this encounter",
    "Unknown",
    "Unknown if ever smoked",
    "Tobacco smoking consumption unknown",
    "Do not know",
    "No history of present illness information available",
  ];
  for (const i in unavailableTerms) {
    if (removeHtmlElements(`${item.value}`).trim() === unavailableTerms[i]) {
      return false;
    }
  }
  return true;
};

/**
 * Functional component for displaying data.
 * @param props - Props for the component.
 * @param props.item - The display data item to be rendered.
 * @param [props.className] - Additional class name for styling purposes.
 * @returns - A React element representing the display of data.
 */
export const DataDisplay: React.FC<{
  item: DisplayDataProps;
  className?: string;
}> = ({
  item,
  className,
}: {
  item: DisplayDataProps;
  className?: string;
}): React.JSX.Element => {
  item.dividerLine =
    item.dividerLine == null || item.dividerLine == undefined
      ? true
      : item.dividerLine;
  return (
    <div>
      <div className="grid-row">
        <div className="data-title">
          {toolTipElement(item.title, item.toolTip)}
        </div>
        <div
          className={classNames(
            "grid-col-auto maxw7 text-pre-line",
            className,
            item.className ? item.className : "",
          )}
        >
          <FieldValue>{item.value}</FieldValue>
        </div>
      </div>
      {item.dividerLine ? <div className={"section__line_gray"} /> : ""}
    </div>
  );
};

/**
 * Functional component for displaying a value. If the value has a length greater than 500 characters, it will be split after 300 characters with a view more button to view the entire value.
 * @param value - props for the component
 * @param value.children - the value to be displayed in the value
 * @returns - A React element representing the display of the value
 */
const FieldValue: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const maxLength = 500;
  const cutLength = 300;
  const [hidden, setHidden] = useState(true);
  const [fieldValue, setFieldValue] = useState(children);
  const valueLength = getReactNodeLength(children);
  const cutField = trimField(children, cutLength, setHidden).value;
  useEffect(() => {
    if (valueLength > maxLength) {
      if (hidden) {
        setFieldValue(cutField);
      } else {
        setFieldValue(
          <>
            {children}&nbsp;
            <Button
              type={"button"}
              unstyled={true}
              onClick={() => setHidden(true)}
            >
              View less
            </Button>
          </>,
        );
      }
    }
  }, [hidden]);

  return fieldValue;
};

/**
 * Recursively determine the character length of a ReactNode
 * @param value - react node to be measured
 * @returns - the number of characters in the ReactNode
 */
const getReactNodeLength = (value: React.ReactNode): number => {
  if (typeof value === "string") {
    return value.length;
  } else if (Array.isArray(value)) {
    let count = 0;
    value.forEach((val) => (count += getReactNodeLength(val)));
    return count;
  } else if (React.isValidElement(value) && value.props.children) {
    return getReactNodeLength(value.props.children);
  }
  return 0;
};

/**
 * Create an element with `remainingLength` length followed by a view more button
 * @param value - the value that will be cut
 * @param remainingLength - the length of how long the returned element will be
 * @param setHidden - a function used to signify that the view more button has been clicked.
 * @returns - an object with the shortened value and the length left over.
 */
const trimField = (
  value: React.ReactNode,
  remainingLength: number,
  setHidden: (val: boolean) => void,
): { value: React.ReactNode; remainingLength: number } => {
  if (remainingLength < 1) {
    return { value: null, remainingLength };
  }
  if (typeof value === "string") {
    const cutString = value.substring(0, remainingLength);
    if (remainingLength - cutString.length === 0) {
      return {
        value: (
          <>
            {cutString}...&nbsp;
            <Button
              type={"button"}
              unstyled={true}
              onClick={() => setHidden(false)}
            >
              View more
            </Button>
          </>
        ),
        remainingLength: 0,
      };
    }
    return {
      value: cutString,
      remainingLength: remainingLength - cutString.length,
    };
  } else if (Array.isArray(value)) {
    let newValArr = [];
    for (let i = 0; i < value.length; i++) {
      let splitVal = trimField(value[i], remainingLength, setHidden);
      remainingLength = splitVal.remainingLength;
      newValArr.push(
        <React.Fragment key={`arr-${i}-${splitVal.value}`}>
          {splitVal.value}
        </React.Fragment>,
      );
    }
    return { value: newValArr, remainingLength: remainingLength };
  } else if (React.isValidElement(value) && value.props.children) {
    let childrenCopy: ReactNode;
    if (Array.isArray(value.props.children)) {
      childrenCopy = [...value.props.children];
    } else {
      childrenCopy = value.props.children;
    }
    let split = trimField(childrenCopy, remainingLength, setHidden);
    const newElement = React.cloneElement(
      value,
      { ...value.props },
      split.value,
    );
    return { value: newElement, remainingLength: split.remainingLength };
  }
  return { value, remainingLength: remainingLength };
};

/**
 * Evaluates emergency contact information from the FHIR bundle and formats it into a readable string.
 * @param fhirBundle - The FHIR bundle containing patient information.
 * @param mappings - The object containing the fhir paths.
 * @returns The formatted emergency contact information.
 */
export const evaluateEmergencyContact = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const contact = evaluate(fhirBundle, mappings.patientEmergencyContact)[0];

  let formattedContact;

  if (contact) {
    if (contact.relationship) {
      const relationship = contact.relationship;
      formattedContact = `${relationship}`;
    }

    if (contact.address) {
      const address = formatAddress(
        contact.address[0].line,
        contact.address[0].city,
        contact.address[0].state,
        contact.address[0].postalCode,
        contact.address[0].country,
      );

      formattedContact = `${formattedContact}\n${address}`;
    }

    if (contact.telecom) {
      const phoneNumbers = evaluate(fhirBundle, mappings.patientPhoneNumbers)
        .map(
          (phoneNumber) =>
            `${
              phoneNumber?.use?.charAt(0).toUpperCase() +
              phoneNumber?.use?.substring(1)
            } ${phoneNumber.value}`,
        )
        .join("\n");

      formattedContact = `${formattedContact}\n${phoneNumbers}`;
    }

    return formattedContact;
  }
};

type CustomDivProps = React.PropsWithChildren<{
  className?: string;
}> &
  JSX.IntrinsicElements["div"] &
  React.RefAttributes<HTMLDivElement>;

/**
 * `CustomDivForwardRef` is a React forward reference component that renders a div element
 *  with extended capabilities. This component supports all standard div properties along with
 *  additional features provided by `tooltipProps`.
 * @component
 * @param props - The props for the CustomDiv component.
 * @param props.className - CSS class to apply to the div element.
 * @param props.children - Child elements or content to be rendered within the div.
 * @param props.tooltipProps - Additional props to be spread into the div element, typically used for tooltip logic or styling.
 * @param ref - Ref forwarded to the div element.
 * @returns A React element representing a customizable div.
 */
export const CustomDivForwardRef: React.ForwardRefRenderFunction<
  HTMLDivElement,
  CustomDivProps
> = ({ className, children, ...tooltipProps }: CustomDivProps, ref) => (
  <div ref={ref} className={className} {...tooltipProps}>
    {children}
  </div>
);

export const TooltipDiv = React.forwardRef(CustomDivForwardRef);

/**
 * Creates a tooltip-wrapped element if a tooltip text is provided, or returns the content directly otherwise.
 * The tooltip is only applied when the `toolTip` parameter is not null or undefined. If the tooltip text
 * is less than 100 characters, a specific class `short-tooltip` is added to style the tooltip differently.
 * @param content - The content to be displayed, which can be any valid React node or text.
 * @param toolTip - The text for the tooltip. If this is provided, the content will be wrapped in a tooltip.
 * @returns A React JSX element containing either the plain content or content wrapped in a tooltip, depending on the tooltip parameter.
 */
export const toolTipElement = (
  content: string | undefined | null,
  toolTip: string | undefined | null,
): React.JSX.Element => {
  return toolTip ? (
    <Tooltip
      label={toolTip}
      asCustom={TooltipDiv}
      className={`usa-tooltip${toolTip.length < 100 ? " short-tooltip" : ""}`}
    >
      {content}
    </Tooltip>
  ) : (
    <>{content}</>
  );
};
