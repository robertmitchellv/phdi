from phdi.containers.base_service import BaseService
from pathlib import Path
import requests
import uuid
import json
from pydantic import BaseModel
from typing import Optional, Literal

USE_CASES = Literal["social-determinants", "newborn-screening", "syphilis"]

FHIR_SERVERS = {
    "meld": {"hostname": "https://gw.interop.community/HeliosConnectathonSa/open"},
    "ehealthexchange": {
        "hostname": "https://concept01.ehealthexchange.org:52780/fhirproxy/r4/",
        "username": "svc_eHxFHIRSandbox",
        "password": "willfulStrongStandurd7",
        "headers": {
            "Accept": "application/json, application/*+json, */*",
            "Accept-Encoding": "gzip, deflate, br",
            "Content-Type": "application/fhir+json; charset=UTF-8",
            "X-DESTINATION": "CernerHelios",
            "X-POU": "TREAT",
            "X-Request-Id": str(uuid.uuid4()),
            "prefer": "return=representation",
            "Cache-Control": "no-cache",
            "OAUTHSCOPES": "system/Condition.read system/Encounter.read system/Immunization.read system/MedicationRequest.read system/Observation.read system/Patient.read system/Procedure.read system/MedicationAdministration.read system/DiagnosticReport.read system/RelatedPerson.read",
        },
    },
}


# Instantiate FastAPI via PHDI's BaseService class
app = BaseService(
    service_name="DIBBS FHIR Connector",
    description_path=Path(__file__).parent.parent / "description.md",
).start()


class UseCaseQueryRequest(BaseModel):
    fhir_server: Literal["meld", "ehealthexchange"]
    first_name: str
    last_name: str
    dob: str
    mrn: Optional[str]
    phone: Optional[str]
    street: Optional[str]
    city: Optional[str]
    state: Optional[str]
    zip: Optional[str]


@app.post("/use-case-query/{use_case}")
async def use_case_query(use_case: USE_CASES, input: UseCaseQueryRequest):
    
    # Connect to FHIR Server
    fhir_host = FHIR_SERVERS[input.fhir_server]["hostname"]
    session = requests.Session()
    fhir_server_config = FHIR_SERVERS[input.fhir_server]
    if fhir_server_config.get("username") and fhir_server_config.get("password"):
        session.auth = (
            fhir_server_config["username"],
            fhir_server_config["password"],
        )
    if fhir_server_config.get("headers"):
        session.headers = fhir_server_config["headers"]
    session.verify = False   
    

    # Find Patient

    patient_query = f"{fhir_host}/Patient?given={input.first_name}&family={input.last_name}&birthdate={input.dob}"
    response = session.get(patient_query)

    if response.status_code != 200:
        return {
            "error": "Patient search failed.",
            "status_code": response.status_code,
            "query": patient_query,
            "fhir_server_response": response.text,
        }

    patient_searchset = response.json()

    if patient_searchset["total"] > 1:
        return {"error": "Multiple patients found. Please refine your search."}
    elif patient_searchset["total"] == 0:
        return {"error": "No patients found. Please refine your search."}

    patient_id = patient_searchset["entry"][0]["resource"]["id"]

    print(patient_id)
    # Use Case Query
    if use_case == "social-determinants":
        use_case_query = (
            f"{fhir_host}/Observation?subject=Patient/{patient_id}&category=survey"
        )
        use_case_response = session.get(use_case_query).json()

    elif use_case == "newborn-screening":
        use_case_query = (
            f"{fhir_host}/Observation?subject=Patient/{patient_id}&category=laboratory"
        )
        screening_loinc_codes = [
            "73700-7",
            "73698-3",
            "54108-6",
            "54109-4",
            "58232-0",
            "57700-7",
            "73739-5",
            "73742-9",
            "2708-6",
            "8336-0",
        ]
        loinc_fitler = "http://loinc.org|" + ",".join(screening_loinc_codes)
        use_case_query = f"{use_case_query}&code={loinc_fitler}"
        use_case_response = session.get(use_case_query).json()

    elif use_case == "syphilis":
        syphilis_loincs = ["LP70657-9", "98212-4"]
        syphilis_loincs = ",".join(syphilis_loincs)
        conditon_query = f"{fhir_host}/Condition?subject={patient_id}&code=76272004"
        labs_query = f"{fhir_host}/Observation?subject={patient_id}&code={syphilis_loincs}"
        diagnositic_report_query = f"{fhir_host}/DiagnosticReport?subject={patient_id}&code={syphilis_loincs}"
        
        queries = [conditon_query, labs_query, diagnositic_report_query]
        
        use_case_response = None
        for query in queries:
            partial_response = session.get(query)
            print(query)
            if use_case_response is None:
                use_case_response = partial_response.json()
            else:
                use_case_response["entry"].extend(partial_response.json()["entry"])
            use_case_response["total"] = len(use_case_response["entry"])
    return use_case_response
