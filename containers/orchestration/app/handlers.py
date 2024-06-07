import os
from functools import wraps

from opentelemetry import trace
from opentelemetry.trace.status import StatusCode
from requests import Response

from app.models import OrchestrationRequest

MESSAGE_TO_TEMPLATE_MAP = {
    "fhir": "",
    "ecr": "EICR",
    "elr": "ORU_R01",
    "vxu": "VXU_V04",
}

# Integrate services tracer with automatic instrumentation context
tracer = trace.get_tracer("orchestration_handlers.py_tracer")


def with_tracer(func):
    """
    Decorator function that wraps a handler function with a tracer span.
    """

    @wraps(func)
    def wrapper(*args, **kwargs):
        method_name = func.__name__

        # Extract orchestration_request and workflow_params from args or kwargs
        orchestration_request = kwargs.get("orchestration_request")
        workflow_params = kwargs.get("workflow_params", {})

        # Find the indices of orchestration_request and workflow_params if they are in args
        func_params = func.__code__.co_varnames
        if orchestration_request is None and "orchestration_request" in func_params:
            index = func_params.index("orchestration_request")
            if index < len(args):
                orchestration_request = args[index]

        if "workflow_params" in func_params:
            index = func_params.index("workflow_params")
            if index < len(args):
                workflow_params = args[index]

        with tracer.start_as_current_span(
            method_name,
            kind=trace.SpanKind(0),
            attributes={
                "message_type": orchestration_request.get("message_type"),
                "data_type": orchestration_request.get("data_type"),
                "workflow_params": workflow_params,
            },
        ) as handler_span:
            # Inject handler_span as the first argument
            return func(handler_span, *args, **kwargs)

    return wrapper


class ServiceHandlerResponse:
    """
    Wrapper class that encapsulates all the information the `call_apis`
    function needs to handle processing one service's output as another
    service's input. This class captures the return status of a service
    (status code), what data it sent back (its message content), and
    whether this data is fit for processing by another service (whether
    call_apis should continue). Some of the DIBBs services either do not
    return altered data to the caller, or return a 200 status code but
    still flag an error with their input, so capturing these nuances
    allows `call_apis` to be completely agnostic about the response
    content a service sends back.
    """

    def __init__(
        self, status_code: int, msg_content: str | dict, should_continue: bool
    ):
        self._status_code = status_code
        self._msg_content = msg_content
        self._should_continue = should_continue

    @property
    def status_code(self) -> int:
        """
        The status code the service returned to the caller.
        """
        return self._status_code

    @status_code.setter
    def status_code(self, code: int) -> None:
        """
        Decorator for setting status_code value as a property.
        :param code: The status code to set for a service's response.
        """
        self._status_code = code

    @property
    def msg_content(self) -> str | dict:
        """
        The data the service sent back to the caller. If this is a
        transformation or standardization service, this value holds
        the altered and updated data the service computed. If this
        is the validation or a verification service, this value
        holds any errors the service flagged in its input.
        """
        return self._msg_content

    @msg_content.setter
    def msg_content(self, content: str | dict) -> None:
        """
        Decorator for setting msg_content value as a property.
        :param content: The message content or error description to set
          as the returned value of a service's response.
        """
        self._msg_content = content

    @property
    def should_continue(self) -> bool:
        """
        Whether the calling function can hand the processed data off
        to the next service, based on the current service's status
        and message content validity.
        """
        return self._should_continue

    @should_continue.setter
    def should_continue(self, cont: bool) -> None:
        """
        Decorator for setting should_continue value as a property.
        :param cont: Whether the service's response merits continuing on
          to the next service.
        """
        self._should_continue = cont


@with_tracer
def build_fhir_converter_request(
    handler_span: trace.Span,
    input_msg: str,
    orchestration_request: OrchestrationRequest,
    workflow_params: dict | None = None,
) -> dict:
    """
    Helper function for constructing the input payload for an API call to
    the DIBBs FHIR converter. When the user uploads data, we use the
    parameters of their request to assign an appropriate root conversion
    template and pass this information to the conversion service.

    :param input_msg: The data the user sent for workflow processing, as
      a string.
    :param orchestration_request: The request the client initially sent
      to the orchestration service. This request bundles a number of
      parameter settings into one dictionary that each handler can
      accept for consistency.
    :param workflow_params: Optionally, a set of configuration parameters
      included in the workflow config for the converter step of a workflow.
    :return: A dictionary ready to JSON-serialize as a payload to the
      FHIR converter.
    """
    # Template will depend on input data formatting and typing
    input_type = orchestration_request.get("message_type")
    root_template = MESSAGE_TO_TEMPLATE_MAP[input_type]
    handler_span.add_event(
        "identified root template type for conversion",
        attributes={"root_template": root_template},
    )
    return {
        "input_data": input_msg,
        "input_type": input_type,
        "root_template": root_template,
        "rr_data": orchestration_request.get("rr_data"),
    }


@with_tracer
def build_message_parser_message_request(
    handler_span: trace.Span,
    input_msg: str,
    orchestration_request: OrchestrationRequest,
    workflow_params: dict | None = None,
) -> dict:
    """
    Helper function for constructing the output payload for an API call to
    the DIBBs message parser for JSON messages.

    :param input_msg: The data the user sent for workflow processing, as
      a string.
    :param orchestration_request: The request the client initially sent
      to the orchestration service. This request bundles a number of
      parameter settings into one dictionary that each handler can
      accept for consistency.
    :param workflow_params: Optionally, a set of configuration parameters
      included in the workflow config for the converter step of a workflow.
    :return: A dictionary ready to JSON-serialize as a payload to the
      message parser.
    """
    # Template format will depend on the data's structure
    if isinstance(input_msg, dict) and input_msg.get("resourceType", "") == "Bundle":
        msg_fmt = "fhir"
    else:
        msg_fmt = orchestration_request.get("message_type")
    handler_span.add_event("using message format " + msg_fmt)
    return {
        "message": input_msg,
        "message_format": msg_fmt,
        "parsing_schema_name": workflow_params.get("parsing_schema_name"),
        "credential_manager": workflow_params.get("credential_manager"),
    }


@with_tracer
def build_message_parser_phdc_request(
    handler_span: trace.Span,
    input_msg: str,
    orchestration_request: OrchestrationRequest,
    workflow_params: dict | None = None,
) -> dict:
    """
    Helper function for constructing the output payload for an API call to
    the DIBBs message parser for PHDC-formatted XML.

    :param input_msg: The data the user sent for workflow processing, as
      a string.
    :param orchestration_request: The request the client initially sent
      to the orchestration service. This request bundles a number of
      parameter settings into one dictionary that each handler can
      accept for consistency.
    :param workflow_params: Optionally, a set of configuration parameters
      included in the workflow config for the converter step of a workflow.
    :return: A dictionary ready to JSON-serialize as a payload to the
      message parser.
    """
    return {
        "message": input_msg,
        "phdc_report_type": workflow_params.get("phdc_report_type"),
    }


@with_tracer
def build_validation_request(
    handler_span: trace.Span,
    input_msg: str,
    orchestration_request: OrchestrationRequest,
    workflow_params: dict | None = None,
) -> dict:
    """
    Helper function for constructing the input payload for an API call to
    the DIBBs validation service. This handler simply reorders and formats
    the parameters into an acceptable input for the validator.

    :param input_msg: The data the user sent for workflow processing, as
      a string.
    :param orchestration_request: The request the client initially sent
      to the orchestration service. This request bundles a number of
      parameter settings into one dictionary that each handler can
      accept for consistency.
    :param workflow_params: Optionally, a set of configuration parameters
      included in the workflow config for the validation step of a workflow.
    :return: A dictionary ready to send to the validation service.
    """
    return {
        "message_type": orchestration_request.get("message_type"),
        "include_error_types": workflow_params.get("include_error_types"),
        "message": orchestration_request.get("message"),
        "rr_data": orchestration_request.get("rr_data"),
    }


@with_tracer
def build_ingestion_name_request(
    handler_span: trace.Span,
    input_msg: str,
    orchestration_request: OrchestrationRequest,
    workflow_params: dict | None = None,
) -> dict:
    """
    Helper function for constructing the output payload for an API call to
    the DIBBs ingestion for the name standardization service.

    :param input_msg: The data the user sent for workflow processing, as
      a string.
    :param orchestration_request: The request the client initially sent
      to the orchestration service. This request bundles a number of
      parameter settings into one dictionary that each handler can
      accept for consistency.
    :param workflow_params: Optionally, a set of configuration parameters
      included in the workflow config for the converter step of a workflow.
    :return: A dictionary ready to JSON-serialize as a payload to the
      message parser.
    """
    # Default parameter values
    default_params = {
        "trim": "true",
        "overwrite": "true",
        "case": "upper",
        "remove_numbers": "true",
    }

    # Initialize workflow_params as an empty dictionary if it's None
    workflow_params = workflow_params or {}

    for key, value in default_params.items():
        workflow_params.setdefault(key, value)

    handler_span.add_event(
        "updating standardization options",
        attributes={
            "trim": workflow_params.get("trim"),
            "overwrite": workflow_params.get("overwrite"),
            "case": workflow_params.get("case"),
            "remove_numbers": workflow_params.get("remove_numbers"),
        },
    )

    return {
        "data": input_msg,
        "trim": workflow_params.get("trim"),
        "overwrite": workflow_params.get("overwrite"),
        "case": workflow_params.get("case"),
        "remove_numbers": workflow_params.get("remove_numbers"),
    }


@with_tracer
def build_ingestion_phone_request(
    handler_span: trace.Span,
    input_msg: str,
    orchestration_request: OrchestrationRequest,
    workflow_params: dict | None = None,
) -> dict:
    """
    Helper function for constructing the output payload for an API call to
    the DIBBs ingestion for the phone standardization service.

    :param input_msg: The data the user sent for workflow processing, as
      a string.
    :param orchestration_request: The request the client initially sent
      to the orchestration service. This request bundles a number of
      parameter settings into one dictionary that each handler can
      accept for consistency.
    :param workflow_params: Optionally, a set of configuration parameters
      included in the workflow config for the converter step of a workflow.
    :return: A dictionary ready to JSON-serialize as a payload to the
      message parser.
    """
    # Since only one param, just add it explicitly
    if workflow_params is None:
        workflow_params = {"overwrite": "true"}

    return {
        "data": input_msg,
        "overwrite": workflow_params.get("overwrite", "true"),
    }


@with_tracer
def build_ingestion_dob_request(
    handler_span: trace.Span,
    input_msg: str,
    orchestration_request: OrchestrationRequest,
    workflow_params: dict | None = None,
) -> dict:
    """
    Helper function for constructing the output payload for an API call to
    the DIBBs ingestion for the date of birth (DOB) standardization service.

    :param input_msg: The data the user sent for workflow processing, as
      a string.
    :param orchestration_request: The request the client initially sent
      to the orchestration service. This request bundles a number of
      parameter settings into one dictionary that each handler can
      accept for consistency.
    :param workflow_params: Optionally, a set of configuration parameters
      included in the workflow config for the converter step of a workflow.
    :return: A dictionary ready to JSON-serialize as a payload to the
      message parser.
    """
    # Default parameter values
    default_params = {"overwrite": "true", "format": "Y%-m%-d%"}

    # Initialize workflow_params as an empty dictionary if it's None
    workflow_params = workflow_params or {}

    for key, value in default_params.items():
        workflow_params.setdefault(key, value)

    handler_span.add_event(
        "updating standardization options",
        attributes={
            "overwrite": workflow_params.get("overwrite"),
            "format": workflow_params.get("format"),
        },
    )

    return {
        "data": input_msg,
        "overwrite": workflow_params.get("overwrite"),
        "format": workflow_params.get("format"),
    }


@with_tracer
def build_geocoding_request(
    handler_span: trace.Span,
    input_msg: str,
    orchestration_request: OrchestrationRequest,
    workflow_params: dict | None = None,
) -> dict:
    """
    Helper function for constructing the output payload for an API call to
    the DIBBs ingestion for the geocoding ingestion service.

    :param input_msg: The data the user sent for workflow processing, as
      a string.
    :param orchestration_request: The request the client initially sent
      to the orchestration service. This request bundles a number of
      parameter settings into one dictionary that each handler can
      accept for consistency.
    :param workflow_params: Optionally, a set of configuration parameters
      included in the workflow config for the converter step of a workflow.
    :return: A dictionary ready to JSON-serialize as a payload to the
      message parser.
    """
    # Default parameter values
    default_params = {
        "geocode_method": "smarty",
        "smarty_auth_id": os.environ.get("SMARTY_AUTH_ID"),
        "smarty_auth_token": os.environ.get("SMARTY_AUTH_TOKEN"),
        "license_type": "us-rooftop-geocoding-enterprise-cloud",
        "overwrite": "true",
    }

    # Initialize workflow_params as an empty dictionary if it's None
    workflow_params = workflow_params or {}

    for key, value in default_params.items():
        workflow_params.setdefault(key, value)

    handler_span.add_event(
        "updating geocoding function parameters",
        attributes={
            "geocode_method": workflow_params.get("geocode_method"),
            "smarty_auth_id_is_not_null": workflow_params.get("smarty_auth_id")
            is not None,
            "smarty_auth_token_is_not_null": workflow_params.get("smarty_auth_token")
            is not None,
            "license_type": workflow_params.get("license_type"),
            "overwrite": workflow_params.get("overwrite"),
        },
    )

    return {
        "bundle": input_msg,
        "geocode_method": workflow_params.get("geocode_method"),
        "smarty_auth_id": workflow_params.get("smarty_auth_id"),
        "smarty_auth_token": workflow_params.get("smarty_auth_token"),
        "license_type": workflow_params.get("license_type"),
        "overwrite": workflow_params.get("overwrite"),
    }


@with_tracer
def build_save_fhir_data_body(
    handler_span: trace.Span,
    input_msg: str,
    orchestration_request: OrchestrationRequest,
    workflow_params: dict | None = None,
) -> dict:
    """
    Helper function for constructing the input payload for an API call to
    the DIBBs ecr viewer.

    :param input_msg: The data the user sent for workflow processing, as
      a string.
    :param orchestration_request: The request the client initially sent
      to the orchestration service. This request bundles a number of
      parameter settings into one dictionary that each handler can
      accept for consistency.
    :param workflow_params: Optionally, a set of configuration parameters
      included in the workflow config for the validation step of a workflow.
    :return: A dictionary ready to send to the validation service.
    """
    return {
        "fhirBundle": input_msg,
        "saveSource": workflow_params.get("saveSource"),
    }


# @with_tracer
# def build_stamp_condition_extension_request(
#     handler_span: trace.Span,
#     input_msg: str,
#     orchestration_request: OrchestrationRequest,
#     workflow_params: dict | None = None,
# ) -> dict:
#     pass


@with_tracer
def unpack_fhir_converter_response(
    handler_span: trace.Span, response: Response
) -> ServiceHandlerResponse:
    """
    Helper function for processing a response from the DIBBs FHIR converter.
    If the status code of the response the server sent back is OK, return
    the parsed FHIR bundle from the response body. Otherwise, report what
    went wrong.

    :param response: The response returned by a POST request to the FHIR
      converter.
    :return: A ServiceHandlerResponse with a FHIR bundle and instruction
      to continue, or a failed status code and error messaging.
    """
    match response.status_code:
        case 200:
            handler_span.add_event(
                "conversion successful, dumping to JSON response struct"
            )
            converter_response = response.json().get("response")
            fhir_msg = converter_response.get("FhirResource")
            return ServiceHandlerResponse(response.status_code, fhir_msg, True)
        case _:
            handler_span.add_event("conversion failed")
            handler_span.set_status(StatusCode(2), "Error Message: " + response.text)
            return ServiceHandlerResponse(
                response.status_code,
                f"FHIR Converter request failed: {response.text}",
                False,
            )


@with_tracer
def unpack_parsed_message_response(
    handler_span: trace.Span,
    response: Response,
) -> ServiceHandlerResponse:
    """
    Helper function for processing a response from the DIBBs message parser.
    If the status code of the response the server sent back is OK, return
    the parsed JSON message from the response body. Otherwise, report what
    went wrong based on status_code.

    :param response: The response returned by a POST request to the message parser.
    :return: A ServiceHandlerResponse with a dictionary of parsed values
      and instruction to continue, or a failed status code and error messaging.
    """
    status_code = response.status_code

    match status_code:
        case 200:
            handler_span.add_event("Successfully parsed extracted values")
            return ServiceHandlerResponse(
                status_code, response.json().get("parsed_values"), True
            )
        case 400:
            handler_span.add_event("Message parser responded with bad request")
            handler_span.set_status(
                StatusCode(2), "Error Message: " + response.json().get("message")
            )
            return ServiceHandlerResponse(
                status_code, response.json().get("message"), False
            )
        case 422:
            handler_span.add_event(
                "Message parser responded with unprocessable entity / bad input parameters"
            )
            handler_span.set_status(
                StatusCode(2), "Error Message: " + response.json().__str__()
            )
            return ServiceHandlerResponse(status_code, response.json(), False)
        case _:
            handler_span.add_event("Message parser failed")
            handler_span.set_status(StatusCode(2), "Error Message: " + response.text)
            return ServiceHandlerResponse(
                status_code,
                f"Message Parser request failed: {response.text}",
                False,
            )


@with_tracer
def unpack_fhir_to_phdc_response(
    handler_span: trace.Span, response: Response
) -> ServiceHandlerResponse:
    """
    Helper function for processing a response from the DIBBs message parser.
    If the status code of the response the server sent back is OK, return
    the parsed XML message from the response body. Otherwise, report what
    went wrong based on status_code.

    :param response: The response returned by a POST request to the message parser.
    :return: A tuple containing the status code of the response as well as
      parsed message created by the service.
    """
    status_code = response.status_code

    match status_code:
        case 200:
            handler_span.add_event("Successfully constructed PHDC from bundle")
            return ServiceHandlerResponse(status_code, response.content, True)
        case 422:
            handler_span.add_event(
                "Message parser responded with unprocessable entity / bad input parameters"
            )
            handler_span.set_status(
                StatusCode(2), "Error Message: " + response.json().__str__()
            )
            return ServiceHandlerResponse(status_code, response.json(), False)
        case _:
            handler_span.add_event("PHDC construction failed")
            handler_span.set_status(StatusCode(2), "Error Message: " + response.text)
            return ServiceHandlerResponse(
                status_code,
                f"Message Parser request failed: {response.text}",
                False,
            )


@with_tracer
def unpack_validation_response(
    handler_span: trace.Span, response: Response
) -> ServiceHandlerResponse:
    """
    Helper function for processing a response from the DIBBs validation
    service. If the message is valid, with no errors in data structure,
    just report that to the calling orchestrator so we can continue the
    workflow. If the message isn't valid but the service succeeded (status
    code 200), tell the caller what the errors were so they can abort
    and inform the user.

    :param response: The response returned by a POST request to the validation
      service.
    :return: A ServiceHandlerResponse with any validation errors the data
      generated, or an instruction to continue to the next service.
    """
    match response.status_code:
        case 200:
            validator_response = response.json()
            handler_span.add_event(
                "Validation service completed successfully",
                attributes={
                    "validation_results": validator_response.get("validation_results"),
                    "message_is_valid": validator_response.get("message_valid"),
                },
            )
            return ServiceHandlerResponse(
                response.status_code,
                validator_response.get("validation_results"),
                validator_response.get("message_valid"),
            )
        case _:
            handler_span.add_event(
                "Validation of message failed, or message contained errors"
            )
            handler_span.set_status(StatusCode(2), "Error Message: " + response.text)
            return ServiceHandlerResponse(
                response.status_code,
                f"Validation service failed: {response.text}",
                False,
            )


@with_tracer
def unpack_ingestion_standardization(
    handler_span: trace.Span, response: Response
) -> ServiceHandlerResponse:
    """
    Helper function for processing a response from the ingestion standardization
    services.
    If the status code of the response the server sent back is OK, return
    the parsed json message from the response body. Otherwise, report what
    went wrong based on status_code. Usable for DOB, name, and phone standardization,
    and geocoding.

    :param response: The response returned by a POST request to the ingestion service.
    :return: A tuple containing the status code of the response as well as
      parsed message created by the service.
    """
    status_code = response.status_code

    match status_code:
        case 200:
            handler_span.add_event("ingestion operation successful")
            return ServiceHandlerResponse(
                status_code,
                response.json().get("bundle"),
                True,
            )
        case 400:
            handler_span.add_event("ingestion service responded with bad request")
            handler_span.set_status(
                StatusCode(2), "Error Message: " + response.json().get("message")
            )
            return ServiceHandlerResponse(
                status_code, response.json().get("message"), False
            )
        case 422:
            handler_span.add_event(
                "ingestion service responded with unprocessable entity / bad input params"
            )
            handler_span.set_status(
                StatusCode(2), "Error Message: " + response.json().__str__()
            )
            return ServiceHandlerResponse(status_code, response.json(), False)
        case _:
            handler_span.add_event("ingestion service failed")
            handler_span.set_status(StatusCode(2), "Error Message: " + response.text)
            return ServiceHandlerResponse(
                status_code,
                f"Standardization request failed: {response.text}",
                False,
            )


@with_tracer
def unpack_save_fhir_data_response(
    handler_span: trace.Span, response: Response
) -> ServiceHandlerResponse:
    """
    Helper function for processing a response from save fhir data.

    If the status code of the response the server sent back is OK, return
    the message from the response body. Otherwise, report what
    went wrong based on status_code.

    :param response: The response returned by a POST request to the ingestion service.
    :return: A tuple containing the status code of the response as well as
      parsed message created by the service.
    """
    status_code = response.status_code

    match status_code:
        case 200:
            handler_span.add_event("save fhir data body succeeded")
            return ServiceHandlerResponse(
                status_code,
                response.json().get("message"),
                True,
            )
        case 400:
            handler_span.add_event("save fhir data responded with bad request")
            handler_span.set_status(
                StatusCode(2), "Error Message: " + response.json().get("message")
            )
            return ServiceHandlerResponse(
                status_code, response.json().get("message"), False
            )
        case _:
            handler_span.add_event("save fhir data failed")
            handler_span.set_status(StatusCode(2), "Error Message: " + response.text)
            return ServiceHandlerResponse(
                status_code,
                f"Saving failed: {response.text}",
                False,
            )
