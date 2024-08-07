import {
  evaluateEcrMetadata,
  evaluateSocialData,
  extractPatientAddress,
  calculatePatientAge,
  evaluateClinicalData,
  evaluatePatientName,
} from "@/app/utils";
import { loadYamlConfig } from "@/app/api/utils";
import { Bundle } from "fhir/r4";
import BundleWithTravelHistory from "../tests/assets/BundleTravelHistory.json";
import BundleWithPatient from "../tests/assets/BundlePatient.json";
import BundleWithEcrMetadata from "../tests/assets/BundleEcrMetadata.json";
import BundleWithSexualOrientation from "../tests/assets/BundleSexualOrientation.json";
import BundleWithMiscNotes from "../tests/assets/BundleMiscNotes.json";
import React from "react";
import { render, screen } from "@testing-library/react";

describe("Utils", () => {
  const mappings = loadYamlConfig();
  describe("Evaluate Social Data", () => {
    it("should have no available data when there is no data", () => {
      const actual = evaluateSocialData(undefined as any, mappings);

      expect(actual.availableData).toBeEmpty();
      expect(actual.unavailableData).not.toBeEmpty();
    });
    it("should have travel history when there is a travel history observation present", () => {
      const actual = evaluateSocialData(
        BundleWithTravelHistory as unknown as Bundle,
        mappings,
      );

      expect(actual.availableData[0].value)
        .toEqualIgnoringWhitespace(`Dates: 2018-01-18 - 2018-02-18
           Location(s): Traveled to Singapore, Malaysia and Bali with my family.
           Purpose of Travel: Active duty military (occupation)`);
    });
    it("should have patient sexual orientation when available", () => {
      const actual = evaluateSocialData(
        BundleWithSexualOrientation as unknown as Bundle,
        mappings,
      );

      expect(actual.availableData[0].value).toEqual("Do not know");
    });
  });
  describe("Evaluate Ecr Metadata", () => {
    it("should have no available data where there is no data", () => {
      const actual = evaluateEcrMetadata(undefined as any, mappings);

      expect(actual.ecrSenderDetails.availableData).toBeEmpty();
      expect(actual.ecrSenderDetails.unavailableData).not.toBeEmpty();

      expect(actual.eicrDetails.availableData).toBeEmpty();
      expect(actual.eicrDetails.unavailableData).not.toBeEmpty();

      expect(actual.rrDetails.availableData).toBeEmpty();
      expect(actual.rrDetails.unavailableData).not.toBeEmpty();
    });
    it("should have ecrSenderDetails", () => {
      const actual = evaluateEcrMetadata(
        BundleWithEcrMetadata as unknown as Bundle,
        mappings,
      );

      expect(actual.ecrSenderDetails.availableData).toEqual([
        { title: "Date/Time eCR Created", value: "2022-07-28T09:01:22-05:00" },
        {
          title: "Sender Facility Name",
          value: "Vanderbilt University Adult Hospital",
        },
        {
          title: "Facility Address",
          value: "1211 Medical Center Dr\nNashville, TN\n37232",
        },
        { title: "Facility Contact", value: "+1-615-322-5000" },
        { title: "Facility ID", value: "1.2.840.114350.1.13.478.3.7.2.686980" },
      ]);
      expect(actual.ecrSenderDetails.unavailableData).toEqual([
        { title: "Sender Software" },
      ]);
    });
    it("should have eicrDetails", () => {
      const actual = evaluateEcrMetadata(
        BundleWithEcrMetadata as unknown as Bundle,
        mappings,
      );

      expect(actual.eicrDetails.availableData).toEqual([
        {
          title: "eICR Identifier",
          value: "1.2.840.114350.1.13.478.3.7.8.688883.230886",
        },
      ]);
      expect(actual.eicrDetails.unavailableData).toBeEmpty();
    });
    it("should have rrDetails", () => {
      const actual = evaluateEcrMetadata(
        BundleWithEcrMetadata as unknown as Bundle,
        mappings,
      );

      expect(actual.rrDetails.availableData).toEqual([
        {
          title: "Reportable Condition(s)",
          value:
            "Disease caused by severe acute respiratory syndrome coronavirus 2 (disorder)",
        },
        {
          title: "RCKMS Trigger Summary",
          value:
            "COVID-19 (as a diagnosis or active problem)\nDetection of SARS-CoV-2 nucleic acid in a clinical or post-mortem specimen by any method",
        },
        {
          title: "Jurisdiction(s) Sent eCR",
          value: "Tennessee Department of Health",
        },
      ]);
      expect(actual.rrDetails.unavailableData).toBeEmpty();
    });
  });
  describe("Evaluate Clinical Info", () => {
    it("Should return notes", () => {
      const actual = evaluateClinicalData(
        BundleWithMiscNotes as unknown as Bundle,
        mappings,
      );
      render(actual.clinicalNotes.availableData[0].value as React.JSX.Element);
      expect(actual.clinicalNotes.availableData[0].title).toEqual(
        "Miscellaneous Notes",
      );
      expect(screen.getByText("Active Problems")).toBeInTheDocument();
      expect(actual.clinicalNotes.unavailableData).toBeEmpty();
    });
  });

  describe("Evaluate Patient Name", () => {
    it("should return name", () => {
      const actual = evaluatePatientName(
        BundleWithPatient as unknown as Bundle,
        mappings,
      );
      expect(actual).toEqual("ABEL CASTILLO");
    });
  });
  describe("Extract Patient Address", () => {
    it("should return empty string if no address is available", () => {
      const actual = extractPatientAddress(undefined as any, mappings);

      expect(actual).toBeEmpty();
    });
    it("should get patient address", () => {
      const actual = extractPatientAddress(
        BundleWithPatient as unknown as Bundle,
        mappings,
      );

      expect(actual).toEqual("1050 CARPENTER ST\nEDWARDS, CA\n93523-2800, US");
    });
  });
  describe("Calculate Patient Age", () => {
    it("should return patient age when DOB is available", () => {
      // Fixed "today" for testing purposes
      jest.useFakeTimers().setSystemTime(new Date("2024-03-12"));

      const patientAge = calculatePatientAge(
        BundleWithPatient as unknown as Bundle,
        mappings,
      );

      expect(patientAge).toEqual(8);

      // Return to real time
      jest.useRealTimers();
    });
    it("should return nothing when DOB is unavailable", () => {
      const patientAge = calculatePatientAge(undefined as any, mappings);

      expect(patientAge).toEqual(undefined);
    });
  });

  describe("Extract Patient Address", () => {
    it("should return empty string if no address is available", () => {
      const actual = extractPatientAddress(undefined as any, mappings);

      expect(actual).toBeEmpty();
    });
    it("should get patient address", () => {
      const actual = extractPatientAddress(
        BundleWithPatient as unknown as Bundle,
        mappings,
      );

      expect(actual).toEqual("1050 CARPENTER ST\nEDWARDS, CA\n93523-2800, US");
    });
  });
});
