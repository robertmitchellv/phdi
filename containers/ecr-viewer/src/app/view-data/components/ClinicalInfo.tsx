import {
  AccordionSection,
  AccordionH4,
  AccordionDiv,
} from "../component-utils";
import React from "react";
import { addCaptionToTable } from "@/app/services/formatService";
import { DataDisplay, DisplayDataProps } from "@/app/DataDisplay";

interface ClinicalProps {
  reasonForVisitDetails: DisplayDataProps[];
  activeProblemsDetails: DisplayDataProps[];
  vitalData: DisplayDataProps[];
  immunizationsDetails: DisplayDataProps[];
  treatmentData: DisplayDataProps[];
  clinicalNotes: DisplayDataProps[];
}

/**
 * Functional component for displaying data in a data table.
 * @param props - Props containing the item to be displayed.
 * @param props.item - The data item to be displayed.
 * @returns The JSX element representing the data table display.
 */
const DataTableDisplay: React.FC<{ item: DisplayDataProps }> = ({
  item,
}): React.JSX.Element => {
  return (
    <div className="grid-row">
      <div className="grid-col-auto width-full text-pre-line">{item.value}</div>
      <div className={"section__line_gray"} />
    </div>
  );
};

/**
 * Functional component for displaying clinical information.
 * @param props - Props containing clinical information.
 * @param props.reasonForVisitDetails - The details of the reason for visit.
 * @param props.activeProblemsDetails - The details of active problems.
 * @param props.immunizationsDetails - The details of immunizations.
 * @param props.vitalData - The vital signs data.
 * @param props.treatmentData - The details of treatments.
 * @param props.clinicalNotes - The clinical notes data.
 * @returns The JSX element representing the clinical information.
 */
export const ClinicalInfo = ({
  reasonForVisitDetails,
  activeProblemsDetails,
  immunizationsDetails,
  vitalData,
  treatmentData,
  clinicalNotes,
}: ClinicalProps) => {
  const renderTableDetails = (tableDetails: DisplayDataProps[]) => {
    return (
      <div>
        {tableDetails.map((item, index) => (
          <div key={index}>
            <div className="grid-col-auto text-pre-line">{item.value}</div>
            <div className={"section__line_gray"} />
          </div>
        ))}
      </div>
    );
  };

  const renderClinicalNotes = () => {
    return (
      <>
        <AccordionH4 id={"clinical-notes"}>Clinical Notes</AccordionH4>
        <AccordionDiv className={"clinical_info_container"}>
          {clinicalNotes.map((item, index) => {
            if (
              React.isValidElement(item.value) &&
              item.value.type == "table"
            ) {
              const modItem = {
                ...item,
                value: addCaptionToTable(
                  item.value,
                  "Miscellaneous Notes",
                  "Clinical notes from various parts of a medical record. Type of note found here depends on how the provider's EHR system onboarded to send eCR.",
                ),
              };
              return (
                <React.Fragment key={index}>
                  {renderTableDetails([modItem])}
                </React.Fragment>
              );
            }
            return <DataDisplay item={item} key={index} />;
          })}
        </AccordionDiv>
      </>
    );
  };

  const renderSymptomsAndProblems = () => {
    return (
      <>
        <AccordionH4 id={"symptoms-and-problems"}>
          Symptoms and Problems
        </AccordionH4>
        <AccordionDiv>
          <div data-testid="reason-for-visit">
            {reasonForVisitDetails.map((item, index) => (
              <DataDisplay item={item} key={index} />
            ))}
          </div>
          <div data-testid="active-problems">
            {renderTableDetails(activeProblemsDetails)}
          </div>
        </AccordionDiv>
      </>
    );
  };

  const renderImmunizationsDetails = () => {
    return (
      <>
        <AccordionH4 id={"immunizations"}>Immunizations</AccordionH4>
        <AccordionDiv>
          <div
            className="immunization_table"
            data-testid="immunization-history"
          >
            {renderTableDetails(immunizationsDetails)}
          </div>
        </AccordionDiv>
      </>
    );
  };

  const renderVitalDetails = () => {
    return (
      <>
        <AccordionH4 id={"diagnostics-and-vital-signs"}>
          Diagnostics and Vital Signs
        </AccordionH4>
        <AccordionDiv>
          <div className="lh-18" data-testid="vital-signs">
            {vitalData.map((item, index) => (
              <DataDisplay item={item} key={index} />
            ))}
          </div>
        </AccordionDiv>
      </>
    );
  };

  const renderTreatmentDetails = () => {
    const data = treatmentData.filter((item) => !React.isValidElement(item));
    return (
      <>
        <AccordionH4 id={"treatment-details"}>Treatment Details</AccordionH4>
        <AccordionDiv>
          <div data-testid="treatment-details">
            {data.map((item, index) => (
              <DataTableDisplay item={item} key={index} />
            ))}
          </div>
          <div className={"section__line_gray margin-y-2"} />
        </AccordionDiv>
      </>
    );
  };

  return (
    <AccordionSection>
      {clinicalNotes?.length > 0 && renderClinicalNotes()}
      {(reasonForVisitDetails.length > 0 || activeProblemsDetails.length > 0) &&
        renderSymptomsAndProblems()}
      {treatmentData.length > 0 && renderTreatmentDetails()}
      {immunizationsDetails.length > 0 && renderImmunizationsDetails()}
      {vitalData.length > 0 && renderVitalDetails()}
    </AccordionSection>
  );
};

export default ClinicalInfo;
