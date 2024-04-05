'use client'
import { createContext, useContext, ReactNode, useState } from 'react';
import React from "react";
import * as dateFns from "date-fns";
import {
  Bundle,
  Condition,
  FhirResource,
  Immunization,
  Organization,
  Procedure,
} from "fhir/r4";
import { evaluate } from "fhirpath";
import parse from "html-react-parser";
import classNames from "classnames";
import { Table } from "@trussworks/react-uswds";
import {
  evaluateReference,
  evaluateDiagnosticReportData,
  evaluateValue,
} from "@/app/evaluate-service";
import {
  formatAddress,
  formatDate,
  formatName,
  formatPhoneNumber,
  formatStartEndDateTime,
  formatVitals,
  formatDateTime,
} from "@/app/format-service";

export interface DisplayData {
  title: string;
  value?: string | React.JSX.Element | React.JSX.Element[];
}

export interface PathMappings {
  [key: string]: string;
}

export interface ColumnInfoInput {
  columnName: string;
  infoPath: string;
}

export interface CompleteData {
  availableData: DisplayData[];
  unavailableData: DisplayData[];
}

export const evaluatePatientName = (
  fhirBundle: Bundle,
  fhirPathMappings: PathMappings,
) => {
  const givenNames = evaluate(
    fhirBundle,
    fhirPathMappings.patientGivenName,
  ).join(" ");
  const familyName = evaluate(fhirBundle, fhirPathMappings.patientFamilyName);

  return `${givenNames} ${familyName}`;
};

export const extractPatientAddress = (
  fhirBundle: Bundle,
  fhirPathMappings: PathMappings,
) => {
  const streetAddresses = evaluate(
    fhirBundle,
    fhirPathMappings.patientStreetAddress,
  );
  const city = evaluate(fhirBundle, fhirPathMappings.patientCity)[0];
  const state = evaluate(fhirBundle, fhirPathMappings.patientState)[0];
  const zipCode = evaluate(fhirBundle, fhirPathMappings.patientZipCode)[0];
  const country = evaluate(fhirBundle, fhirPathMappings.patientCountry)[0];
  return formatAddress(streetAddresses, city, state, zipCode, country);
};

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

export const extractFacilityAddress = (
  fhirBundle: Bundle,
  fhirPathMappings: PathMappings,
) => {
  const locationResource = extractLocationResource(
    fhirBundle,
    fhirPathMappings,
  );

  const streetAddresses = locationResource?.address?.line;
  const city = locationResource?.address?.city;
  const state = locationResource?.address?.state;
  const zipCode = locationResource?.address?.postalCode;
  const country = locationResource?.address?.country;

  return formatAddress(streetAddresses, city, state, zipCode, country);
};

export const extractFacilityContactInfo = (
  fhirBundle: Bundle,
  fhirPathMappings: PathMappings,
) => {
  const locationResource = extractLocationResource(
    fhirBundle,
    fhirPathMappings,
  );
  const phoneNumbers = locationResource.telecom?.filter(
    (contact: any) => contact.system === "phone",
  );
  return phoneNumbers?.[0].value;
};

export const evaluatePatientContactInfo = (
  fhirBundle: Bundle,
  fhirPathMappings: PathMappings,
) => {
  const phoneNumbers = evaluate(
    fhirBundle,
    fhirPathMappings.patientPhoneNumbers,
  )
    .map(
      (phoneNumber) =>
        `${
          phoneNumber?.use?.charAt(0).toUpperCase() +
          phoneNumber?.use?.substring(1)
        } ${phoneNumber.value}`,
    )
    .join("\n");
  const emails = evaluate(fhirBundle, fhirPathMappings.patientEmails)
    .map((email) => `${email.value}`)
    .join("\n");

  return `${phoneNumbers}\n${emails}`;
};

export const evaluateEncounterDate = (
  fhirBundle: Bundle,
  fhirPathMappings: PathMappings,
) => {
  const startDate = formatDateTime(
    evaluate(fhirBundle, fhirPathMappings.encounterStartDate).join(""),
  );
  const endDate = formatDateTime(
    evaluate(fhirBundle, fhirPathMappings.encounterEndDate).join(""),
  );

  return `Start: ${startDate}
    End: ${endDate}`;
};

/**
 * Formats a table based on the provided resources, mappings, columns, and caption.
 * @param {FhirResource[]} resources - An array of FHIR Resources representing the data entries.
 * @param {PathMappings} mappings - An object containing the FHIR path mappings.
 * @param {ColumnInfoInput[]} columns - An array of objects representing column information.
 *                                      The order of columns in the array determines the order of appearance.
 * @param {string} caption - The caption for the table.
 * @param {boolean} [outerBorder=true] - Optional. Determines whether to include an outer border for the table. Default is true.
 * @returns {React.JSX.Element} - A formatted table React element.
 */
export const evaluateTable = (
  resources: FhirResource[],
  mappings: PathMappings,
  columns: ColumnInfoInput[],
  caption: string,
  outerBorder: boolean = true,
): React.JSX.Element => {
  let headers = columns.map((column, index) => (
    <th
      key={`${column.columnName}${index}`}
      scope="col"
      className="bg-gray-5 minw-15"
    >
      {column.columnName}
    </th>
  ));

  let tableRows = resources.map((entry, index) => {
    let rowCells = columns.map((column, index) => {
      let rowCellData = evaluateValue(entry, mappings[column.infoPath]) || (
        <span className={"text-italic text-base"}>No data</span>
      );
      return (
        <td key={`row-data-${index}`} className="text-top">
          {rowCellData}
        </td>
      );
    });

    return <tr key={`table-row-${index}`}>{rowCells}</tr>;
  });

  return (
    <Table
      fixed={true}
      bordered={false}
      fullWidth={true}
      caption={caption}
      className={classNames("table-caption-margin margin-y-0", {
        "border-top border-left border-right": outerBorder,
      })}
      data-testid="table"
    >
      <thead>
        <tr>{headers}</tr>
      </thead>
      <tbody>{tableRows}</tbody>
    </Table>
  );
};

/**
 * Extracts travel history information from the provided FHIR bundle based on the FHIR path mappings.
 * @param {Bundle} fhirBundle - The FHIR bundle containing patient travel history data.
 * @param {PathMappings} mappings - An object containing the FHIR path mappings.
 * @returns {string | undefined} - A formatted string representing the patient's travel history, or undefined if no relevant data is found.
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

export const calculatePatientAge = (
  fhirBundle: Bundle,
  fhirPathMappings: PathMappings,
) => {
  const patientDOBString = evaluate(fhirBundle, fhirPathMappings.patientDOB)[0];
  if (patientDOBString) {
    const patientDOB = new Date(patientDOBString);
    const today = new Date();
    return dateFns.differenceInYears(today, patientDOB);
  }
};

export const evaluateSocialData = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const socialData: DisplayData[] = [
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

export const evaluateDemographicsData = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const demographicsData: DisplayData[] = [
    {
      title: "Patient Name",
      value: evaluatePatientName(fhirBundle, mappings),
    },
    { title: "DOB", value: evaluate(fhirBundle, mappings.patientDOB)[0] },
    {
      title: "Current Age",
      value: calculatePatientAge(fhirBundle, mappings)?.toString(),
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
      value: evaluate(fhirBundle, mappings.patientId)[0],
    },
  ];
  return evaluateData(demographicsData);
};

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

export const evaluateProviderData = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const providerData = [
    {
      title: "Provider Name",
      value: formatName(
        evaluate(fhirBundle, mappings["providerGivenName"])[0],
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

export const evaluateEcrMetadata = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const rrPerformerReferences = evaluate(fhirBundle, mappings.rrPerformers);

  const rrPerformers: Organization[] = rrPerformerReferences.map((ref) =>
    evaluateReference(fhirBundle, mappings, ref),
  );

  const rrDetails: DisplayData[] = [
    {
      title: "Reportable Condition(s)",
      value: evaluate(fhirBundle, mappings.rrDisplayNames)?.join("\n"),
    },
    {
      title: "RCKMS Trigger Summary",
      value: evaluate(fhirBundle, mappings.rckmsTriggerSummaries)?.join("\n"),
    },
    {
      title: "Jurisdiction(s) Sent eCR",
      value: rrPerformers.map((org) => org.name)?.join("\n"),
    },
  ];
  const eicrDetails: DisplayData[] = [
    {
      title: "eICR Identifier",
      value: evaluate(fhirBundle, mappings.eicrIdentifier)[0],
    },
  ];
  const ecrSenderDetails: DisplayData[] = [
    {
      title: "Date/Time eCR Created",
      value: evaluate(fhirBundle, mappings.dateTimeEcrCreated)[0],
    },
    {
      title: "Sender Software",
      value: evaluate(fhirBundle, mappings.senderSoftware)[0],
    },
    {
      title: "Sender Facility Name",
      value: evaluate(fhirBundle, mappings.senderFacilityName)[0],
    },
    {
      title: "Facility Address",
      value: extractFacilityAddress(fhirBundle, mappings),
    },
    {
      title: "Facility Contact",
      value: evaluate(fhirBundle, mappings.facilityContact)[0],
    },
    {
      title: "Facility ID",
      value: evaluate(fhirBundle, mappings.facilityID)[0],
    },
  ];
  return {
    eicrDetails: evaluateData(eicrDetails),
    ecrSenderDetails: evaluateData(ecrSenderDetails),
    rrDetails: evaluateData(rrDetails),
  };
};

/**
 * Generates a formatted table representing the list of problems based on the provided array of problems and mappings.
 * @param {Condition[]} problemsArray - An array containing the list of problems.
 * @param {PathMappings} mappings - An object containing the FHIR path mappings.
 * @returns {React.JSX.Element | undefined} - A formatted table React element representing the list of problems, or undefined if the problems array is empty.
 */
export const returnProblemsTable = (
  problemsArray: Condition[],
  mappings: PathMappings,
): React.JSX.Element | undefined => {
  if (problemsArray.length === 0) {
    return undefined;
  }

  const columnInfo: ColumnInfoInput[] = [
    { columnName: "Active Problem", infoPath: "activeProblemsDisplay" },
    { columnName: "Onset Age", infoPath: "activeProblemsOnsetAge" },
    { columnName: "Onset Date", infoPath: "activeProblemsOnsetDate" },
  ];

  problemsArray.forEach((entry) => {
    entry.onsetDateTime = formatDate(entry.onsetDateTime);
  });

  problemsArray.sort(
    (a, b) =>
      new Date(b.onsetDateTime ?? "").getTime() -
      new Date(a.onsetDateTime ?? "").getTime(),
  );

  return evaluateTable(problemsArray, mappings, columnInfo, "Problems List");
};

/**
 * Generates a formatted table representing the list of immunizations based on the provided array of immunizations and mappings.
 * @param {Immunization[]} immunizationsArray - An array containing the list of immunizations.
 * @param {PathMappings} mappings - An object containing the FHIR path mappings.
 * @returns {React.JSX.Element | undefined} - A formatted table React element representing the list of immunizations, or undefined if the immunizations array is empty.
 */
export const returnImmunizations = (
  immunizationsArray: Immunization[],
  mappings: PathMappings,
): React.JSX.Element | undefined => {
  if (immunizationsArray.length === 0) {
    return undefined;
  }

  const columnInfo = [
    { columnName: "Name", infoPath: "immunizationsName" },
    { columnName: "Administration Dates", infoPath: "immunizationsAdminDate" },
    { columnName: "Next Due", infoPath: "immunizationsNextDue" },
  ];

  immunizationsArray.forEach((entry) => {
    entry.occurrenceDateTime = formatDate(entry.occurrenceDateTime);
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
 * Generates a formatted table representing the list of procedures based on the provided array of procedures and mappings.
 * @param {Procedure[]} proceduresArray - An array containing the list of procedures.
 * @param {PathMappings} mappings - An object containing FHIR path mappings for procedure attributes.
 * @returns {React.JSX.Element | undefined} - A formatted table React element representing the list of procedures, or undefined if the procedures array is empty.
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

export const evaluateClinicalData = (
  fhirBundle: Bundle,
  mappings: PathMappings,
) => {
  const clinicalNotes: DisplayData[] = [
    {
      title: "Miscellaneous Notes",
      value: parse(
        evaluate(fhirBundle, mappings["historyOfPresentIllness"])[0]?.div || "",
      ),
    },
  ];

  const reasonForVisitData: DisplayData[] = [
    {
      title: "Reason for Visit",
      value: evaluate(fhirBundle, mappings["clinicalReasonForVisit"])[0],
    },
  ];

  const activeProblemsTableData: DisplayData[] = [
    {
      title: "Problems List",
      value: returnProblemsTable(
        evaluate(fhirBundle, mappings["activeProblems"]),
        mappings,
      ),
    },
  ];

  const treatmentData: DisplayData[] = [
    {
      title: "Procedures",
      value: returnProceduresTable(
        evaluate(fhirBundle, mappings["procedures"]),
        mappings,
      ),
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

  const immunizationsData: DisplayData[] = [
    {
      title: "Immunization History",
      value: returnImmunizations(
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
 * @param {DisplayData[]} data - An array of display data items to be evaluated.
 * @returns {CompleteData} - An object containing arrays of available and unavailable display data items.
 */
const evaluateData = (data: DisplayData[]): CompleteData => {
  let availableData: DisplayData[] = [];
  let unavailableData: DisplayData[] = [];
  data.forEach((item) => {
    if (!item.value || (Array.isArray(item.value) && item.value.length === 0)) {
      unavailableData.push(item);
    } else {
      availableData.push(item);
    }
  });
  return { availableData: availableData, unavailableData: unavailableData };
};

/**
 * Functional component for displaying data.
 * @param {object} props - Props for the component.
 * @param {DisplayData} props.item - The display data item to be rendered.
 * @param {string} [props.className] - Additional class name for styling purposes.
 * @returns {React.JSX.Element} - A React element representing the display of data.
 */
export const DataDisplay: React.FC<{
  item: DisplayData;
  className?: string;
}> = ({
  item,
  className,
}: {
  item: DisplayData;
  className?: string;
}): React.JSX.Element => {
  return (
    <div>
      <div className="grid-row">
        <div className="data-title">{item.title}</div>
        <div
          className={classNames("grid-col-auto maxw7 text-pre-line", className)}
        >
          {item.value}
        </div>
      </div>
      <div className={"section__line_gray"} />
    </div>
  );
};

export const DataTableDisplay: React.FC<{ item: DisplayData }> = ({
  item,
}): React.JSX.Element => {
  return (
    <div className="grid-row">
      <div className="grid-col-auto text-pre-line">{item.value}</div>
      <div className={"section__line_gray"} />
    </div>
  );
};

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

/**
 * Evaluates lab information and RR data from the provided FHIR bundle and mappings.
 * @param {Bundle} fhirBundle - The FHIR bundle containing lab and RR data.
 * @param {PathMappings} mappings - An object containing the FHIR path mappings.
 * @returns {{
 *   labInfo: CompleteData,
 *   labResults: React.JSX.Element[]
 * }} An object containing evaluated lab information and lab results.
 */
export const evaluateLabInfoData = (
  fhirBundle: Bundle,
  mappings: PathMappings,
): {
  labInfo: CompleteData;
  labResults: React.JSX.Element[];
} => {
  const labInfo: DisplayData[] = [
    {
      title: "Lab Performing Name",
      value: "",
    },
    {
      title: "Lab Address",
      value: "",
    },
    {
      title: "Lab Contact",
      value: "",
    },
  ];

  const rrData = evaluateDiagnosticReportData(fhirBundle, mappings);

  return {
    labInfo: evaluateData(labInfo),
    labResults: rrData,
  };
};




interface DataContextValue {
    data: any; // You can define a specific data type here
    setData: (data: any) => void;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
    const [data, setData] = useState<any | null>(null);

    return (
        <DataContext.Provider value={{ data, setData }}>
            {children}
        </DataContext.Provider>
    );
}

export function useData() {
    const context = useContext(DataContext);
    if (!context) {
        throw new Error('useData must be used within a DataProvider');
    }
    return context;
}